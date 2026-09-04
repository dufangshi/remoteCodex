use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Result};
use axum::http::{header, HeaderMap};
use base64::Engine;
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use subtle::ConstantTimeEq;
use url::Url;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OAuthProvider {
    Google,
    Github,
}

impl OAuthProvider {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "google" => Some(Self::Google),
            "github" => Some(Self::Github),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Google => "google",
            Self::Github => "github",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Google => "Google",
            Self::Github => "GitHub",
        }
    }
}

#[derive(Clone, Debug)]
struct OAuthCredentials {
    client_id: String,
    client_secret: String,
}

#[derive(Clone, Debug)]
pub struct OAuthConfig {
    pub public_base_url: Option<String>,
    google: Option<OAuthCredentials>,
    github: Option<OAuthCredentials>,
    google_enabled_by_env: bool,
    github_enabled_by_env: bool,
    google_authorize_url: String,
    google_token_url: String,
    google_userinfo_url: String,
    github_authorize_url: String,
    github_token_url: String,
    github_user_url: String,
    github_emails_url: String,
}

impl Default for OAuthConfig {
    fn default() -> Self {
        Self {
            public_base_url: None,
            google: None,
            github: None,
            google_enabled_by_env: true,
            github_enabled_by_env: true,
            google_authorize_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            google_token_url: "https://oauth2.googleapis.com/token".into(),
            google_userinfo_url: "https://openidconnect.googleapis.com/v1/userinfo".into(),
            github_authorize_url: "https://github.com/login/oauth/authorize".into(),
            github_token_url: "https://github.com/login/oauth/access_token".into(),
            github_user_url: "https://api.github.com/user".into(),
            github_emails_url: "https://api.github.com/user/emails".into(),
        }
    }
}

impl OAuthConfig {
    pub fn from_env() -> Self {
        let google = credentials(
            "REMOTE_CODEX_GOOGLE_OAUTH_CLIENT_ID",
            "REMOTE_CODEX_GOOGLE_OAUTH_CLIENT_SECRET",
        );
        let github = credentials(
            "REMOTE_CODEX_GITHUB_OAUTH_CLIENT_ID",
            "REMOTE_CODEX_GITHUB_OAUTH_CLIENT_SECRET",
        );
        Self {
            public_base_url: nonempty_env("REMOTE_CODEX_PUBLIC_BASE_URL")
                .map(|value| value.trim_end_matches('/').to_string()),
            google,
            github,
            google_enabled_by_env: nonempty_env("REMOTE_CODEX_GOOGLE_OAUTH_ENABLED").as_deref()
                != Some("false"),
            github_enabled_by_env: nonempty_env("REMOTE_CODEX_GITHUB_OAUTH_ENABLED").as_deref()
                != Some("false"),
            google_authorize_url: endpoint(
                "REMOTE_CODEX_GOOGLE_OAUTH_AUTHORIZE_URL",
                "https://accounts.google.com/o/oauth2/v2/auth",
            ),
            google_token_url: endpoint(
                "REMOTE_CODEX_GOOGLE_OAUTH_TOKEN_URL",
                "https://oauth2.googleapis.com/token",
            ),
            google_userinfo_url: endpoint(
                "REMOTE_CODEX_GOOGLE_OAUTH_USERINFO_URL",
                "https://openidconnect.googleapis.com/v1/userinfo",
            ),
            github_authorize_url: endpoint(
                "REMOTE_CODEX_GITHUB_OAUTH_AUTHORIZE_URL",
                "https://github.com/login/oauth/authorize",
            ),
            github_token_url: endpoint(
                "REMOTE_CODEX_GITHUB_OAUTH_TOKEN_URL",
                "https://github.com/login/oauth/access_token",
            ),
            github_user_url: endpoint(
                "REMOTE_CODEX_GITHUB_OAUTH_USER_URL",
                "https://api.github.com/user",
            ),
            github_emails_url: endpoint(
                "REMOTE_CODEX_GITHUB_OAUTH_EMAILS_URL",
                "https://api.github.com/user/emails",
            ),
        }
    }

    #[cfg(test)]
    pub fn for_test(
        public_base_url: String,
        google: Option<(String, String)>,
        github: Option<(String, String)>,
        endpoint_base: &str,
    ) -> Self {
        Self {
            public_base_url: Some(public_base_url),
            google: google.map(|(client_id, client_secret)| OAuthCredentials {
                client_id,
                client_secret,
            }),
            github: github.map(|(client_id, client_secret)| OAuthCredentials {
                client_id,
                client_secret,
            }),
            google_enabled_by_env: true,
            github_enabled_by_env: true,
            google_authorize_url: format!("{endpoint_base}/google/authorize"),
            google_token_url: format!("{endpoint_base}/google/token"),
            google_userinfo_url: format!("{endpoint_base}/google/userinfo"),
            github_authorize_url: format!("{endpoint_base}/github/authorize"),
            github_token_url: format!("{endpoint_base}/github/token"),
            github_user_url: format!("{endpoint_base}/github/user"),
            github_emails_url: format!("{endpoint_base}/github/emails"),
        }
    }

    pub fn available(&self, provider: OAuthProvider) -> bool {
        self.credentials(provider).is_some()
    }

    pub fn initially_enabled(&self, provider: OAuthProvider) -> bool {
        self.available(provider)
            && match provider {
                OAuthProvider::Google => self.google_enabled_by_env,
                OAuthProvider::Github => self.github_enabled_by_env,
            }
    }

    pub fn callback_url(&self, headers: &HeaderMap, provider: OAuthProvider) -> String {
        let base = self.public_base_url.clone().unwrap_or_else(|| {
            let protocol =
                first_header(headers, "x-forwarded-proto").unwrap_or_else(|| "http".into());
            let host = first_header(headers, "x-forwarded-host")
                .or_else(|| header_value(headers, header::HOST.as_str()))
                .unwrap_or_else(|| "localhost:8788".into());
            format!("{protocol}://{host}")
        });
        let base = base
            .replacen("ws://", "http://", 1)
            .replacen("wss://", "https://", 1)
            .trim_end_matches('/')
            .to_string();
        format!("{base}/relay/auth/oauth/{}/callback", provider.as_str())
    }

    pub fn authorization_url(
        &self,
        provider: OAuthProvider,
        callback_url: &str,
        state: &str,
    ) -> Result<String> {
        let credentials = self.credentials(provider).ok_or_else(|| {
            anyhow!(
                "{} OAuth credentials are not configured",
                provider.display_name()
            )
        })?;
        let base = match provider {
            OAuthProvider::Google => &self.google_authorize_url,
            OAuthProvider::Github => &self.github_authorize_url,
        };
        let mut url = Url::parse(base)?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("client_id", &credentials.client_id);
            query.append_pair("redirect_uri", callback_url);
            query.append_pair("response_type", "code");
            query.append_pair("state", state);
            query.append_pair(
                "scope",
                match provider {
                    OAuthProvider::Google => "openid email profile",
                    OAuthProvider::Github => "read:user user:email",
                },
            );
            if provider == OAuthProvider::Google {
                query.append_pair("prompt", "select_account");
            }
        }
        Ok(url.to_string())
    }

    pub async fn fetch_identity(
        &self,
        client: &Client,
        provider: OAuthProvider,
        code: &str,
        callback_url: &str,
    ) -> Result<ExternalIdentity> {
        match provider {
            OAuthProvider::Google => self.fetch_google(client, code, callback_url).await,
            OAuthProvider::Github => self.fetch_github(client, code, callback_url).await,
        }
    }

    async fn fetch_google(
        &self,
        client: &Client,
        code: &str,
        callback_url: &str,
    ) -> Result<ExternalIdentity> {
        let credentials = self
            .google
            .as_ref()
            .ok_or_else(|| anyhow!("Google OAuth credentials are not configured"))?;
        let body = form_body(&[
            ("code", code),
            ("client_id", &credentials.client_id),
            ("client_secret", &credentials.client_secret),
            ("redirect_uri", callback_url),
            ("grant_type", "authorization_code"),
        ]);
        let response = client
            .post(&self.google_token_url)
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await?;
        if !response.status().is_success() {
            bail!("Google token exchange failed");
        }
        let token: Value = response.json().await?;
        let access_token = required_string(&token, "access_token", "Google access token")?;
        let response = client
            .get(&self.google_userinfo_url)
            .bearer_auth(access_token)
            .send()
            .await?;
        if !response.status().is_success() {
            bail!("Google profile lookup failed");
        }
        let profile: Value = response.json().await?;
        let subject = required_string(&profile, "sub", "Google subject")?;
        let source_email = required_string(&profile, "email", "Google email")?;
        if profile.get("email_verified").and_then(Value::as_bool) != Some(true) {
            bail!("Google did not provide a verified email address");
        }
        let username = source_email
            .split('@')
            .next()
            .filter(|value| !value.is_empty())
            .or_else(|| profile.get("name").and_then(Value::as_str))
            .unwrap_or("google-user")
            .to_string();
        let email = source_email.to_ascii_lowercase();
        Ok(ExternalIdentity {
            provider: OAuthProvider::Google,
            subject,
            email,
            username,
        })
    }

    async fn fetch_github(
        &self,
        client: &Client,
        code: &str,
        callback_url: &str,
    ) -> Result<ExternalIdentity> {
        let credentials = self
            .github
            .as_ref()
            .ok_or_else(|| anyhow!("GitHub OAuth credentials are not configured"))?;
        let body = form_body(&[
            ("code", code),
            ("client_id", &credentials.client_id),
            ("client_secret", &credentials.client_secret),
            ("redirect_uri", callback_url),
        ]);
        let response = client
            .post(&self.github_token_url)
            .header(header::ACCEPT, "application/json")
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await?;
        if !response.status().is_success() {
            bail!("GitHub token exchange failed");
        }
        let token: Value = response.json().await?;
        let access_token = required_string(&token, "access_token", "GitHub access token")?;
        let request = |url: &str| {
            client
                .get(url)
                .header(header::ACCEPT, "application/vnd.github+json")
                .header(header::USER_AGENT, "remote-codex-relay")
                .bearer_auth(access_token.clone())
        };
        let (user, emails) = tokio::join!(
            request(&self.github_user_url).send(),
            request(&self.github_emails_url).send()
        );
        let user = user?;
        let emails = emails?;
        if !user.status().is_success() || !emails.status().is_success() {
            bail!("GitHub profile lookup failed");
        }
        let user: Value = user.json().await?;
        let emails: Value = emails.json().await?;
        let subject = user
            .get("id")
            .and_then(Value::as_u64)
            .map(|value| value.to_string())
            .ok_or_else(|| anyhow!("GitHub did not provide a user id"))?;
        let username = required_string(&user, "login", "GitHub username")?;
        let email = emails
            .as_array()
            .and_then(|values| {
                values
                    .iter()
                    .find(|value| {
                        value.get("primary").and_then(Value::as_bool) == Some(true)
                            && value.get("verified").and_then(Value::as_bool) == Some(true)
                    })
                    .or_else(|| {
                        values.iter().find(|value| {
                            value.get("verified").and_then(Value::as_bool) == Some(true)
                        })
                    })
            })
            .and_then(|value| value.get("email"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_ascii_lowercase)
            .ok_or_else(|| anyhow!("GitHub did not provide a verified email address"))?;
        Ok(ExternalIdentity {
            provider: OAuthProvider::Github,
            subject,
            email,
            username,
        })
    }

    fn credentials(&self, provider: OAuthProvider) -> Option<&OAuthCredentials> {
        match provider {
            OAuthProvider::Google => self.google.as_ref(),
            OAuthProvider::Github => self.github.as_ref(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct ExternalIdentity {
    pub provider: OAuthProvider,
    pub subject: String,
    pub email: String,
    pub username: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthState {
    provider: String,
    expires_at: u64,
    nonce: String,
}

pub fn sign_state(provider: OAuthProvider, secret: &str) -> Result<String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let mut nonce = [0_u8; 18];
    OsRng.fill_bytes(&mut nonce);
    let payload = OAuthState {
        provider: provider.as_str().to_string(),
        expires_at: now + 10 * 60 * 1000,
        nonce: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(nonce),
    };
    let payload =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload)?);
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())?;
    mac.update(payload.as_bytes());
    let signature =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    Ok(format!("{payload}.{signature}"))
}

pub fn verify_state(state: &str, provider: OAuthProvider, secret: &str) -> bool {
    let Some((payload, signature)) = state.split_once('.') else {
        return false;
    };
    if payload.is_empty() || signature.is_empty() || signature.contains('.') {
        return false;
    }
    let Ok(actual) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(signature) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(payload.as_bytes());
    let expected = mac.finalize().into_bytes();
    if actual.len() != expected.len() || !bool::from(actual.ct_eq(expected.as_slice())) {
        return false;
    }
    let Ok(payload) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload) else {
        return false;
    };
    let Ok(payload) = serde_json::from_slice::<OAuthState>(&payload) else {
        return false;
    };
    let Ok(now) = SystemTime::now().duration_since(UNIX_EPOCH) else {
        return false;
    };
    payload.provider == provider.as_str()
        && payload.expires_at > now.as_millis() as u64
        && !payload.nonce.is_empty()
}

fn credentials(client_id: &str, client_secret: &str) -> Option<OAuthCredentials> {
    Some(OAuthCredentials {
        client_id: nonempty_env(client_id)?,
        client_secret: nonempty_env(client_secret)?,
    })
}

fn nonempty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn endpoint(name: &str, default: &str) -> String {
    nonempty_env(name).unwrap_or_else(|| default.to_string())
}

fn first_header(headers: &HeaderMap, name: &str) -> Option<String> {
    header_value(headers, name)
        .and_then(|value| value.split(',').next().map(str::trim).map(str::to_string))
        .filter(|value| !value.is_empty())
}

fn header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn form_body(values: &[(&str, &str)]) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    serializer.extend_pairs(values.iter().copied());
    serializer.finish()
}

fn required_string(value: &Value, key: &str, label: &str) -> Result<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| anyhow!("{label} is missing"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::Request;
    use axum::{Json, Router};
    use serde_json::json;

    async fn fake_oauth_provider(request: Request) -> Json<Value> {
        let value = match request.uri().path() {
            "/google/token" => json!({ "access_token": "google-token" }),
            "/google/userinfo" => json!({
                "sub": "google-subject",
                "email": "Google.User@Example.test",
                "email_verified": true,
                "name": "Google User"
            }),
            "/github/token" => json!({ "access_token": "github-token" }),
            "/github/user" => json!({ "id": 42, "login": "octocat" }),
            "/github/emails" => json!([
                { "email": "other@example.test", "verified": true, "primary": false },
                { "email": "Primary@Example.test", "verified": true, "primary": true }
            ]),
            _ => json!({}),
        };
        Json(value)
    }

    async fn fake_oauth_server() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, Router::new().fallback(fake_oauth_provider))
                .await
                .unwrap();
        });
        format!("http://{address}")
    }

    #[test]
    fn oauth_state_round_trips_and_is_provider_bound() {
        let state = sign_state(OAuthProvider::Google, "0123456789abcdef").unwrap();
        assert!(verify_state(
            &state,
            OAuthProvider::Google,
            "0123456789abcdef"
        ));
        assert!(!verify_state(
            &state,
            OAuthProvider::Github,
            "0123456789abcdef"
        ));
        assert!(!verify_state(
            &state,
            OAuthProvider::Google,
            "different-secret"
        ));
    }

    #[test]
    fn callback_prefers_configured_public_url() {
        let config = OAuthConfig::for_test(
            "https://relay.example.test/".into(),
            Some(("client".into(), "secret".into())),
            None,
            "http://127.0.0.1:1",
        );
        assert_eq!(
            config.callback_url(&HeaderMap::new(), OAuthProvider::Google),
            "https://relay.example.test/relay/auth/oauth/google/callback"
        );
    }

    #[tokio::test]
    async fn google_and_github_verified_profiles_map_to_external_identities() {
        let endpoint = fake_oauth_server().await;
        let config = OAuthConfig::for_test(
            "https://relay.example.test".into(),
            Some(("google-client".into(), "google-secret".into())),
            Some(("github-client".into(), "github-secret".into())),
            &endpoint,
        );
        let client = Client::new();
        let google = config
            .fetch_identity(
                &client,
                OAuthProvider::Google,
                "code",
                "https://relay.example.test/relay/auth/oauth/google/callback",
            )
            .await
            .unwrap();
        assert_eq!(google.subject, "google-subject");
        assert_eq!(google.email, "google.user@example.test");
        assert_eq!(google.username, "Google.User");

        let github = config
            .fetch_identity(
                &client,
                OAuthProvider::Github,
                "code",
                "https://relay.example.test/relay/auth/oauth/github/callback",
            )
            .await
            .unwrap();
        assert_eq!(github.subject, "42");
        assert_eq!(github.email, "primary@example.test");
        assert_eq!(github.username, "octocat");
    }
}
