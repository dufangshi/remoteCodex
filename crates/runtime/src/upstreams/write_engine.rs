//! Adapted from CC Switch live/engine.rs: plan -> stage -> reread -> rename.
//! Copyright (c) 2025 Jason Young. MIT; see THIRD_PARTY_NOTICES.md.
//! External writers do not share our lock; comparison is optimistic, leaving
//! the same small compare/rename race as CC Switch.
use super::*;
pub const CONFLICT: &str = "Native configuration changed: reload before applying.";
pub fn stage(path: &Path, bytes: &[u8]) -> Result<tempfile::NamedTempFile> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("Invalid configuration path"))?;
    std::fs::create_dir_all(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
    }
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    use std::io::Write;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    Ok(file)
}
pub fn commit(file: tempfile::NamedTempFile, path: &Path, expected: Option<&str>) -> Result<()> {
    if read(path)?.as_deref() != expected {
        bail!(CONFLICT);
    }
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reread_before_rename_preserves_a_concurrent_claude_write() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        private_write(&path, b"{\"model\":\"before\"}").unwrap();
        let staged = stage(&path, b"{\"model\":\"ours\"}").unwrap();
        private_write(&path, b"{\"model\":\"external\",\"hooks\":{}}").unwrap();
        assert!(commit(staged, &path, Some("{\"model\":\"before\"}")).is_err());
        assert_eq!(
            read(&path).unwrap().unwrap(),
            "{\"model\":\"external\",\"hooks\":{}}"
        );
    }
}
