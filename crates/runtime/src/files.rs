use std::ffi::OsString;
use std::fs::File;
use std::io::ErrorKind;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

use anyhow::{bail, Result};
use remote_codex_protocol::{ThreadWorkspaceFilePreviewDto, ThreadWorkspaceTreeNodeDto};
use tempfile::NamedTempFile;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

pub const DIRECTORY_DOWNLOAD_MAX_FILES_EXCLUSIVE: usize = 1_000;
pub const DIRECTORY_DOWNLOAD_MAX_BYTES_EXCLUSIVE: u64 = 1_000_000_000;

pub enum WorkspaceDownload {
    File {
        path: PathBuf,
        bytes: Vec<u8>,
    },
    DirectoryArchive {
        filename: String,
        archive: NamedTempFile,
    },
}

pub fn assert_within(root: &Path, candidate: &Path) -> Result<PathBuf> {
    let root = root.canonicalize()?;
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    let normalized = normalize_path(&joined)?;
    let resolved = resolve_existing_ancestor(&normalized)?;
    if !resolved.starts_with(&root) {
        bail!("path is outside the workspace");
    }
    Ok(resolved)
}

fn normalize_path(path: &Path) -> Result<PathBuf> {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                if !out.pop() {
                    bail!("path is outside the workspace");
                }
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    Ok(out)
}

fn resolve_existing_ancestor(path: &Path) -> Result<PathBuf> {
    let mut ancestor = path.to_path_buf();
    let mut suffix = Vec::<OsString>::new();

    loop {
        match std::fs::symlink_metadata(&ancestor) {
            Ok(_) => {
                let mut resolved = ancestor.canonicalize()?;
                for component in suffix.into_iter().rev() {
                    resolved.push(component);
                }
                return Ok(resolved);
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                let Some(component) = ancestor.file_name().map(OsString::from) else {
                    return Err(error.into());
                };
                suffix.push(component);
                if !ancestor.pop() {
                    return Err(error.into());
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
}

pub fn list_tree(root: &Path, rel: &str) -> Result<Vec<ThreadWorkspaceTreeNodeDto>> {
    let dir = assert_within(root, &PathBuf::from(rel))?;
    if !dir.is_dir() {
        bail!("not a directory");
    }
    let mut nodes = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = PathBuf::from(rel).join(&name);
        let meta = entry.metadata()?;
        let kind = if meta.is_dir() { "directory" } else { "file" };
        nodes.push(ThreadWorkspaceTreeNodeDto {
            name,
            path: path.to_string_lossy().replace('\\', "/"),
            kind: kind.into(),
            size: if meta.is_file() {
                Some(meta.len())
            } else {
                None
            },
            has_children: Some(meta.is_dir()),
            children_loaded: Some(false),
            children: None,
        });
    }
    nodes.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(nodes)
}

pub fn preview_file(root: &Path, rel: &str, limit: usize) -> Result<ThreadWorkspaceFilePreviewDto> {
    let path = assert_within(root, &PathBuf::from(rel))?;
    let bytes = std::fs::read(&path)?;
    let truncated = bytes.len() > limit;
    let slice = if truncated { &bytes[..limit] } else { &bytes };
    let content = String::from_utf8_lossy(slice).into_owned();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| rel.to_string());
    Ok(ThreadWorkspaceFilePreviewDto {
        path: rel.replace('\\', "/"),
        name: name.clone(),
        content,
        language: language_for(&name),
        size: bytes.len() as u64,
        truncated,
        next_offset: slice.len() as u64,
    })
}

pub fn read_bytes(root: &Path, rel: &str) -> Result<(PathBuf, Vec<u8>)> {
    let path = assert_within(root, Path::new(rel))?;
    let bytes = std::fs::read(&path)?;
    Ok((path, bytes))
}

pub fn prepare_download(root: &Path, rel: &str) -> Result<WorkspaceDownload> {
    let path = assert_within(root, Path::new(rel))?;
    if path.is_file() {
        let bytes = std::fs::read(&path)?;
        return Ok(WorkspaceDownload::File { path, bytes });
    }
    if !path.is_dir() {
        bail!("Workspace download path must point to a file or directory.");
    }

    let archive_root = path
        .file_name()
        .filter(|name| !name.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("workspace"));
    let mut entries = Vec::new();
    let mut file_count = 0usize;
    let mut total_bytes = 0u64;

    for entry in WalkDir::new(&path).follow_links(false).sort_by_file_name() {
        let entry = entry?;
        let file_type = entry.file_type();
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_file() {
            file_count += 1;
            if file_count >= DIRECTORY_DOWNLOAD_MAX_FILES_EXCLUSIVE {
                bail!(
                    "Directory download is limited to fewer than 1,000 files; `{rel}` contains 1,000 files or more."
                );
            }
            total_bytes = total_bytes
                .checked_add(entry.metadata()?.len())
                .ok_or_else(|| anyhow::anyhow!("Directory download size overflowed."))?;
            if total_bytes >= DIRECTORY_DOWNLOAD_MAX_BYTES_EXCLUSIVE {
                bail!(
                    "Directory download is limited to less than 1 GB (1,000,000,000 bytes); `{rel}` contains 1 GB or more."
                );
            }
        }
        if file_type.is_dir() || file_type.is_file() {
            entries.push(entry.into_path());
        }
    }

    let mut archive = NamedTempFile::new()?;
    {
        let mut writer = ZipWriter::new(archive.as_file_mut());
        let file_options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);
        let directory_options = SimpleFileOptions::default().unix_permissions(0o755);
        let mut archived_bytes = 0u64;
        for entry in entries {
            let relative = entry.strip_prefix(&path)?;
            let archive_path = archive_root.join(relative);
            if entry.is_dir() {
                writer.add_directory_from_path(&archive_path, directory_options)?;
            } else {
                writer.start_file_from_path(&archive_path, file_options)?;
                let input = File::open(&entry)?;
                let remaining =
                    (DIRECTORY_DOWNLOAD_MAX_BYTES_EXCLUSIVE - 1).saturating_sub(archived_bytes);
                let copied = io::copy(&mut input.take(remaining + 1), &mut writer)?;
                if copied > remaining {
                    bail!(
                        "Directory download is limited to less than 1 GB (1,000,000,000 bytes); `{rel}` contains 1 GB or more."
                    );
                }
                archived_bytes += copied;
            }
        }
        writer.finish()?;
    }

    Ok(WorkspaceDownload::DirectoryArchive {
        filename: format!("{}.zip", archive_root.to_string_lossy()),
        archive,
    })
}

pub fn image_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "heic" => "image/heic",
        "heif" => "image/heif",
        _ => "application/octet-stream",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteScope {
    Workspace,
    Unrestricted,
}

pub fn write_file(root: &Path, rel: &str, content: &str) -> Result<()> {
    write_file_with_scope(root, rel, content, WriteScope::Workspace)
}

pub fn write_file_with_scope(
    root: &Path,
    rel: &str,
    content: &str,
    scope: WriteScope,
) -> Result<()> {
    let path = if scope == WriteScope::Unrestricted {
        if Path::new(rel).is_absolute() {
            PathBuf::from(rel)
        } else {
            root.join(rel)
        }
    } else {
        assert_within(root, Path::new(rel))?
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

pub fn count_files(root: &Path) -> usize {
    WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .count()
}

fn language_for(name: &str) -> String {
    match Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
    {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "py" => "python",
        "md" => "markdown",
        "json" => "json",
        "toml" => "toml",
        "yml" | "yaml" => "yaml",
        "sh" => "shell",
        "css" => "css",
        "html" => "html",
        "sql" => "sql",
        _ => "text",
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn workspace_write_rejects_escape() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("ws");
        fs::create_dir_all(&root).unwrap();
        let err = write_file(&root, "../escape.txt", "no").unwrap_err();
        assert!(err.to_string().contains("outside"));
    }

    #[test]
    fn unrestricted_write_allows_absolute_outside() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("ws");
        let outside = dir.path().join("outside.txt");
        fs::create_dir_all(&root).unwrap();
        write_file_with_scope(
            &root,
            outside.to_str().unwrap(),
            "ok",
            WriteScope::Unrestricted,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&outside).unwrap(), "ok");
    }

    #[test]
    fn workspace_write_allows_missing_paths_inside_root() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("ws");
        fs::create_dir_all(&root).unwrap();

        write_file(&root, "new/nested/file.txt", "ok").unwrap();

        assert_eq!(
            fs::read_to_string(root.join("new/nested/file.txt")).unwrap(),
            "ok"
        );
    }

    #[test]
    fn directory_download_creates_a_zip_with_the_selected_root() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("ws");
        fs::create_dir_all(root.join("docs/empty")).unwrap();
        fs::write(root.join("README.md"), "hello").unwrap();
        fs::write(root.join("docs/notes.txt"), "notes").unwrap();

        let WorkspaceDownload::DirectoryArchive { filename, archive } =
            prepare_download(&root, ".").unwrap()
        else {
            panic!("expected a directory archive");
        };
        assert_eq!(filename, "ws.zip");
        let mut zip = zip::ZipArchive::new(archive.reopen().unwrap()).unwrap();
        let mut readme = String::new();
        zip.by_name("ws/README.md")
            .unwrap()
            .read_to_string(&mut readme)
            .unwrap();
        assert_eq!(readme, "hello");
        assert!(zip.by_name("ws/docs/empty/").is_ok());
    }

    #[test]
    fn directory_download_rejects_one_thousand_files() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("ws");
        fs::create_dir_all(&root).unwrap();
        for index in 0..DIRECTORY_DOWNLOAD_MAX_FILES_EXCLUSIVE {
            fs::write(root.join(format!("{index}.txt")), []).unwrap();
        }

        let error = prepare_download(&root, ".").err().unwrap();

        assert!(error.to_string().contains("fewer than 1,000 files"));
    }

    #[test]
    fn directory_download_rejects_one_gigabyte() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("ws");
        fs::create_dir_all(&root).unwrap();
        let file = File::create(root.join("large.bin")).unwrap();
        file.set_len(DIRECTORY_DOWNLOAD_MAX_BYTES_EXCLUSIVE)
            .unwrap();

        let error = prepare_download(&root, ".").err().unwrap();

        assert!(error.to_string().contains("less than 1 GB"));
    }

    #[cfg(unix)]
    #[test]
    fn workspace_reads_reject_symlink_escape() {
        use std::os::unix::fs::symlink;

        let dir = tempdir().unwrap();
        let root = dir.path().join("ws");
        let outside = dir.path().join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();
        symlink(&outside, root.join("linked")).unwrap();

        let error = read_bytes(&root, "linked/secret.txt").unwrap_err();

        assert!(error.to_string().contains("outside"));
    }

    #[cfg(unix)]
    #[test]
    fn workspace_writes_reject_symlink_escape_for_missing_file() {
        use std::os::unix::fs::symlink;

        let dir = tempdir().unwrap();
        let root = dir.path().join("ws");
        let outside = dir.path().join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("linked")).unwrap();

        let error = write_file(&root, "linked/new.txt", "no").unwrap_err();

        assert!(error.to_string().contains("outside"));
        assert!(!outside.join("new.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn workspace_writes_allow_symlinks_that_resolve_inside_root() {
        use std::os::unix::fs::symlink;

        let dir = tempdir().unwrap();
        let root = dir.path().join("ws");
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();
        symlink(&target, root.join("linked")).unwrap();

        write_file(&root, "linked/new.txt", "ok").unwrap();

        assert_eq!(fs::read_to_string(target.join("new.txt")).unwrap(), "ok");
    }
}
