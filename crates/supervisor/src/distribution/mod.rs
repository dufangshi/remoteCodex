//! Native, user-owned runtime distribution. GitHub releases are authoritative.
mod releases;
mod service;
mod setup;
mod update;

pub use setup::{run_device, setup, SetupOptions};
pub use update::{maintenance_cli, run_worker, updater};

use anyhow::{Context, Result};
use serde::{de::DeserializeOwned, Serialize};
use std::path::{Path, PathBuf};

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
fn install_root() -> PathBuf {
    home().join(".local/share/remote-codex/native")
}
fn config_path() -> PathBuf {
    std::env::var_os("POCKYMOE_RELAY_SUPERVISOR_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".remote-codex/relay-supervisor.json"))
}
fn read<T: DeserializeOwned>(path: &Path) -> Result<T> {
    serde_json::from_slice(
        &std::fs::read(path).with_context(|| format!("Read {}", path.display()))?,
    )
    .with_context(|| format!("Parse {}", path.display()))
}
/// `relay-supervisor.json` is shared with Windows Device Managers and with
/// installations from before the rename, which read only `REMOTE_CODEX_*` keys:
/// accept either name (the new one wins) and write the old one.
fn read_device_config(path: &Path) -> Result<serde_json::Value> {
    let mut saved: serde_json::Value = read(path)?;
    if let Some(object) = saved.as_object_mut() {
        let legacy: Vec<String> = object
            .keys()
            .filter(|key| key.starts_with(LEGACY_PREFIX))
            .cloned()
            .collect();
        for key in legacy {
            let value = object.remove(&key).unwrap_or_default();
            let current = format!("{CURRENT_PREFIX}{}", &key[LEGACY_PREFIX.len()..]);
            object.entry(current).or_insert(value);
        }
    }
    Ok(saved)
}
fn write_device_config(path: &Path, saved: &serde_json::Value) -> Result<()> {
    let mut legacy = saved.clone();
    if let Some(object) = legacy.as_object_mut() {
        *object = std::mem::take(object)
            .into_iter()
            .map(|(key, value)| match key.strip_prefix(CURRENT_PREFIX) {
                Some(rest) => (format!("{LEGACY_PREFIX}{rest}"), value),
                None => (key, value),
            })
            .collect();
    }
    write(path, &legacy)
}
const LEGACY_PREFIX: &str = "REMOTE_CODEX_";
const CURRENT_PREFIX: &str = "POCKYMOE_";
fn private_dir(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
fn write<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    write_bytes(path, &serde_json::to_vec_pretty(value)?)
}
fn write_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    private_dir(path.parent().context("Missing parent directory")?)?;
    let next = path.with_extension(format!("{}.next", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&next)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    std::fs::rename(&next, path)?;
    Ok(())
}
fn executable(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    let _ = path;
    Ok(())
}
fn binary_name() -> &'static str {
    if cfg!(windows) {
        "remote-codex.exe"
    } else {
        "remote-codex"
    }
}

#[cfg(test)]
mod device_config_tests {
    use super::*;

    #[test]
    fn device_config_reads_either_key_name_and_writes_the_legacy_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("relay-supervisor.json");
        std::fs::write(
            &path,
            r#"{"REMOTE_CODEX_RELAY_AGENT_TOKEN":"old","POCKYMOE_RELAY_SERVER_URL":"wss://new","REMOTE_CODEX_RELAY_SERVER_URL":"wss://old","other":1}"#,
        )
        .unwrap();
        let saved = read_device_config(&path).unwrap();
        assert_eq!(
            saved,
            serde_json::json!({"POCKYMOE_RELAY_AGENT_TOKEN":"old","POCKYMOE_RELAY_SERVER_URL":"wss://new","other":1})
        );
        write_device_config(&path, &saved).unwrap();
        let written: serde_json::Value = read(&path).unwrap();
        assert_eq!(
            written,
            serde_json::json!({"REMOTE_CODEX_RELAY_AGENT_TOKEN":"old","REMOTE_CODEX_RELAY_SERVER_URL":"wss://new","other":1})
        );
    }
}
