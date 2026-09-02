use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use remote_codex_protocol::{ThreadWorkspaceFilePreviewDto, ThreadWorkspaceTreeNodeDto};
use walkdir::WalkDir;

pub fn assert_within(root: &Path, candidate: &Path) -> Result<PathBuf> {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    let mut out = PathBuf::new();
    for comp in joined.components() {
        match comp {
            std::path::Component::ParentDir => {
                if !out.pop() {
                    bail!("path is outside the workspace");
                }
            }
            std::path::Component::CurDir => {}
            other => out.push(other),
        }
    }
    if !out.starts_with(&root) {
        bail!("path is outside the workspace");
    }
    Ok(out)
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
    } else if Path::new(rel).is_absolute() {
        assert_within(root, Path::new(rel))?
    } else {
        let joined = root.join(rel);
        assert_within(root, &joined)?;
        joined
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

    #[test]
    fn workspace_write_rejects_escape() {
        let dir = std::env::temp_dir().join(format!("rc-files-{}", std::process::id()));
        let root = dir.join("ws");
        fs::create_dir_all(&root).unwrap();
        let err = write_file(&root, "../escape.txt", "no").unwrap_err();
        assert!(err.to_string().contains("outside"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unrestricted_write_allows_absolute_outside() {
        let dir = std::env::temp_dir().join(format!("rc-files-full-{}", std::process::id()));
        let root = dir.join("ws");
        let outside = dir.join("outside.txt");
        fs::create_dir_all(&root).unwrap();
        write_file_with_scope(
            &root,
            outside.to_str().unwrap(),
            "ok",
            WriteScope::Unrestricted,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&outside).unwrap(), "ok");
        fs::remove_dir_all(&dir).ok();
    }
}
