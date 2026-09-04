use std::path::Path;

use anyhow::{bail, Result};
use base64::Engine;
use serde_json::{json, Value};

use crate::actor::PromptImage;
use crate::files::assert_within;

pub fn build_prompt_blocks(
    prompt: &str,
    cwd: &Path,
    image_capable: bool,
    extra_images: &[PromptImage],
) -> Result<Vec<Value>> {
    let mut blocks = expand_attachment_tokens(prompt, cwd, image_capable)?;
    for image in extra_images {
        blocks.push(json!({
            "type": "image",
            "mimeType": image.mime_type,
            "data": image.data
        }));
    }
    if blocks.is_empty() && !prompt.is_empty() {
        blocks.push(json!({ "type": "text", "text": prompt }));
    }
    Ok(blocks)
}

fn expand_attachment_tokens(prompt: &str, cwd: &Path, _image_capable: bool) -> Result<Vec<Value>> {
    let mut blocks = Vec::new();
    let mut cursor = 0;
    while cursor < prompt.len() {
        let rest = &prompt[cursor..];
        let Some(start_rel) = rest.find('[') else {
            break;
        };
        let start = cursor + start_rel;
        let after = &prompt[start + 1..];
        let (kind, rest_after_kind) = if after.starts_with("PHOTO ") {
            ("PHOTO", &after[6..])
        } else if after.starts_with("FILE ") {
            ("FILE", &after[5..])
        } else {
            cursor = start + 1;
            continue;
        };
        let Some(end_rel) = rest_after_kind.find(']') else {
            break;
        };
        let requested = rest_after_kind[..end_rel].trim();
        let end = start + 1 + (after.len() - rest_after_kind.len()) + end_rel + 1;
        let preceding = &prompt[cursor..start];
        if !preceding.is_empty() {
            blocks.push(json!({ "type": "text", "text": preceding }));
        }
        let abs = assert_within(cwd, Path::new(requested))?;
        let uri = url::Url::from_file_path(&abs)
            .map_err(|_| anyhow::anyhow!("cannot convert attachment path to a file URL"))?
            .to_string();
        if kind == "PHOTO" {
            let file_bytes = std::fs::read(&abs)?;
            if file_bytes.len() > 20 * 1024 * 1024 {
                bail!("ACP image attachment is missing or exceeds 20 MiB.");
            }
            let data = base64::engine::general_purpose::STANDARD.encode(file_bytes);
            blocks.push(json!({
                "type": "image",
                "mimeType": mime_for(&abs),
                "data": data,
                "uri": uri
            }));
        } else {
            let name = abs
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| requested.to_string());
            blocks.push(json!({
                "type": "resource_link",
                "name": name,
                "uri": uri
            }));
        }
        cursor = end;
    }
    if cursor == 0 {
        if !prompt.is_empty() {
            blocks.push(json!({ "type": "text", "text": prompt }));
        }
        return Ok(blocks);
    }
    let trailing = &prompt[cursor..];
    if !trailing.is_empty() {
        blocks.push(json!({ "type": "text", "text": trailing }));
    }
    Ok(blocks)
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn expands_photo_token() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("red.png"), b"png").unwrap();
        let blocks =
            build_prompt_blocks("see [PHOTO red.png] please", dir.path(), true, &[]).unwrap();
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[1]["type"], "image");
        assert_eq!(blocks[1]["mimeType"], "image/png");
        let uri = blocks[1]["uri"].as_str().unwrap();
        assert_eq!(
            url::Url::parse(uri).unwrap().to_file_path().unwrap(),
            dir.path().join("red.png").canonicalize().unwrap()
        );
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(blocks[1]["data"].as_str().unwrap())
                .unwrap(),
            b"png"
        );
        assert_eq!(blocks[2]["type"], "text");
    }

    #[test]
    fn passes_images_through_when_capability_is_unadvertised() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("red.png"), b"png").unwrap();
        let blocks = build_prompt_blocks("[PHOTO red.png]", dir.path(), false, &[]).unwrap();
        assert_eq!(blocks[0]["type"], "image");
    }

    #[test]
    fn file_links_are_encoded_urls_that_round_trip_to_the_attachment() {
        let dir = tempdir().unwrap();
        let filename = "notes #1 %.txt";
        let path = dir.path().join(filename);
        std::fs::write(&path, "notes").unwrap();

        let blocks =
            build_prompt_blocks(&format!("[FILE {filename}]"), dir.path(), true, &[]).unwrap();
        let uri = blocks[0]["uri"].as_str().unwrap();
        assert!(uri.contains("notes%20%231%20%25.txt"), "{uri}");
        assert_eq!(
            url::Url::parse(uri).unwrap().to_file_path().unwrap(),
            path.canonicalize().unwrap()
        );
    }
}
