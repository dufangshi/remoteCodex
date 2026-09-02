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
            "codex",
            "codex-acp",
            Some("npm install -g @agentclientprotocol/codex-acp@latest"),
            None,
        ),
        def(
            "claude",
            "Claude Agent",
            "adapter",
            "claude",
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
            "opencode",
            "opencode acp",
            None,
            Some("opencode models"),
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
        let exe = custom.split_whitespace().next().unwrap_or("acp");
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
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        dirs.extend([
            home.join(".local/bin"),
            home.join(".grok/bin"),
            home.join(".cargo/bin"),
            home.join(".local/share/fnm/aliases/default/bin"),
            home.join(".fnm/aliases/default/bin"),
            home.join(".npm-global/bin"),
        ]);
    }
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    dirs
}

pub fn augment_path() {
    let mut parts: Vec<String> = extra_bin_dirs()
        .into_iter()
        .filter(|dir| dir.is_dir())
        .map(|dir| dir.to_string_lossy().into_owned())
        .collect();
    if let Ok(path) = std::env::var("PATH") {
        for part in path.split(':') {
            if !part.is_empty() && !parts.iter().any(|existing| existing == part) {
                parts.push(part.to_string());
            }
        }
    }
    std::env::set_var("PATH", parts.join(":"));
}

pub fn resolve_executable(command: &str) -> Option<PathBuf> {
    let exe = command.split_whitespace().next().unwrap_or(command);
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
}
