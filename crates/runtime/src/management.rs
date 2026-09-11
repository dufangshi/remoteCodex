//! Resolve the installation actually selected by the harness, never a second PATH copy.
use crate::{
    acp::{builtin_agents, command_program},
    Supervisor,
};
use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

#[derive(Clone, Debug)]
pub struct Installation {
    pub path: PathBuf,
    pub real_path: PathBuf,
    pub manager: String,
    pub version: Option<String>,
    pub update: Vec<String>,
    pub reason: Option<String>,
}

pub async fn output(program: &Path, args: &[String], timeout: u64) -> Result<String> {
    let mut command = tokio::process::Command::new(program);
    crate::child_process::hide_tokio(&mut command);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let result = tokio::time::timeout(Duration::from_secs(timeout), command.output()).await??;
    if !result.status.success() {
        bail!("Command failed ({})", result.status);
    }
    Ok(String::from_utf8_lossy(&result.stdout).trim().to_string())
}

pub fn resolve(command: &str) -> Result<PathBuf> {
    which::which(command_program(command).ok_or_else(|| anyhow!("Empty harness command"))?)
        .map_err(|_| anyhow!("Executable not found"))
}

fn text_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn npm_shim_target(path: &Path) -> Option<PathBuf> {
    if !matches!(
        path.extension().and_then(|v| v.to_str()),
        Some("cmd" | "ps1")
    ) {
        return None;
    }
    let source = std::fs::read_to_string(path).ok()?.replace('\\', "/");
    for quoted in source.split('"') {
        let Some(start) = quoted.find("node_modules/") else {
            continue;
        };
        let relative = &quoted[start..];
        if ![".js", ".mjs", ".cjs"]
            .iter()
            .any(|suffix| relative.ends_with(suffix))
            || relative.split('/').any(|part| part == "..")
        {
            continue;
        }
        let target = path.parent()?.join(relative);
        if target.is_file() {
            return target.canonicalize().ok();
        }
    }
    None
}

pub fn installation(path: PathBuf, agent: &str) -> Installation {
    let real = npm_shim_target(&path)
        .unwrap_or_else(|| path.canonicalize().unwrap_or_else(|_| path.clone()));
    let mut found = Installation {
        path,
        real_path: real.clone(),
        manager: "manual".into(),
        version: None,
        update: vec![],
        reason: Some("Update using the installer that owns this executable.".into()),
    };
    // App bundles are owned by the desktop application's updater, not npm.
    if real
        .components()
        .any(|c| c.as_os_str().to_string_lossy().ends_with(".app"))
    {
        found.manager = "app".into();
        found.reason =
            Some("Bundled with a desktop app. Update that app to update this harness.".into());
        return found;
    }
    for ancestor in real.ancestors().skip(1) {
        if let Some(parent) = ancestor.parent() {
            if matches!(
                parent.file_name().and_then(|v| v.to_str()),
                Some("Cellar" | "Caskroom")
            ) {
                if let (Some(prefix), Some(name)) = (parent.parent(), ancestor.file_name()) {
                    let brew = prefix.join("bin/brew");
                    if brew.is_file() {
                        found.manager = "homebrew".into();
                        found.reason = None;
                        found.update = vec![
                            text_path(&brew),
                            "upgrade".into(),
                            if parent.ends_with("Caskroom") {
                                "--cask"
                            } else {
                                "--formula"
                            }
                            .into(),
                            name.to_string_lossy().into_owned(),
                        ];
                        return found;
                    }
                }
            }
        }
        let Ok(raw) = std::fs::read(ancestor.join("package.json")) else {
            continue;
        };
        let Ok(package) = serde_json::from_slice::<Value>(&raw) else {
            continue;
        };
        let Some(name) = package["name"].as_str() else {
            continue;
        };
        // Only global npm layouts; workspace, pnpm stores, and arbitrary package names
        // must not be reinterpreted as a global npm install.
        let allowed = matches!(
            name,
            "@openai/codex"
                | "@anthropic-ai/claude-code"
                | "@google/gemini-cli"
                | "@github/copilot"
                | "opencode-ai"
                | "@agentclientprotocol/codex-acp"
                | "@agentclientprotocol/claude-agent-acp"
                | "remote-codex"
        );
        if !allowed {
            continue;
        }
        let Some(modules) = ancestor
            .ancestors()
            .find(|p| p.file_name().is_some_and(|v| v == "node_modules"))
        else {
            continue;
        };
        let Some(parent) = modules.parent() else {
            continue;
        };
        let prefix = if parent.ends_with("lib") {
            parent.parent().unwrap_or(parent)
        } else {
            parent
        };
        let mut npm = modules.join("npm/bin/npm-cli.js");
        let node = if cfg!(windows) {
            let local = prefix.join("node.exe");
            if local.is_file() {
                local
            } else {
                which::which("node").unwrap_or(local)
            }
        } else {
            prefix.join("bin/node")
        };
        // Windows npm often stores global packages in AppData, while npm itself
        // lives next to node.exe. --prefix still pins the installation being updated.
        if cfg!(windows) && !npm.is_file() {
            if let Some(parent) = node.parent() {
                npm = parent.join("node_modules/npm/bin/npm-cli.js");
            }
        }
        if npm.is_file() && node.is_file() {
            found.manager = "npm".into();
            found.version = package["version"].as_str().map(str::to_owned);
            found.reason = None;
            found.update = vec![
                text_path(&node),
                text_path(&npm),
                "install".into(),
                "--global".into(),
                "--prefix".into(),
                text_path(prefix),
                format!("{name}@latest"),
                "--no-audit".into(),
                "--no-fund".into(),
            ];
            return found;
        }
    }
    if agent == "claude"
        && real
            .to_string_lossy()
            .replace('\\', "/")
            .contains("/.local/share/claude/versions/")
    {
        found.manager = "native".into();
        found.update = vec![text_path(&found.path), "update".into()];
        found.reason = None;
    }
    found
}

pub async fn inspect(command: &str, agent: &str) -> Result<Installation> {
    let mut found = installation(resolve(command)?, agent);
    if found.version.is_some() {
        return Ok(found);
    }
    if let Ok(version) = output(&found.path, &["--version".into()], 5).await {
        let line = version.lines().next().unwrap_or_default();
        if line.chars().any(|c| c.is_ascii_digit()) {
            found.version = Some(line.chars().take(100).collect());
        }
    }
    Ok(found)
}

fn dto(found: Installation) -> Value {
    json!({"path":found.path,"resolvedPath":found.real_path,"version":found.version,"manager":found.manager,"canUpdate":!found.update.is_empty(),"updateCommand":shell_words::join(&found.update),"reason":found.reason})
}

pub async fn inventory(state: &Supervisor) -> Value {
    let rows = futures_util::future::join_all(builtin_agents(state.config.acp_command.as_deref()).into_iter().map(|def| async move {
        let (base, adapter) = tokio::join!(inspect(&def.base_command, &def.id), async {
            if def.transport == "adapter" { inspect(&def.server_command, "adapter").await.ok().map(dto) } else { None }
        });
        let job = state.management_jobs.lock().unwrap().get(&def.id).cloned();
        json!({"id":def.id,"name":def.display_name,"transport":def.transport,"base":base.ok().map(dto),"adapter":adapter,"job":job})
    })).await;
    json!(rows)
}

pub async fn update_harness(state: &Supervisor, id: &str, component: &str) -> Result<()> {
    let def = builtin_agents(state.config.acp_command.as_deref())
        .into_iter()
        .find(|d| d.id == id)
        .ok_or_else(|| anyhow!("Unknown harness"))?;
    let command = match component {
        "base" => &def.base_command,
        "adapter" if def.transport == "adapter" => &def.server_command,
        _ => bail!("Unknown component"),
    };
    let found = inspect(command, id).await?;
    let Some((program, args)) = found.update.split_first() else {
        bail!("{}", found.reason.unwrap_or_default());
    };
    output(Path::new(program), args, 300).await?;
    let updated = inspect(command, id).await?;
    if updated.version.is_none() {
        bail!("Installer finished, but the selected executable's version could not be verified");
    }
    state.restart_harness(id).await?;
    Ok(())
}
