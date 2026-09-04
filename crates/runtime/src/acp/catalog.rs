use std::path::PathBuf;

use which::which;

#[derive(Clone, Debug)]
pub struct AcpAgentDef {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub transport: String,
    pub base_command: String,
    pub server_command: String,
    pub install_command: Option<String>,
    pub model_list_command: Option<String>,
}

pub fn builtin_agents(custom: Option<&str>) -> Vec<AcpAgentDef> {
    builtin_agents_with_commands(
        custom,
        std::env::var("CODEX_COMMAND").ok().as_deref(),
        std::env::var("CLAUDE_COMMAND").ok().as_deref(),
        std::env::var("OPENCODE_COMMAND").ok().as_deref(),
    )
}

fn builtin_agents_with_commands(
    custom: Option<&str>,
    codex_command: Option<&str>,
    claude_command: Option<&str>,
    opencode_command: Option<&str>,
) -> Vec<AcpAgentDef> {
    let codex_command = nonempty_command(codex_command).unwrap_or("codex");
    let claude_command = nonempty_command(claude_command).unwrap_or("claude");
    let opencode_command = nonempty_command(opencode_command).unwrap_or("opencode");
    let opencode_server = command_with_subcommand(opencode_command, "acp");
    let opencode_models = command_with_subcommand(opencode_command, "models");
    let mut agents = vec![
        def(
            "grok",
            "Grok Build",
            "native",
            "grok",
            "grok agent stdio",
            None,
            Some("grok models"),
        ),
        def(
            "cursor",
            "Cursor Agent",
            "native",
            "cursor-agent",
            "cursor-agent acp",
            None,
            None,
        ),
        def(
            "codex",
            "OpenAI Codex",
            "adapter",
            codex_command,
            "codex-acp",
            Some("npm install -g @agentclientprotocol/codex-acp@latest"),
            None,
        ),
        def(
            "claude",
            "Claude Agent",
            "adapter",
            claude_command,
            "claude-agent-acp",
            Some("npm install -g @agentclientprotocol/claude-agent-acp@latest"),
            None,
        ),
        def(
            "gemini",
            "Gemini CLI",
            "native",
            "gemini",
            "gemini --acp",
            None,
            None,
        ),
        def(
            "copilot",
            "GitHub Copilot CLI",
            "native",
            "copilot",
            "copilot --acp",
            None,
            None,
        ),
        def(
            "opencode",
            "OpenCode",
            "native",
            opencode_command,
            &opencode_server,
            None,
            Some(&opencode_models),
        ),
        def(
            "deepseek",
            "DeepSeek Harness",
            "native",
            "dsh",
            "dsh --profile acp",
            None,
            None,
        ),
    ];
    if let Some(custom) = custom
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "grok agent stdio")
    {
        let parsed = shell_words::split(custom).unwrap_or_default();
        let exe = parsed.first().map(String::as_str).unwrap_or("acp");
        agents.push(def(
            "custom",
            "Custom ACP Agent",
            "custom",
            exe,
            custom,
            None,
            None,
        ));
    }
    agents
}

fn nonempty_command(command: Option<&str>) -> Option<&str> {
    command.map(str::trim).filter(|command| !command.is_empty())
}

fn command_with_subcommand(command: &str, subcommand: &str) -> String {
    let Ok(mut parts) = shell_words::split(command) else {
        return format!("{command} {subcommand}");
    };
    if parts.is_empty() {
        return subcommand.to_string();
    }
    parts.insert(1, subcommand.to_string());
    shell_words::join(parts)
}

fn def(
    id: &str,
    name: &str,
    transport: &str,
    base: &str,
    server: &str,
    install: Option<&str>,
    model_list: Option<&str>,
) -> AcpAgentDef {
    AcpAgentDef {
        id: id.into(),
        display_name: name.into(),
        description: format!("{name} over ACP."),
        transport: transport.into(),
        base_command: base.into(),
        server_command: server.into(),
        install_command: install.map(str::to_string),
        model_list_command: model_list.map(str::to_string),
    }
}

pub fn extra_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = crate::config::home_dir();
    dirs.extend([
        home.join(".local/bin"),
        home.join(".grok/bin"),
        home.join(".cargo/bin"),
        home.join(".local/share/fnm/aliases/default/bin"),
        home.join(".fnm/aliases/default/bin"),
        home.join(".npm-global/bin"),
    ]);
    if let Ok(app_data) = std::env::var("APPDATA") {
        dirs.push(PathBuf::from(app_data).join("npm"));
    }
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    dirs
}

pub fn augment_path() {
    let mut parts: Vec<PathBuf> = extra_bin_dirs()
        .into_iter()
        .filter(|dir| dir.is_dir())
        .collect();
    if let Ok(path) = std::env::var("PATH") {
        for part in std::env::split_paths(&path) {
            if !part.as_os_str().is_empty() && !parts.iter().any(|existing| existing == &part) {
                parts.push(part);
            }
        }
    }
    if let Ok(path) = std::env::join_paths(parts) {
        std::env::set_var("PATH", path);
    }
}

pub fn resolve_executable(command: &str) -> Option<PathBuf> {
    let parsed = shell_words::split(command).ok()?;
    let exe = parsed.first().map(String::as_str).unwrap_or(command);
    if exe.contains('/') {
        let path = PathBuf::from(exe);
        return path.exists().then_some(path);
    }
    if let Ok(path) = which(exe) {
        return Some(path);
    }
    extra_bin_dirs().into_iter().find_map(|dir| {
        let candidate = dir.join(exe);
        candidate.is_file().then_some(candidate)
    })
}

pub fn command_available(command: &str) -> bool {
    resolve_executable(command).is_some()
}

pub fn classify_availability(def: &AcpAgentDef) -> &'static str {
    let base = command_available(&def.base_command);
    let server = command_available(&def.server_command);
    if !base {
        "base_missing"
    } else if def.transport == "adapter" && !server {
        "adapter_missing"
    } else if !server {
        "server_unavailable"
    } else {
        "ready"
    }
}

pub fn parse_command_models(output: &str) -> Vec<(String, bool)> {
    let default_model = output
        .lines()
        .find_map(|line| {
            line.trim()
                .strip_prefix("Default model:")
                .map(|value| value.trim().to_string())
        })
        .filter(|value| !value.is_empty());
    let mut models = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        let (name, marked_default) = if let Some(rest) = trimmed.strip_prefix("* ") {
            (rest.trim(), true)
        } else if let Some(rest) = trimmed.strip_prefix("- ") {
            (rest.trim(), false)
        } else {
            continue;
        };
        let name = name
            .split_whitespace()
            .next()
            .unwrap_or(name)
            .trim_end_matches("(default)")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let is_default = marked_default
            || default_model.as_deref() == Some(name.as_str())
            || trimmed.contains("(default)");
        if !models.iter().any(|(existing, _)| existing == &name) {
            models.push((name, is_default));
        }
    }
    if !models.iter().any(|(_, is_default)| *is_default) {
        if let Some(first) = models.first_mut() {
            first.1 = true;
        }
    }
    models
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_grok_style_model_list() {
        let models = parse_command_models(
            "Default model: grok-4\n\nAvailable models:\n  * grok-4 (default)\n  - grok-3\n",
        );
        assert_eq!(models[0].0, "grok-4");
        assert!(models[0].1);
        assert_eq!(models[1].0, "grok-3");
        assert!(!models[1].1);
    }

    #[test]
    fn adapter_missing_when_only_base_exists() {
        let def = def(
            "codex",
            "OpenAI Codex",
            "adapter",
            "definitely-missing-codex-base",
            "definitely-missing-codex-acp",
            Some("npm install -g @agentclientprotocol/codex-acp@latest"),
            None,
        );
        assert_eq!(classify_availability(&def), "base_missing");
    }

    #[test]
    fn custom_agent_preserves_quoted_executable_path() {
        let agents = builtin_agents(Some("'/opt/Remote Codex/acp-agent' --stdio"));
        let custom = agents.iter().find(|agent| agent.id == "custom").unwrap();
        assert_eq!(custom.base_command, "/opt/Remote Codex/acp-agent");
        assert_eq!(
            custom.server_command,
            "'/opt/Remote Codex/acp-agent' --stdio"
        );
    }

    #[test]
    fn configured_provider_commands_preserve_adapters_and_derive_native_subcommands() {
        let agents = builtin_agents_with_commands(
            None,
            Some("'/opt/Codex CLI/codex'"),
            Some("/opt/claude-custom"),
            Some("'/opt/Open Code/opencode' --profile team"),
        );
        let codex = agents.iter().find(|agent| agent.id == "codex").unwrap();
        assert_eq!(codex.base_command, "'/opt/Codex CLI/codex'");
        assert_eq!(codex.server_command, "codex-acp");
        let claude = agents.iter().find(|agent| agent.id == "claude").unwrap();
        assert_eq!(claude.base_command, "/opt/claude-custom");
        assert_eq!(claude.server_command, "claude-agent-acp");
        let opencode = agents.iter().find(|agent| agent.id == "opencode").unwrap();
        assert_eq!(
            opencode.server_command,
            "'/opt/Open Code/opencode' acp --profile team"
        );
        assert_eq!(
            opencode.model_list_command.as_deref(),
            Some("'/opt/Open Code/opencode' models --profile team")
        );
    }
}
