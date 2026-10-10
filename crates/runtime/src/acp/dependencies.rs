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

pub fn managed_bin_dirs() -> Vec<PathBuf> {
    ["codex", "claude"]
        .iter()
        .filter_map(|id| {
            let file = prefix().join(format!("{id}.active.json"));
            let directory: PathBuf = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
            // Only a completed, user-owned versioned installation can enter PATH.
            (directory.starts_with(prefix().join("installations")) && directory.is_dir()).then_some(
                if cfg!(windows) {
                    directory.clone()
                } else {
                    directory.join("bin")
                },
            )
        })
        .collect()
}
fn install_args(id: &str) -> Result<Vec<String>> {
    args_for(id, &prefix())
}
fn args_for(id: &str, target: &std::path::Path) -> Result<Vec<String>> {
    let package = package(id).ok_or_else(|| anyhow!("No managed adapter for {id}"))?;
    Ok(vec![
        "npm".into(),
        "install".into(),
        "--global".into(),
        "--prefix".into(),
        target.to_string_lossy().into_owned(),
        "--cache".into(),
        prefix().join("cache").to_string_lossy().into_owned(),
        format!("{package}@latest"),
        "--registry=https://registry.npmjs.org".into(),
        "--fetch-retries=3".into(),
        "--fetch-retry-mintimeout=1000".into(),
        "--fetch-retry-maxtimeout=10000".into(),
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
    crate::node_runtime::ensure().await?;
    let root = prefix().join("installations");
    tokio::fs::create_dir_all(&root)
        .await
        .context("Create private ACP adapter directory")?;
    // A fresh prefix avoids npm ENOTEMPTY rename leftovers and preserves the
    // working adapter until a complete replacement has been verified.
    let stage = tempfile::Builder::new()
        .prefix(&format!("{}-", def.id))
        .tempdir_in(&root)?;
    let args = args_for(&def.id, stage.path())?;
    let parsed = super::rpc::parse_spawn_command(&shell_words::join(&args))?;
    let mut command = tokio::process::Command::new(parsed.program);
    crate::child_process::hide_tokio(&mut command);
    command
        .args(parsed.args)
        .env("PATH", super::catalog::child_path())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let result = tokio::time::timeout(Duration::from_secs(300), command.output()).await
        .context("ACP adapter installation timed out; the previous adapter was preserved. Retry Install in Settings")??;
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
        bail!("Install {} failed ({}): {}. The previous adapter was preserved; retry Install in Settings > Harnesses > ACP adapter", def.display_name, result.status, detail.trim());
    }
    let bin = if cfg!(windows) {
        stage.path().to_path_buf()
    } else {
        stage.path().join("bin")
    };
    let exe = super::catalog::command_program(&def.server_command)
        .context("Invalid adapter executable")?;
    let executable = which::which_in(&exe, Some(bin.as_os_str()), stage.path())
        .ok()
        .filter(|path| path.starts_with(stage.path()))
        .context("Installation completed but the staged ACP adapter is not executable")?;
    ensure_staged_target(&executable, stage.path())?;
    let directory = stage.keep();
    let record = prefix().join(format!("{}.active.json", def.id));
    let next = record.with_extension(format!("{}.next", uuid::Uuid::new_v4()));
    let activated = (|| -> Result<()> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&next)?;
        file.write_all(&serde_json::to_vec(&directory)?)?;
        file.sync_all()?;
        std::fs::rename(&next, &record)?;
        Ok(())
    })();
    if activated.is_err() {
        let _ = std::fs::remove_file(next);
        let _ = std::fs::remove_dir_all(&directory);
    }
    activated
}
fn ensure_staged_target(executable: &std::path::Path, stage: &std::path::Path) -> Result<()> {
    let resolved = std::fs::canonicalize(executable).context("Resolve staged ACP adapter")?;
    let root = std::fs::canonicalize(stage)?;
    anyhow::ensure!(
        resolved.starts_with(root) && resolved.is_file(),
        "Staged adapter points outside its private installation"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adapter_installs_use_a_fresh_prefix_and_network_retries() {
        let args = args_for("codex", std::path::Path::new("/fresh/install")).unwrap();
        assert_eq!(
            args[args.iter().position(|a| a == "--prefix").unwrap() + 1],
            "/fresh/install"
        );
        assert!(args.iter().any(|a| a == "--fetch-retries=3"));
        assert!(args
            .iter()
            .any(|a| a == "@agentclientprotocol/codex-acp@latest"));
        assert!(args_for("unknown", std::path::Path::new("/tmp")).is_err());
    }
    #[test]
    fn incomplete_or_external_staged_adapter_never_activates() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let outside = other.path().join("adapter");
        std::fs::write(&outside, "fixture").unwrap();
        assert!(ensure_staged_target(&outside, root.path()).is_err());
        assert!(ensure_staged_target(&root.path().join("missing"), root.path()).is_err());
        let inside = root.path().join("adapter");
        std::fs::write(&inside, "fixture").unwrap();
        assert!(ensure_staged_target(&inside, root.path()).is_ok());
    }
}
