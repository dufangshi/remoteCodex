use std::env;
use std::path::PathBuf;

use remote_codex_protocol::{Mode, Provider};

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub mode: Mode,
    pub host: String,
    pub port: u16,
    pub workspace_root: PathBuf,
    pub database_url: PathBuf,
    pub app_name: String,
    pub app_version: String,
    pub environment: String,
    pub auth_required: bool,
    pub admin_username: Option<String>,
    pub admin_password: Option<String>,
    pub session_secret: Option<String>,
    pub relay_server_url: Option<String>,
    pub relay_agent_token: Option<String>,
    pub enabled_providers: Vec<Provider>,
    pub acp_command: Option<String>,
    pub acp_startup_timeout_ms: u64,
    pub fake_runtime: bool,
}

impl RuntimeConfig {
    pub fn from_env() -> Self {
        let mode = match env::var("REMOTE_CODEX_MODE").unwrap_or_default().as_str() {
            "server" => Mode::Server,
            "relay" => Mode::Relay,
            _ => Mode::Local,
        };
        let port = env::var("PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8787);
        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
        let workspace_root = PathBuf::from(
            env::var("WORKSPACE_ROOT").unwrap_or_else(|_| default_workspace_root()),
        );
        let database_url = PathBuf::from(
            env::var("DATABASE_URL").unwrap_or_else(|_| default_database_path()),
        );
        let enabled_providers = parse_providers(
            env::var("REMOTE_CODEX_ENABLED_AGENT_PROVIDERS").ok().as_deref(),
        );
        let fake_runtime = env_flag("REMOTE_CODEX_E2E_FAKE_RUNTIME");
        Self {
            mode,
            host,
            port,
            workspace_root,
            database_url,
            app_name: env::var("APP_NAME").unwrap_or_else(|_| "Remote Codex".into()),
            app_version: remote_codex_protocol::APP_VERSION.to_string(),
            environment: env::var("NODE_ENV").unwrap_or_else(|_| "development".into()),
            auth_required: mode != Mode::Local,
            admin_username: env::var("REMOTE_CODEX_ADMIN_USERNAME").ok(),
            admin_password: env::var("REMOTE_CODEX_ADMIN_PASSWORD").ok(),
            session_secret: env::var("REMOTE_CODEX_SESSION_SECRET").ok(),
            relay_server_url: env::var("REMOTE_CODEX_RELAY_SERVER_URL").ok(),
            relay_agent_token: env::var("REMOTE_CODEX_RELAY_AGENT_TOKEN").ok(),
            enabled_providers,
            acp_command: env::var("ACP_COMMAND").ok().filter(|s| !s.trim().is_empty()),
            acp_startup_timeout_ms: env::var("ACP_STARTUP_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20_000),
            fake_runtime,
        }
    }
}

fn env_flag(name: &str) -> bool {
    matches!(
        env::var(name).unwrap_or_default().to_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn parse_providers(raw: Option<&str>) -> Vec<Provider> {
    if let Some(raw) = raw.filter(|s| !s.trim().is_empty()) {
        return raw
            .split(',')
            .filter_map(|part| match part.trim() {
                "codex" => Some(Provider::Codex),
                "claude" => Some(Provider::Claude),
                "opencode" => Some(Provider::Opencode),
                "acp" => Some(Provider::Acp),
                _ => None,
            })
            .collect();
    }
    vec![
        Provider::Codex,
        Provider::Claude,
        Provider::Opencode,
        Provider::Acp,
    ]
}

fn default_workspace_root() -> String {
    dirs_fallback().join("workspaces").to_string_lossy().into()
}

fn default_database_path() -> String {
    dirs_fallback().join("supervisor.sqlite").to_string_lossy().into()
}

fn dirs_fallback() -> PathBuf {
    env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".remote-codex")
}
