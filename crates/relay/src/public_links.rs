//! Immutable, owner-created public transcripts. Never expose raw thread DTOs.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Scope {
    device_id: String,
    thread_id: String,
    #[serde(default)]
    snapshot: Option<Value>,
}

fn owns(conn: &Connection, owner: &str, scope: &Scope) -> bool {
    Uuid::parse_str(&scope.thread_id).is_ok()
        && conn
            .query_row(
                "SELECT 1 FROM relay_devices WHERE id=?1 AND owner_user_id=?2",
                params![scope.device_id, owner],
                |_| Ok(()),
            )
            .optional()
            .ok()
            .flatten()
            .is_some()
}

fn numeric_fields(source: &Value, fields: &[&str]) -> Value {
    Value::Object(
        fields
            .iter()
            .filter_map(|key| {
                source[*key]
                    .as_f64()
                    .filter(|v| *v >= 0.0)
                    .map(|n| (key.to_string(), json!(n)))
            })
            .collect(),
    )
}
pub(super) async fn create(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(scope): Json<Scope>,
) -> Response {
    let owner = {
        let conn = state.store.conn.lock().await;
        let Some(user) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
        else {
            return unauthorized();
        };
        if !owns(&conn, &user.id, &scope) {
            return StatusCode::NOT_FOUND.into_response();
        }
        user.id
    };
    let created_at = now_rfc3339();
    // The browser decrypts and projects the transcript before explicitly publishing it.
    // Never fetch private transcript data through an unencrypted relay side channel.
    let Some(input) = scope.snapshot.as_ref() else {
        return (
            StatusCode::BAD_REQUEST,
            "A public transcript snapshot is required",
        )
            .into_response();
    };
    let Some(source_turns) = input["turns"].as_array().filter(|v| v.len() <= 10_000) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let mut turns = Vec::new();
    let mut paths = HashSet::new();
    for source in source_turns {
        let Some(items) = source["messages"].as_array() else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        let mut messages = Vec::new();
        for item in items {
            if !matches!(item["role"].as_str(), Some("user" | "assistant")) {
                continue;
            }
            let text = item["text"].as_str().unwrap_or("");
            for tail in text.split("[PHOTO ").skip(1) {
                if let Some((path, _)) = tail.split_once(']') {
                    paths.insert(path.trim().to_string());
                }
            }
            messages.push(
                json!({"role":item["role"],"text":text,"createdAt":item["createdAt"].as_str()}),
            );
        }
        let mut turn = json!({"messages":messages,"startedAt":source["startedAt"].as_str(),"completedAt":source["completedAt"].as_str(),"model":source["model"].as_str(),"reasoningEffort":source["reasoningEffort"].as_str()});
        if source["tokenUsage"].is_object() {
            let fields = [
                "totalTokens",
                "inputTokens",
                "cachedInputTokens",
                "cacheWriteInputTokens",
                "outputTokens",
                "reasoningOutputTokens",
            ];
            turn["tokenUsage"] = json!({"total":numeric_fields(&source["tokenUsage"]["total"],&fields),"last":numeric_fields(&source["tokenUsage"]["last"],&fields),"modelContextWindow":source["tokenUsage"]["modelContextWindow"].as_u64()});
        }
        if source["priceEstimate"].is_object() {
            let mut price = numeric_fields(
                &source["priceEstimate"],
                &[
                    "inputUsd",
                    "cachedInputUsd",
                    "cacheWriteInputUsd",
                    "outputUsd",
                    "totalUsd",
                ],
            );
            for key in ["pricingModelKey", "pricingTierKey", "currency"] {
                price[key] = json!(source["priceEstimate"][key].as_str());
            }
            turn["priceEstimate"] = price;
        }
        turns.push(turn);
    }
    let mut images = serde_json::Map::new();
    let mut image_bytes = 0;
    for path in paths {
        let Some(data) = input["images"][&path].as_str() else {
            continue;
        };
        let Some((prefix, encoded)) = data.split_once(",") else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        if !matches!(
            prefix,
            "data:image/png;base64"
                | "data:image/jpeg;base64"
                | "data:image/webp;base64"
                | "data:image/gif;base64"
        ) {
            return StatusCode::BAD_REQUEST.into_response();
        }
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        image_bytes += bytes.len();
        if image_bytes > 10 * 1024 * 1024 {
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        }
        images.insert(path, json!(data));
    }
    let theme = if input["theme"] == "light" {
        "light"
    } else {
        "dark"
    };
    let snapshot = json!({"title":input["title"].as_str().unwrap_or("Shared thread"),"createdAt":created_at,"turnCount":turns.len(),"turns":turns,"theme":theme,"images":images});
    let serialized = snapshot.to_string();
    if serialized.len() > 16 * 1024 * 1024 {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let id = Uuid::new_v4().simple().to_string();
    let conn = state.store.conn.lock().await;
    if !owns(&conn, &owner, &scope) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match conn.execute("INSERT INTO relay_public_links(id,owner_user_id,device_id,thread_id,snapshot_json,created_at) VALUES (?1,?2,?3,?4,?5,?6)", params![id,owner,scope.device_id,scope.thread_id,serialized,created_at]) {
        Ok(_) => Json(json!({"id":id,"createdAt":created_at,"turnCount":snapshot["turnCount"]})).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub(super) async fn list(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Query(scope): Query<Scope>,
) -> Response {
    let conn = state.store.conn.lock().await;
    let Some(user) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let Ok(mut statement) = conn.prepare("SELECT id,created_at,json_extract(snapshot_json,'$.turnCount') FROM relay_public_links WHERE owner_user_id=?1 AND device_id=?2 AND thread_id=?3 ORDER BY created_at DESC") else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    let Ok(rows) = statement.query_map(params![user.id,scope.device_id,scope.thread_id], |row| Ok(json!({"id":row.get::<_,String>(0)?,"createdAt":row.get::<_,String>(1)?,"turnCount":row.get::<_,i64>(2)?}))) else { return StatusCode::INTERNAL_SERVER_ERROR.into_response() };
    Json(rows.filter_map(Result::ok).collect::<Vec<_>>()).into_response()
}

pub(super) async fn read(Path(id): Path<String>, State(state): State<Arc<AppState>>) -> Response {
    let conn = state.store.conn.lock().await;
    let snapshot: Option<String> = conn
        .query_row(
            "SELECT snapshot_json FROM relay_public_links WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    match snapshot {
        Some(snapshot) => (
            [
                (header::CONTENT_TYPE, "application/json; charset=utf-8"),
                (header::CACHE_CONTROL, "no-store"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                (header::REFERRER_POLICY, "no-referrer"),
            ],
            snapshot,
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

pub(super) async fn revoke(
    Path(id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let conn = state.store.conn.lock().await;
    let Some(user) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    match conn.execute(
        "DELETE FROM relay_public_links WHERE id=?1 AND owner_user_id=?2",
        params![id, user.id],
    ) {
        Ok(1) => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
