use remote_codex_protocol::{ThreadHistoryItemDto, ThreadTurnDto};

/// Older ACP records retained before/after text but no file metadata. Derive the
/// presentation on read, without rewriting the user's saved transcript.
pub fn normalize_legacy_file_change(item: &mut ThreadHistoryItemDto) {
    if item.kind != "fileChange" {
        return;
    }
    let Some(detail) = item.detail_text.as_deref() else {
        return;
    };
    let Some((_, files)) = detail.split_once("Result:\nFile: ") else {
        return;
    };
    let mut paths = Vec::new();
    let mut patches = Vec::new();
    let mut added = 0usize;
    let mut removed = 0usize;
    for file in files.split("\n\nFile: ") {
        let Some((path, texts)) = file.split_once("\n\nBefore:\n") else {
            return;
        };
        let Some((old, new)) = texts.split_once("\n\nAfter:\n") else {
            return;
        };
        let old = if old == "(new file)" { "" } else { old };
        let diff = similar::TextDiff::from_lines(old, new);
        for change in diff.iter_all_changes() {
            match change.tag() {
                similar::ChangeTag::Insert => added += 1,
                similar::ChangeTag::Delete => removed += 1,
                _ => {}
            }
        }
        patches.push(
            diff.unified_diff()
                .context_radius(3)
                .header(&format!("a/{path}"), &format!("b/{path}"))
                .to_string(),
        );
        paths.push(path.to_string());
    }
    item.text = paths.join(", ");
    item.preview_text = Some(item.text.clone());
    item.detail_text = Some(patches.join("\n"));
    item.extra.insert("changedFiles".into(), paths.len().into());
    item.extra.insert("addedLines".into(), added.into());
    item.extra.insert("removedLines".into(), removed.into());
}

/// Apply only at the transport boundary, after the complete item is durable.
pub fn defer_tool_details(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(fields) => {
            if matches!(
                fields.get("kind").and_then(serde_json::Value::as_str),
                Some("commandExecution" | "fileChange")
            ) {
                if fields
                    .remove("detailText")
                    .is_some_and(|text| !text.is_null())
                {
                    fields.insert("hasDeferredDetail".into(), true.into());
                }
            }
            for value in fields.values_mut() {
                defer_tool_details(value);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                defer_tool_details(value);
            }
        }
        _ => {}
    }
}

pub fn summarize_completed_turn(mut turn: ThreadTurnDto) -> ThreadTurnDto {
    if turn.status == "inProgress" {
        return turn;
    }

    let mut final_agent_index = None;
    for (index, item) in turn.items.iter().enumerate().rev() {
        if item.kind == "agentMessage" && !item.text.trim().is_empty() {
            final_agent_index = Some(index);
            break;
        }
    }

    let items: Vec<ThreadHistoryItemDto> = turn
        .items
        .iter()
        .enumerate()
        .filter(|(index, item)| item.kind == "userMessage" || Some(*index) == final_agent_index)
        .map(|(_, item)| item.clone())
        .collect();
    let deferred = turn.items.len().saturating_sub(items.len());
    if deferred == 0 {
        return turn;
    }

    turn.items = items;
    turn.has_deferred_items = Some(true);
    turn.deferred_item_count = Some(deferred as u32);
    turn
}
