use remote_codex_protocol::{ThreadHistoryItemDto, ThreadTurnDto};

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

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, kind: &str, text: &str) -> ThreadHistoryItemDto {
        ThreadHistoryItemDto {
            id: id.into(),
            created_at: None,
            kind: kind.into(),
            text: text.into(),
            preview_text: None,
            detail_text: None,
            status: None,
            sequence: None,
            source_turn_id: None,
            artifact: None,
        }
    }

    fn turn(status: &str, items: Vec<ThreadHistoryItemDto>) -> ThreadTurnDto {
        ThreadTurnDto {
            id: "turn-1".into(),
            started_at: Some("2026-09-02T12:00:00.000Z".into()),
            status: status.into(),
            error: None,
            model: None,
            reasoning_effort: None,
            token_usage: None,
            has_deferred_items: None,
            deferred_item_count: None,
            items,
        }
    }

    #[test]
    fn summarizes_completed_turns_to_prompt_and_final_reply() {
        let summarized = summarize_completed_turn(turn(
            "completed",
            vec![
                item("user-1", "userMessage", "Inspect this."),
                item("reason-1", "reasoning", "Thinking."),
                item("command-1", "commandExecution", "pwd"),
                item("agent-progress", "agentMessage", "Checking."),
                item("agent-final", "agentMessage", "Done."),
            ],
        ));
        assert_eq!(summarized.has_deferred_items, Some(true));
        assert_eq!(summarized.deferred_item_count, Some(3));
        assert_eq!(
            summarized
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["user-1", "agent-final"]
        );
    }

    #[test]
    fn leaves_in_progress_turns_intact() {
        let original = turn(
            "inProgress",
            vec![
                item("user-1", "userMessage", "Inspect this."),
                item("command-1", "commandExecution", "pwd"),
                item("agent-1", "agentMessage", "Working."),
            ],
        );
        let summarized = summarize_completed_turn(original.clone());
        assert_eq!(summarized.items.len(), original.items.len());
        assert_eq!(summarized.has_deferred_items, None);
    }
}
