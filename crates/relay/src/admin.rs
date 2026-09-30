//! Relay administration API: the admin summary, registration approval,
//! user enable/reset/delete, and the hosted-sandbox lifecycle handlers.
//! Split out of lib.rs so the privileged surface sits in one reviewable file.
use super::*;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminQuery {
    token: Option<String>,
    relay_session: Option<String>,
    days: Option<u32>,
}

impl AdminQuery {
    fn token_query(&self) -> TokenQuery {
        TokenQuery {
            token: self.token.clone(),
            device_token: None,
            relay_session: self.relay_session.clone(),
        }
    }
}

pub(crate) async fn relay_admin(
    headers: HeaderMap,
    Query(query): Query<AdminQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let connected: Vec<String> = state.sockets.read().await.keys().cloned().collect();
    let conn = state.store.conn.lock().await;
    if authenticated_admin_user(
        &conn,
        &state.store.session_secret,
        &headers,
        &query.token_query(),
    )
    .is_none()
    {
        return unauthorized();
    }
    let conversation_window_days = query.days.unwrap_or(7).clamp(1, 365);
    let has_conversations = table_exists(&conn, "relay_conversation_events");
    let mut stmt = match conn.prepare(
        "SELECT id,email,username,role,enabled,last_seen_at,created_at FROM relay_users ORDER BY created_at ASC",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let users: Vec<Value> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let device_count = conn
                .query_row(
                    "SELECT COUNT(*) FROM relay_devices WHERE owner_user_id=?1",
                    params![id],
                    |count| count.get::<_, i64>(0),
                )
                .unwrap_or(0);
            let conversation_count = if has_conversations {
                conn.query_row(
                    "SELECT COUNT(*) FROM relay_conversation_events WHERE user_id=?1",
                    params![id],
                    |count| count.get::<_, i64>(0),
                )
                .unwrap_or(0)
            } else {
                0
            };
            Ok(json!({
                "id": id,
                "email": row.get::<_, String>(1)?,
                "username": row.get::<_, String>(2)?,
                "role": row.get::<_, String>(3)?,
                "enabled": row.get::<_, i64>(4)? == 1,
                "lastSeenAt": row.get::<_, Option<String>>(5)?,
                "createdAt": row.get::<_, String>(6)?,
                "deviceCount": device_count,
                "conversationCount": conversation_count
            }))
        })
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();
    drop(stmt);

    let mut stmt = match conn.prepare(
        "SELECT d.id,d.owner_user_id,d.name,d.token,d.token_preview,d.created_at,u.username,u.email
         FROM relay_devices d JOIN relay_users u ON u.id=d.owner_user_id ORDER BY d.created_at ASC",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let devices: Vec<Value> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let hosted: Option<(String, i64, Option<String>)> = conn
                .query_row(
                    "SELECT status,active_turn_count,idle_deadline_at
                     FROM relay_hosted_sandboxes WHERE device_id=?1",
                    params![id],
                    |hosted| Ok((hosted.get(0)?, hosted.get(1)?, hosted.get(2)?)),
                )
                .optional()?;
            Ok(json!({
                "id": id,
                "ownerUserId": row.get::<_, String>(1)?,
                "name": row.get::<_, String>(2)?,
                "token": if hosted.is_some() { None } else { row.get::<_, Option<String>>(3)? },
                "tokenPreview": row.get::<_, String>(4)?,
                "connected": connected.iter().any(|connected_id| connected_id == &id),
                "connectedAt": Value::Null,
                "lastHeartbeatAt": Value::Null,
                "createdAt": row.get::<_, String>(5)?,
                "ownerUsername": row.get::<_, String>(6)?,
                "ownerEmail": row.get::<_, String>(7)?,
                "ipAddress": Value::Null,
                "workspaces": [],
                "threads": [],
                "hostedStatus": hosted.as_ref().map(|value| value.0.as_str()),
                "hostedActiveTurnCount": hosted.as_ref().map(|value| value.1).unwrap_or(0),
                "hostedIdleDeadlineAt": hosted.and_then(|value| value.2)
            }))
        })
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();
    drop(stmt);

    let user_ids: Vec<String> = users
        .iter()
        .filter_map(|user| user.get("id").and_then(Value::as_str).map(str::to_string))
        .collect();
    let shares: Vec<Value> = user_ids
        .iter()
        .flat_map(|id| relay_shares_for(&conn, "owner_user_id", id))
        .collect();
    let grants: Vec<Value> = user_ids
        .iter()
        .flat_map(|id| relay_grants_for(&conn, "owner_user_id", id))
        .collect();
    let pending_registrations = if table_exists(&conn, "relay_pending_registrations") {
        conn.prepare(
            "SELECT id,email,username,created_at,provider FROM relay_pending_registrations
             WHERE status='pending' ORDER BY created_at ASC",
        )
        .ok()
        .and_then(|mut stmt| {
            stmt.query_map([], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "email": row.get::<_, String>(1)?,
                    "username": row.get::<_, String>(2)?,
                    "createdAt": row.get::<_, String>(3)?,
                    "provider": row.get::<_, String>(4)?
                }))
            })
            .ok()
            .map(|rows| rows.flatten().collect::<Vec<_>>())
        })
        .unwrap_or_default()
    } else {
        Vec::new()
    };
    let settings = registration_settings(&conn, &state.oauth);
    let registration_enabled = settings
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    Json(json!({
        "users": users,
        "devices": devices,
        "shares": shares,
        "grants": grants,
        "pendingRegistrations": pending_registrations,
        "settings": settings,
        "conversationWindowDays": conversation_window_days,
        "registrationEnabled": registration_enabled
    }))
    .into_response()
}

pub(crate) async fn hosted_sandbox_capability(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    Json(state.hosted.capability().await).into_response()
}

pub(crate) async fn hosted_admin_allowed(
    state: &AppState,
    headers: &HeaderMap,
    query: &TokenQuery,
) -> bool {
    let conn = state.store.conn.lock().await;
    authenticated_admin_user(&conn, &state.store.session_secret, headers, query).is_some()
}

pub(crate) fn hosted_response(result: std::result::Result<Value, hosted::HostedError>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => {
            (error.status, Json(ApiError::new(error.code, error.message))).into_response()
        }
    }
}

pub(crate) async fn list_hosted_sandboxes(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(state.hosted.list().await)
}

pub(crate) async fn create_hosted_sandbox(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<hosted::CreateHostedInput>,
) -> Response {
    let admin = {
        let conn = state.store.conn.lock().await;
        authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query)
    };
    let Some(admin) = admin else {
        return unauthorized();
    };
    hosted_response(state.hosted.create(&admin.id, body).await)
}

pub(crate) async fn get_hosted_sandbox(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(state.hosted.detail(&sandbox_id).await)
}

pub(crate) async fn update_hosted_sandbox_members(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<hosted::HostedMembersInput>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    let result = state
        .hosted
        .update_members(&sandbox_id, &body.assigned_user_ids)
        .await;
    if let Ok(value) = &result {
        if value
            .get("workspaceIsolationEnabled")
            .and_then(Value::as_bool)
            == Some(true)
        {
            if let Some(device_id) = value.get("deviceId").and_then(Value::as_str) {
                schedule_hosted_bootstraps(state.clone(), device_id.to_string()).await;
            }
        }
    }
    hosted_response(result)
}

pub(crate) async fn update_hosted_sandbox_settings(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<hosted::HostedSettingsInput>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    let result = state
        .hosted
        .update_settings(&sandbox_id, body.workspace_isolation_enabled)
        .await;
    if body.workspace_isolation_enabled {
        if let Ok(value) = &result {
            if let Some(device_id) = value.get("deviceId").and_then(Value::as_str) {
                schedule_hosted_bootstraps(state.clone(), device_id.to_string()).await;
            }
        }
    }
    hosted_response(result)
}

pub(crate) async fn retry_hosted_sandbox(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(state.hosted.retry(&sandbox_id).await)
}

pub(crate) async fn start_hosted_sandbox(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(state.hosted.start(&sandbox_id).await)
}

pub(crate) async fn stop_hosted_sandbox(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(state.hosted.stop(&sandbox_id).await)
}

pub(crate) async fn snapshot_hosted_sandbox(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<hosted::HostedSnapshotInput>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(state.hosted.snapshot(&sandbox_id, &body.name).await)
}

pub(crate) async fn delete_hosted_sandbox(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(state.hosted.delete(&sandbox_id).await)
}

pub(crate) async fn rotate_hosted_sandbox_credential(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<hosted::RotateCredentialInput>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(
        state
            .hosted
            .rotate_credential(&sandbox_id, &body.openai_api_key)
            .await,
    )
}

pub(crate) async fn read_hosted_codex_files(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(state.hosted.read_codex_files(&sandbox_id).await)
}

pub(crate) async fn write_hosted_codex_files(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<hosted::CodexFiles>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(state.hosted.write_codex_files(&sandbox_id, &body).await)
}

pub(crate) async fn hosted_reconciliation(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    Json(state.hosted.reconciliation().await).into_response()
}

pub(crate) async fn run_hosted_reconciliation(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    Json(state.hosted.run_reconciliation().await).into_response()
}

pub(crate) async fn delete_hosted_orphan_instance(
    Path(sandbox_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(state.hosted.delete_orphan_instance(&sandbox_id).await)
}

pub(crate) async fn delete_hosted_orphan_credential(
    Path(credential_ref): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !hosted_admin_allowed(&state, &headers, &query).await {
        return unauthorized();
    }
    hosted_response(state.hosted.delete_orphan_credential(&credential_ref).await)
}

pub(crate) fn set_relay_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO relay_settings(key,value) VALUES (?1,?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub(crate) async fn update_registration_settings(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    if authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query).is_none() {
        return unauthorized();
    }
    if body.get("googleAuthEnabled").and_then(Value::as_bool) == Some(true)
        && !state.oauth.available(OAuthProvider::Google)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "Google OAuth credentials are not configured.",
            )),
        )
            .into_response();
    }
    if body.get("githubAuthEnabled").and_then(Value::as_bool) == Some(true)
        && !state.oauth.available(OAuthProvider::Github)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "GitHub OAuth credentials are not configured.",
            )),
        )
            .into_response();
    }
    if body
        .get("emailVerificationEnabled")
        .and_then(Value::as_bool)
        == Some(true)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "Email verification is not configured in the Rust relay.",
            )),
        )
            .into_response();
    }
    if let Some(enabled) = body.get("enabled").and_then(Value::as_bool) {
        let _ = set_relay_setting(
            &conn,
            "registrationEnabled",
            if enabled { "true" } else { "false" },
        );
    }
    if let Some(approval) = body.get("approvalRequired").and_then(Value::as_bool) {
        let _ = set_relay_setting(
            &conn,
            "registrationApprovalRequired",
            if approval { "true" } else { "false" },
        );
    }
    for (key, value) in [
        (
            "googleAuthEnabled",
            body.get("googleAuthEnabled").and_then(Value::as_bool),
        ),
        (
            "githubAuthEnabled",
            body.get("githubAuthEnabled").and_then(Value::as_bool),
        ),
        (
            "emailVerificationEnabled",
            body.get("emailVerificationEnabled")
                .and_then(Value::as_bool),
        ),
    ] {
        if let Some(value) = value {
            let _ = set_relay_setting(&conn, key, if value { "true" } else { "false" });
        }
    }
    if let Some(password) = body.get("registrationPassword") {
        match password {
            Value::Null => {
                let _ = conn.execute(
                    "DELETE FROM relay_settings WHERE key='registrationPassword'",
                    [],
                );
            }
            Value::String(password) if password.trim().len() >= 8 => {
                let _ = set_relay_setting(&conn, "registrationPassword", password.trim());
            }
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ApiError::new(
                        "bad_request",
                        "Registration password must be at least 8 characters",
                    )),
                )
                    .into_response();
            }
        }
    }
    let settings = registration_settings(&conn, &state.oauth);
    Json(json!({
        "registrationEnabled": settings.get("enabled").cloned().unwrap_or(Value::Bool(true)),
        "settings": settings
    }))
    .into_response()
}

#[derive(Deserialize)]
pub(crate) struct SetUserEnabledInput {
    enabled: bool,
}

pub(crate) async fn set_user_enabled(
    Path(user_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<SetUserEnabledInput>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    if authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query).is_none() {
        return unauthorized();
    }
    let Some(user) = load_user_by_id(&conn, &user_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "User not found")),
        )
            .into_response();
    };
    if user.role == "admin" && !body.enabled {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "The admin user cannot be disabled",
            )),
        )
            .into_response();
    }
    if conn
        .execute(
            "UPDATE relay_users SET enabled=?1 WHERE id=?2",
            params![body.enabled as i64, user_id],
        )
        .is_err()
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let updated = load_user_by_id(&conn, &user_id).unwrap_or(user);
    Json(user_json(&updated)).into_response()
}

pub(crate) async fn admin_delete_user(
    Path(user_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    if authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query).is_none() {
        return unauthorized();
    }
    let Some(user) = load_user_by_id(&conn, &user_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "User not found")),
        )
            .into_response();
    };
    if user.role == "admin" {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "The admin user cannot be deleted",
            )),
        )
            .into_response();
    }
    let sole_hosted_member = conn
        .query_row(
            "SELECT 1 FROM relay_hosted_sandbox_members m
             WHERE m.user_id=?1 AND (
               SELECT COUNT(*) FROM relay_hosted_sandbox_members all_members
               WHERE all_members.sandbox_id=m.sandbox_id
             )=1 LIMIT 1",
            params![user_id],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some();
    if sole_hosted_member {
        return (
            StatusCode::CONFLICT,
            Json(ApiError::new(
                "conflict",
                "Reassign or delete the user's hosted VM before deleting this account.",
            )),
        )
            .into_response();
    }
    if conn
        .execute("DELETE FROM relay_users WHERE id=?1", params![user_id])
        .is_err()
    {
        return (
            StatusCode::CONFLICT,
            Json(ApiError::new(
                "conflict",
                "User still owns relay resources that must be reassigned",
            )),
        )
            .into_response();
    }
    Json(json!({ "id": user_id })).into_response()
}

#[derive(Deserialize)]
pub(crate) struct ResetPasswordInput {
    password: String,
}

pub(crate) async fn admin_reset_password(
    Path(user_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<ResetPasswordInput>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    if authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query).is_none() {
        return unauthorized();
    }
    let Some(user) = load_user_by_id(&conn, &user_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "User not found")),
        )
            .into_response();
    };
    if user.role == "admin" || body.password.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "Only non-admin users can be reset to a password of at least 8 characters",
            )),
        )
            .into_response();
    }
    let Ok((salt, hash)) = hash_password(&body.password) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    if conn
        .execute(
            "UPDATE relay_users SET password_salt=?1,password_hash=?2 WHERE id=?3",
            params![salt, hash, user_id],
        )
        .is_err()
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    Json(user_json(&user)).into_response()
}

pub(crate) async fn approve_registration(
    Path(request_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let conn = state.store.conn.lock().await;
    let Some(admin) =
        authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let record: Option<(String, String, String, String, String, Option<String>)> = conn
        .query_row(
            "SELECT email,username,password_salt,password_hash,provider,provider_subject
             FROM relay_pending_registrations WHERE id=?1 AND status='pending'",
            params![request_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten();
    let Some((email, username, salt, hash, provider, provider_subject)) = record else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new(
                "not_found",
                "Pending registration was not found.",
            )),
        )
            .into_response();
    };
    let duplicate = conn
        .query_row(
            "SELECT 1 FROM relay_users WHERE email=?1 OR username=?2 LIMIT 1",
            params![email, username],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some();
    if duplicate {
        return (
            StatusCode::CONFLICT,
            Json(ApiError::new(
                "conflict",
                "A user with that email or username already exists.",
            )),
        )
            .into_response();
    }
    let user_id = Uuid::new_v4().to_string();
    let now = now_rfc3339();
    let result = (|| -> Result<()> {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO relay_users
             (id,email,username,password_hash,password_salt,role,enabled,last_seen_at,created_at)
             VALUES (?1,?2,?3,?4,?5,'user',1,NULL,?6)",
            params![user_id, email, username, hash, salt, now],
        )?;
        if matches!(provider.as_str(), "google" | "github") {
            if let Some(subject) = provider_subject.as_deref() {
                tx.execute(
                    "INSERT INTO relay_user_identities
                     (id,user_id,provider,provider_subject,provider_email,created_at)
                     VALUES (?1,?2,?3,?4,?5,?6)",
                    params![
                        Uuid::new_v4().to_string(),
                        user_id,
                        provider,
                        subject,
                        email,
                        now
                    ],
                )?;
            }
        }
        tx.execute(
            "UPDATE relay_pending_registrations
             SET status='approved',reviewed_at=?1,reviewed_by_user_id=?2 WHERE id=?3",
            params![now, admin.id, request_id],
        )?;
        tx.commit()?;
        Ok(())
    })();
    if result.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let Some(user) = load_user_by_id(&conn, &user_id) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    Json(user_json(&user)).into_response()
}

pub(crate) async fn reject_registration(
    Path(request_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let conn = state.store.conn.lock().await;
    let Some(admin) =
        authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    match conn.execute(
        "UPDATE relay_pending_registrations
         SET status='rejected',reviewed_at=?1,reviewed_by_user_id=?2
         WHERE id=?3 AND status='pending'",
        params![now_rfc3339(), admin.id, request_id],
    ) {
        Ok(1) => Json(json!({ "id": request_id })).into_response(),
        Ok(_) => (
            StatusCode::NOT_FOUND,
            Json(ApiError::new(
                "not_found",
                "Pending registration was not found.",
            )),
        )
            .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
