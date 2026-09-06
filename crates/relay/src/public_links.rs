//! Immutable, owner-created public transcripts. Never expose raw thread DTOs.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Scope {
    device_id: String,
    thread_id: String,
    theme: Option<String>,
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

// Strict projection: command output, reasoning, internal paths/IDs and future
// DTO fields cannot leak into the public response, even if the UI changes.
fn messages(turn: &Value) -> Vec<Value> {
    let Some(items) = turn["items"].as_array() else {
        return vec![];
    };
    let final_index = if turn["status"] != "inProgress" {
        items
            .iter()
            .rposition(|item| item["kind"] == "agentMessage" && item["phase"] != "commentary")
    } else {
        None
    };
    items.iter().enumerate().filter_map(|(index, item)| {
        let user = item["kind"] == "userMessage";
        if !user && Some(index) != final_index { return None; }
        Some(json!({"role": if user {"user"} else {"assistant"}, "text": item["text"].as_str().unwrap_or(""), "createdAt": item["createdAt"].as_str()}))
    }).collect()
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
    let mut turns = Vec::new();
    let mut before = None::<String>;
    let mut title = String::new();
    let mut total = None;
    let mut seen = HashSet::new();
    loop {
        let mut path = format!("/api/threads/{}?view=summary&limit=100", scope.thread_id);
        if let Some(cursor) = &before {
            path.push_str(&format!("&beforeTurnId={cursor}"));
        }
        let response = forward_device(
            state.clone(),
            scope.device_id.clone(),
            "GET".into(),
            path,
            None,
            None,
            json!({}),
        )
        .await;
        if !response.status().is_success() {
            return response;
        }
        let Ok(bytes) = to_bytes(response.into_body(), 32 * 1024 * 1024).await else {
            return StatusCode::BAD_GATEWAY.into_response();
        };
        let Ok(detail) = serde_json::from_slice::<Value>(&bytes) else {
            return StatusCode::BAD_GATEWAY.into_response();
        };
        if total.is_none() {
            title = detail["thread"]["title"]
                .as_str()
                .unwrap_or("Shared thread")
                .into();
            total = detail["totalTurnCount"].as_u64();
        }
        let Some(page) = detail["turns"].as_array() else {
            return StatusCode::BAD_GATEWAY.into_response();
        };
        if page.is_empty() {
            break;
        }
        let cursor = page[0]["id"].as_str().unwrap_or_default().to_string();
        if cursor.is_empty() || before.as_ref() == Some(&cursor) {
            return StatusCode::BAD_GATEWAY.into_response();
        }
        let mut projected = Vec::new();
        for turn in page {
            if seen.insert(turn["id"].as_str().unwrap_or_default().to_string()) {
                projected.push(json!({
                    "messages": messages(turn),
                    "startedAt": turn["startedAt"], "completedAt": turn["completedAt"],
                    "model": turn["model"], "reasoningEffort": turn["reasoningEffort"],
                    "tokenUsage": turn["tokenUsage"], "priceEstimate": turn["priceEstimate"],
                }));
            }
        }
        projected.append(&mut turns);
        turns = projected;
        if turns.len() >= total.unwrap_or(page.len() as u64) as usize || page.len() < 100 {
            break;
        }
        // Refuse huge snapshots rather than silently publishing a partial history.
        if turns.len() >= 10_000 {
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        }
        before = Some(cursor);
    }
    let mut paths = HashSet::new();
    for turn in &turns {
        for message in turn["messages"].as_array().into_iter().flatten() {
            for tail in message["text"]
                .as_str()
                .unwrap_or("")
                .split("[PHOTO ")
                .skip(1)
            {
                if let Some((path, _)) = tail.split_once(']') {
                    paths.insert(path.trim().to_string());
                }
            }
        }
    }
    let mut images = serde_json::Map::new();
    let mut image_bytes = 0;
    for path in paths {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("path", &path)
            .finish();
        let response = forward_device(
            state.clone(),
            scope.device_id.clone(),
            "GET".into(),
            format!("/api/threads/{}/assets/image?{query}", scope.thread_id),
            None,
            None,
            json!({}),
        )
        .await;
        if !response.status().is_success() {
            continue;
        }
        let mime = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .to_string();
        if !matches!(
            mime.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif"
        ) {
            continue;
        }
        let Ok(bytes) = to_bytes(response.into_body(), 8 * 1024 * 1024).await else {
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        };
        image_bytes += bytes.len();
        if image_bytes > 10 * 1024 * 1024 {
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        }
        images.insert(
            path,
            json!(format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )),
        );
    }
    let theme = if scope.theme.as_deref() == Some("light") {
        "light"
    } else {
        "dark"
    };
    let snapshot = json!({"title": title, "createdAt": created_at, "turnCount": turns.len(), "turns": turns, "theme":theme, "images":images});
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_projection_omits_operations_and_intermediate_replies() {
        let turn = json!({"status":"completed","items":[
            {"kind":"userMessage","text":"prompt","artifact":{"secret":"path"}},
            {"kind":"agentMessage","phase":"commentary","text":"thinking"},
            {"kind":"commandExecution","text":"secret command output"},
            {"kind":"userMessage","text":"steer"},
            {"kind":"agentMessage","text":"answer","internal":"secret"}
        ]});
        let result = messages(&turn);
        assert_eq!(result.len(), 3);
        assert_eq!(result[2]["text"], "answer");
        assert!(!serde_json::to_string(&result).unwrap().contains("secret"));
        let mut active = turn.clone();
        active["status"] = json!("inProgress");
        assert_eq!(messages(&active).len(), 2);
    }
}
