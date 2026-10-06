//! UI preferences belong to the authenticated account, independently of devices.
use super::*;

pub(super) fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS relay_account_preferences (
            user_id TEXT PRIMARY KEY REFERENCES relay_users(id) ON DELETE CASCADE,
            send_shortcut TEXT NOT NULL CHECK (send_shortcut IN ('ctrlEnter','enter'))
        );",
    )?;
    Ok(())
}

pub(super) fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/relay/account/preferences", get(load).patch(save))
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum SendShortcut {
    #[default]
    CtrlEnter,
    Enter,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Preferences {
    send_shortcut: SendShortcut,
}

fn snapshot(conn: &Connection, user_id: &str) -> Result<Preferences> {
    let shortcut: Option<String> = conn
        .query_row(
            "SELECT send_shortcut FROM relay_account_preferences WHERE user_id=?1",
            [user_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(Preferences {
        send_shortcut: if shortcut.as_deref() == Some("enter") {
            SendShortcut::Enter
        } else {
            SendShortcut::CtrlEnter
        },
    })
}

fn response(preferences: Preferences) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(preferences)).into_response()
}

async fn load(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> Response {
    let conn = state.store.conn.lock().await;
    let Some(user) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    match snapshot(&conn, &user.id) {
        Ok(preferences) => response(preferences),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn save(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(preferences): Json<Preferences>,
) -> Response {
    let conn = state.store.conn.lock().await;
    let Some(user) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let shortcut = match preferences.send_shortcut {
        SendShortcut::CtrlEnter => "ctrlEnter",
        SendShortcut::Enter => "enter",
    };
    if conn
        .execute(
            "INSERT INTO relay_account_preferences(user_id,send_shortcut) VALUES (?1,?2)
         ON CONFLICT(user_id) DO UPDATE SET send_shortcut=excluded.send_shortcut",
            params![user.id, shortcut],
        )
        .is_err()
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    response(preferences)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn shortcuts_follow_the_account_across_sessions_and_persist() {
        let (state, data_dir) = crate::tests::test_app_state("account-preferences");
        let (owner, owner_other_browser, stranger) = {
            let conn = state.store.conn.lock().await;
            conn.execute_batch(
                "INSERT INTO relay_users VALUES
                ('owner','o@test','owner','user',1,NULL,'now','salt','hash'),
                ('stranger','s@test','stranger','user',1,NULL,'now','salt','hash');",
            )
            .unwrap();
            (
                create_session(&conn, &state.store.session_secret, "owner").unwrap(),
                create_session(&conn, &state.store.session_secret, "owner").unwrap(),
                create_session(&conn, &state.store.session_secret, "stranger").unwrap(),
            )
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "http://{}/relay/account/preferences",
            listener.local_addr().unwrap()
        );
        let app = routes().with_state(state.clone());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::new();
        assert_eq!(
            client.get(&url).send().await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .patch(&url)
                .json(&json!({"sendShortcut":"enter"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        for body in [
            json!({"sendShortcut":"invalid"}),
            json!({"sendShortcut":"enter","userId":"stranger"}),
        ] {
            assert_eq!(
                client
                    .patch(&url)
                    .bearer_auth(&owner)
                    .json(&body)
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        let saved = client
            .patch(&url)
            .bearer_auth(&owner)
            .json(&json!({"sendShortcut":"enter"}))
            .send()
            .await
            .unwrap();
        assert_eq!(saved.status(), StatusCode::OK);
        assert_eq!(
            saved.json::<Value>().await.unwrap(),
            json!({"sendShortcut":"enter"})
        );
        let other_session = client
            .get(&url)
            .bearer_auth(&owner_other_browser)
            .send()
            .await
            .unwrap();
        assert_eq!(other_session.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            other_session.json::<Value>().await.unwrap(),
            json!({"sendShortcut":"enter"})
        );
        assert_eq!(
            client
                .get(&url)
                .bearer_auth(&stranger)
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap(),
            json!({"sendShortcut":"ctrlEnter"})
        );
        server.abort();
        let _ = server.await;
        drop(state);
        let reopened =
            RelayStore::open(data_dir.join("relay-store.sqlite"), "test-secret".into()).unwrap();
        let conn = reopened.conn.lock().await;
        assert_eq!(
            serde_json::to_value(snapshot(&conn, "owner").unwrap()).unwrap(),
            json!({"sendShortcut":"enter"})
        );
        conn.execute("DELETE FROM relay_users WHERE id='owner'", [])
            .unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM relay_account_preferences",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        drop(conn);
        drop(reopened);
        std::fs::remove_dir_all(data_dir).unwrap();
    }
}
