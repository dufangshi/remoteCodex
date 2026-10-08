use anyhow::{ensure, Result};
use rusqlite::params;
use serde_json::{json, Value};

use super::Supervisor;

/// Return only conversational excerpts. Searching must not hydrate tool output,
/// pricing or harness sessions, or transfer entire history to the browser.
impl Supervisor {
    pub fn search_thread_messages(&self, id: &str, query: &str, limit: usize) -> Result<Value> {
        let imported = self.get_thread(id)?.source == "local_codex_import";
        let query = query.trim();
        ensure!(
            !query.is_empty() && query.chars().count() <= 200,
            "bad_request: query must contain 1 to 200 characters"
        );
        ensure!(
            (1..=100).contains(&limit),
            "bad_request: limit must be between 1 and 100"
        );
        let needle = query.to_lowercase();
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT i.turn_id, i.item_id, json_extract(i.item_json, '$.kind'),
                        json_extract(i.item_json, '$.text'), i.created_at,
                        COALESCE(json_extract(i.item_json, '$.phase'), json_extract(i.item_json, '$.status'))
                 FROM thread_turns t JOIN thread_history_items i
                   ON i.thread_id=t.thread_id AND i.turn_id=t.id
                 WHERE t.thread_id=?1
                   AND json_extract(i.item_json, '$.kind') IN ('userMessage', 'agentMessage')
                 ORDER BY t.ordinal DESC, i.created_at ASC, i.rowid ASC",
            )?;
            let mut rows = statement.query(params![id])?;
            let mut matches = Vec::new();
            let mut has_more = false;
            let mut current_turn = String::new();
            let mut seen = std::collections::HashSet::new();
            while let Some(row) = rows.next()? {
                let turn_id: String = row.get(0)?;
                let kind: String = row.get(2)?;
                let mut text: String = row.get::<_, Option<String>>(3)?.unwrap_or_default();
                if imported {
                    if current_turn != turn_id { current_turn.clone_from(&turn_id); seen.clear(); }
                    if kind == "userMessage" {
                        let Some(cleaned) = crate::local_sessions::sanitize_codex_user_text(&text) else { continue };
                        text = cleaned;
                    }
                    let commentary = kind == "agentMessage" && row.get::<_, Option<String>>(5)?.as_deref() == Some("commentary");
                    if !seen.insert((kind.clone(), text.trim().to_string(), commentary)) { continue; }
                }
                let Some(excerpt) = search_excerpt(&text, &needle) else { continue };
                if matches.len() == limit {
                    has_more = true;
                    break;
                }
                matches.push(json!({
                    "turnId": turn_id,
                    "itemId": row.get::<_, String>(1)?,
                    "role": if kind == "userMessage" { "You" } else { "Assistant" },
                    "text": excerpt,
                    "createdAt": row.get::<_, String>(4)?,
                }));
            }
            Ok(json!({ "matches": matches, "hasMore": has_more }))
        })
    }
}

fn search_excerpt(text: &str, needle: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let start = lower.find(needle)?;
    let end = start + needle.len();
    // Lowercasing can expand a Unicode character. Map the folded match back to
    // original characters before slicing, retaining emoji and non-ASCII case.
    let chars: Vec<char> = text.chars().collect();
    let mut folded = 0;
    let mut first = None;
    let mut last = 0;
    for (index, ch) in chars.iter().enumerate() {
        let next = folded + ch.to_lowercase().map(char::len_utf8).sum::<usize>();
        if next > start && first.is_none() {
            first = Some(index);
        }
        if folded < end {
            last = index + 1;
        }
        folded = next;
        if folded >= end {
            break;
        }
    }
    let begin = first.unwrap_or(0).saturating_sub(100);
    let finish = (last + 240).min(chars.len());
    Some(format!(
        "{}{}{}",
        if begin > 0 { "…" } else { "" },
        chars[begin..finish].iter().collect::<String>(),
        if finish < chars.len() { "…" } else { "" }
    ))
}

#[cfg(test)]
mod tests {
    use super::search_excerpt;

    #[test]
    fn excerpts_keep_literal_unicode_matches_bounded() {
        let text = format!(
            "{}🙂 İSTANBUL 中文 100% _ {}",
            "before ".repeat(300),
            "after ".repeat(300)
        );
        let excerpt = search_excerpt(&text, "i\u{307}stanbul 中文 100% _").unwrap();
        assert!(excerpt.contains("🙂 İSTANBUL 中文 100% _"));
        assert!(excerpt.starts_with('…') && excerpt.ends_with('…'));
        assert!(excerpt.chars().count() < 400);
        assert_eq!(search_excerpt("ÄÖ 中文", "äö 中文"), Some("ÄÖ 中文".into()));
        assert!(search_excerpt("different", "missing").is_none());
    }
}
