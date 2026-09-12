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
