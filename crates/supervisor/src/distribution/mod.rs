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
    std::env::var_os("REMOTE_CODEX_RELAY_SUPERVISOR_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".remote-codex/relay-supervisor.json"))
}
fn read<T: DeserializeOwned>(path: &Path) -> Result<T> {
    serde_json::from_slice(
        &std::fs::read(path).with_context(|| format!("Read {}", path.display()))?,
    )
    .with_context(|| format!("Parse {}", path.display()))
}
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
