use remote_codex_protocol::Provider;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSessionRef {
    pub raw_id: String,
    pub agent_id: Option<String>,
}

const AGENT_SCHEMES: &[(&str, &str)] = &[
    ("codex", "codex"),
    ("claude", "claude"),
    ("claude-code", "claude"),
    ("claudecode", "claude"),
    ("grok", "grok"),
    ("grok-build", "grok"),
    ("xai", "grok"),
    ("cursor", "cursor"),
    ("cursor-agent", "cursor"),
    ("gemini", "gemini"),
    ("copilot", "copilot"),
    ("github-copilot", "copilot"),
    ("opencode", "opencode"),
    ("open-code", "opencode"),
    ("deepseek", "deepseek"),
    ("dsh", "deepseek"),
    ("acp", "acp"),
];

const KNOWN_AGENTS: &[&str] = &[
    "codex", "claude", "grok", "cursor", "gemini", "copilot", "opencode", "deepseek", "acp",
];

/// Extract a harness session id from a pasted value.
///
/// Accepts bare ids, `agent::id` scoped ids, and copied URIs such as
/// `codex://threads/01a0634a-23df-7191-acd2-1fca43a10418`.
pub fn parse_session_ref(input: &str) -> ParsedSessionRef {
    let trimmed = trim_wrappers(input);
    if trimmed.is_empty() {
        return ParsedSessionRef {
            raw_id: String::new(),
            agent_id: None,
        };
    }

    if let Some((agent, rest)) = split_scoped(trimmed) {
        return ParsedSessionRef {
            raw_id: rest.to_string(),
            agent_id: Some(agent.to_string()),
        };
    }

    if let Some(parsed) = parse_uri(trimmed) {
        return parsed;
    }

    ParsedSessionRef {
        raw_id: last_non_empty_segment(trimmed).to_string(),
        agent_id: infer_agent_token(trimmed),
    }
}

pub fn scoped_session_id(agent_id: &str, raw_id: &str) -> String {
    if let Some((existing_agent, rest)) = split_scoped(raw_id) {
        return format!("{existing_agent}::{rest}");
    }
    format!("{agent_id}::{raw_id}")
}

pub fn session_ids_match(stored: &str, candidate: &str) -> bool {
    if stored == candidate {
        return true;
    }
    raw_session_id(stored) == raw_session_id(candidate)
}

pub fn raw_session_id(value: &str) -> &str {
    split_scoped(value).map(|(_, rest)| rest).unwrap_or(value)
}

pub fn default_agent_for_provider(provider: Provider) -> &'static str {
    match provider {
        Provider::Codex => "codex",
        Provider::Claude => "claude",
        Provider::Opencode => "opencode",
        Provider::Acp => "codex",
    }
}

pub fn bind_import_target(
    selected_provider: Provider,
    selected_agent: Option<&str>,
    inferred_agent: Option<&str>,
    enabled: &[Provider],
) -> (Provider, String) {
    let agent = inferred_agent
        .or_else(|| selected_agent.filter(|value| !value.is_empty()))
        .unwrap_or_else(|| default_agent_for_provider(selected_provider))
        .to_string();
    let provider = provider_for_agent(&agent, enabled).unwrap_or(selected_provider);
    (provider, agent)
}

pub fn provider_for_agent(agent: &str, enabled: &[Provider]) -> Option<Provider> {
    let preferred = match agent {
        "codex" => Provider::Codex,
        "claude" => Provider::Claude,
        "opencode" => Provider::Opencode,
        _ => Provider::Acp,
    };
    if enabled.contains(&preferred) {
        Some(preferred)
    } else if preferred != Provider::Acp && enabled.contains(&Provider::Acp) {
        Some(Provider::Acp)
    } else {
        enabled.first().copied()
    }
}

fn trim_wrappers(input: &str) -> &str {
    input
        .trim()
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | '<' | '>' | '[' | ']'))
        .trim()
        .trim_end_matches(|ch| matches!(ch, '/' | '\\'))
        .trim()
}

fn split_scoped(value: &str) -> Option<(&str, &str)> {
    let (agent, rest) = value.split_once("::")?;
    if agent.is_empty() || rest.is_empty() || agent.contains('/') || agent.contains(':') {
        return None;
    }
    if KNOWN_AGENTS.contains(&agent) || AGENT_SCHEMES.iter().any(|(scheme, _)| *scheme == agent) {
        return Some((canonical_agent(agent), rest));
    }
    None
}

fn parse_uri(value: &str) -> Option<ParsedSessionRef> {
    let (scheme, rest) = value.split_once("://")?;
    let scheme = scheme.trim().to_ascii_lowercase();
    let rest = rest.split(['?', '#']).next().unwrap_or(rest).trim();
    let rest = rest.trim_start_matches("//");
    let parts: Vec<&str> = rest
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }
    let raw_id = (*parts.last().unwrap()).to_string();
    let mut agent = AGENT_SCHEMES
        .iter()
        .find(|(name, _)| *name == scheme)
        .map(|(_, agent)| (*agent).to_string());
    if agent.is_none() {
        agent = parts.iter().find_map(|part| infer_agent_token(part));
    }
    Some(ParsedSessionRef {
        raw_id,
        agent_id: agent,
    })
}

fn last_non_empty_segment(value: &str) -> &str {
    value
        .split(['/', '\\', '?', '#'])
        .filter(|part| !part.is_empty())
        .last()
        .unwrap_or(value)
}

fn infer_agent_token(value: &str) -> Option<String> {
    let lower = value.to_ascii_lowercase();
    AGENT_SCHEMES
        .iter()
        .find(|(name, _)| lower == *name || lower.split(['/', ':', '.']).any(|part| part == *name))
        .map(|(_, agent)| (*agent).to_string())
}

fn canonical_agent(value: &str) -> &str {
    AGENT_SCHEMES
        .iter()
        .find(|(name, _)| *name == value)
        .map(|(_, agent)| *agent)
        .unwrap_or(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_codex_thread_uri() {
        let parsed = parse_session_ref("  codex://threads/01a0634a-23df-7191-acd2-1fca43a10418  ");
        assert_eq!(parsed.raw_id, "01a0634a-23df-7191-acd2-1fca43a10418");
        assert_eq!(parsed.agent_id.as_deref(), Some("codex"));
    }

    #[test]
    fn extracts_quoted_and_angled_uris() {
        let parsed = parse_session_ref("<codex://thread/01a0634a-23df-7191-acd2-1fca43a10418>");
        assert_eq!(parsed.raw_id, "01a0634a-23df-7191-acd2-1fca43a10418");
        assert_eq!(parsed.agent_id.as_deref(), Some("codex"));
    }

    #[test]
    fn extracts_grok_and_claude_prefixes() {
        let grok = parse_session_ref("grok://sessions/01a0513a-7417-7553-8c77-399316ec7a9b");
        assert_eq!(grok.agent_id.as_deref(), Some("grok"));
        assert_eq!(grok.raw_id, "01a0513a-7417-7553-8c77-399316ec7a9b");

        let claude =
            parse_session_ref("claude-code://session/e2136e08-a223-4ae9-9b03-57180a8a822c");
        assert_eq!(claude.agent_id.as_deref(), Some("claude"));
        assert_eq!(claude.raw_id, "e2136e08-a223-4ae9-9b03-57180a8a822c");
    }

    #[test]
    fn keeps_scoped_acp_ids() {
        let parsed = parse_session_ref("grok::01a0513a-7417-7553-8c77-399316ec7a9b");
        assert_eq!(parsed.agent_id.as_deref(), Some("grok"));
        assert_eq!(parsed.raw_id, "01a0513a-7417-7553-8c77-399316ec7a9b");
        assert_eq!(scoped_session_id("codex", "grok::abc"), "grok::abc");
    }

    #[test]
    fn matches_raw_and_scoped_ids() {
        assert!(session_ids_match(
            "codex::01a0634a-23df-7191-acd2-1fca43a10418",
            "01a0634a-23df-7191-acd2-1fca43a10418"
        ));
        assert!(session_ids_match(
            "01a0634a-23df-7191-acd2-1fca43a10418",
            "codex::01a0634a-23df-7191-acd2-1fca43a10418"
        ));
    }

    #[test]
    fn switches_provider_from_inferred_agent() {
        let enabled = [Provider::Codex, Provider::Claude, Provider::Acp];
        let (provider, agent) =
            bind_import_target(Provider::Claude, Some("claude"), Some("grok"), &enabled);
        assert_eq!(provider, Provider::Acp);
        assert_eq!(agent, "grok");

        let (provider, agent) =
            bind_import_target(Provider::Acp, Some("grok"), Some("codex"), &enabled);
        assert_eq!(provider, Provider::Codex);
        assert_eq!(agent, "codex");
    }

    #[test]
    fn binds_known_selected_agents_to_their_native_provider() {
        let enabled = [Provider::Codex, Provider::Claude, Provider::Acp];

        let (provider, agent) = bind_import_target(Provider::Acp, Some("codex"), None, &enabled);
        assert_eq!(provider, Provider::Codex);
        assert_eq!(agent, "codex");

        let (provider, agent) = bind_import_target(Provider::Acp, Some("claude"), None, &enabled);
        assert_eq!(provider, Provider::Claude);
        assert_eq!(agent, "claude");

        let (provider, agent) = bind_import_target(Provider::Acp, Some("grok"), None, &enabled);
        assert_eq!(provider, Provider::Acp);
        assert_eq!(agent, "grok");
    }
}
