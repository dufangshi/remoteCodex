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
        let port_names = if mode == Mode::Relay {
            &["REMOTE_CODEX_RELAY_SUPERVISOR_PORT", "PORT"][..]
        } else {
            &["PORT"][..]
        };
        let port = first_env(port_names)
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8787);
        let host_names = if mode == Mode::Relay {
            &["REMOTE_CODEX_RELAY_SUPERVISOR_HOST", "HOST"][..]
        } else {
            &["HOST"][..]
        };
        let host = first_env(host_names).unwrap_or_else(|_| "127.0.0.1".into());
        let environment = env::var("NODE_ENV").unwrap_or_else(|_| "development".into());
        let workspace_root = PathBuf::from(
            nonempty_env("WORKSPACE_ROOT").unwrap_or_else(|| default_workspace_root()),
        );
        let database_url = PathBuf::from(
            nonempty_env("DATABASE_URL").unwrap_or_else(|| default_database_path(&environment)),
        );
        let enabled_providers = parse_providers(
            env::var("REMOTE_CODEX_ENABLED_AGENT_PROVIDERS")
                .ok()
                .as_deref(),
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
            environment,
            auth_required: mode != Mode::Local,
            admin_username: env::var("REMOTE_CODEX_ADMIN_USERNAME").ok(),
            admin_password: env::var("REMOTE_CODEX_ADMIN_PASSWORD").ok(),
            session_secret: env::var("REMOTE_CODEX_SESSION_SECRET").ok(),
            relay_server_url: env::var("REMOTE_CODEX_RELAY_SERVER_URL").ok(),
            relay_agent_token: env::var("REMOTE_CODEX_RELAY_AGENT_TOKEN").ok(),
            enabled_providers,
            acp_command: env::var("ACP_COMMAND")
                .ok()
                .filter(|s| !s.trim().is_empty()),
            acp_startup_timeout_ms: env::var("ACP_STARTUP_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10_000),
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

fn nonempty_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn first_env(names: &[&str]) -> Result<String, env::VarError> {
    names
        .iter()
        .find_map(|name| nonempty_env(name))
        .ok_or(env::VarError::NotPresent)
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
    if cfg!(windows) {
        return vec![Provider::Codex, Provider::Acp];
    }
    vec![
        Provider::Codex,
        Provider::Claude,
        Provider::Opencode,
        Provider::Acp,
    ]
}

fn default_workspace_root() -> String {
    home_dir().to_string_lossy().into()
}

fn default_database_path(environment: &str) -> String {
    if environment == "production" {
        return home_dir()
            .join(".remote-codex")
            .join("supervisor.sqlite")
            .to_string_lossy()
            .into();
    }
    PathBuf::from(".local")
        .join("supervisor-dev.sqlite")
        .to_string_lossy()
        .into()
}

pub(crate) fn home_dir() -> PathBuf {
    select_home_dir(
        nonempty_env("HOME"),
        nonempty_env("USERPROFILE"),
        nonempty_env("HOMEDRIVE"),
        nonempty_env("HOMEPATH"),
    )
}

fn select_home_dir(
    home: Option<String>,
    user_profile: Option<String>,
    home_drive: Option<String>,
    home_path: Option<String>,
) -> PathBuf {
    home.or(user_profile)
        .map(PathBuf::from)
        .or_else(|| {
            let drive = home_drive?;
            let path = home_path?;
            Some(PathBuf::from(format!("{drive}{path}")))
        })
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_defaults_keep_node_layout() {
        assert_eq!(
            default_database_path("development"),
            PathBuf::from(".local")
                .join("supervisor-dev.sqlite")
                .to_string_lossy()
                .into_owned()
        );
        assert!(PathBuf::from(default_database_path("production"))
            .ends_with(PathBuf::from(".remote-codex").join("supervisor.sqlite")));
    }

    #[test]
    fn home_directory_supports_windows_environment_layouts() {
        assert_eq!(
            select_home_dir(None, Some(r"C:\Users\remote".into()), None, None),
            PathBuf::from(r"C:\Users\remote")
        );
        assert_eq!(
            select_home_dir(
                None,
                None,
                Some("D:".into()),
                Some(r"\Profiles\remote".into())
            ),
            PathBuf::from(r"D:\Profiles\remote")
        );
    }
}
