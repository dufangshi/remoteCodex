//! User-owned adapter installations. Never alter the user's npm prefix or PATH.
use super::catalog::{command_available, AcpAgentDef};
use anyhow::{anyhow, bail, Context, Result};
use std::{path::PathBuf, sync::OnceLock, time::Duration};
use tokio::sync::Mutex;

pub fn prefix() -> PathBuf {
    crate::config::home_dir().join(".local/share/remote-codex/adapters")
}

pub fn bin_dir() -> PathBuf {
    if cfg!(windows) {
        prefix()
    } else {
        prefix().join("bin")
    }
}

pub fn package(id: &str) -> Option<&'static str> {
    match id {
        "codex" => Some("@agentclientprotocol/codex-acp"),
        "claude" => Some("@agentclientprotocol/claude-agent-acp"),
        _ => None,
    }
}

pub fn install_command(id: &str) -> Option<String> {
    Some(command_line(&install_args(id).ok()?))
}

fn command_line(args: &[String]) -> String {
    if cfg!(windows) {
        // npm.cmd is dispatched through cmd.exe; POSIX single quotes would
        // become literal characters in --prefix and --cache paths.
        args.iter()
            .map(|arg| format!("\"{}\"", arg.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        shell_words::join(args)
    }
}

fn install_args(id: &str) -> Result<Vec<String>> {
    let package = package(id).ok_or_else(|| anyhow!("No managed adapter for {id}"))?;
    Ok(vec![
        "npm".into(),
        "install".into(),
        "--global".into(),
        "--prefix".into(),
        prefix().to_string_lossy().into_owned(),
        "--cache".into(),
        prefix().join("cache").to_string_lossy().into_owned(),
        format!("{package}@latest"),
        "--no-audit".into(),
        "--no-fund".into(),
    ])
}

pub async fn ensure(def: &AcpAgentDef, update: bool) -> Result<()> {
    if def.transport != "adapter" {
        return Ok(());
    }
    if !command_available(&def.base_command) {
        bail!("Install the base agent first: {}", def.base_command);
    }
    static INSTALL: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = INSTALL.get_or_init(|| Mutex::new(())).lock().await;
    if !update && command_available(&def.server_command) {
        return Ok(());
    }
    static FAILURES: OnceLock<
        std::sync::Mutex<std::collections::HashMap<PathBuf, (std::time::Instant, String)>>,
    > = OnceLock::new();
    let failures = FAILURES.get_or_init(Default::default);
    let key = prefix().join(&def.id);
    if !update {
        if let Some((at, reason)) = failures.lock().unwrap().get(&key) {
            if at.elapsed() < Duration::from_secs(60) {
                bail!("{reason}; automatic installation retries after 60 seconds. Use Settings > Harnesses > ACP adapter > Install to retry now.");
            }
        }
    }
    let result = install(def).await.map_err(|error| anyhow!(
        "ACP dependency unavailable: {} (package {}). {error:#}. Repair in Settings > Harnesses > ACP adapter",
        def.server_command, package(&def.id).unwrap_or("unknown")));
    match &result {
        Ok(()) => {
            failures.lock().unwrap().remove(&key);
        }
        Err(error) => {
            failures
                .lock()
                .unwrap()
                .insert(key, (std::time::Instant::now(), error.to_string()));
        }
    }
    result
}

async fn install(def: &AcpAgentDef) -> Result<()> {
    let args = install_args(&def.id)?;
    let parsed = super::rpc::parse_spawn_command(&command_line(&args))?;
    tokio::fs::create_dir_all(prefix())
        .await
        .context("Create user-owned ACP adapter directory")?;
    let mut command = tokio::process::Command::new(parsed.program);
    crate::child_process::hide_tokio(&mut command);
    command
        .args(parsed.args)
        .env("PATH", super::catalog::child_path())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let result = tokio::time::timeout(Duration::from_secs(300), command.output())
        .await
        .context("ACP adapter installation timed out")??;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let detail: String = stderr
            .chars()
            .rev()
            .take(4000)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        bail!(
            "Install {} in {} failed ({}): {}",
            def.display_name,
            prefix().display(),
            result.status,
            detail.trim()
        );
    }
    if !super::catalog::resolve_executable(&def.server_command)
        .is_some_and(|path| path.starts_with(bin_dir()))
    {
        bail!(
            "Adapter installation completed but {} is not executable",
            def.server_command
        );
    }
    Ok(())
}
