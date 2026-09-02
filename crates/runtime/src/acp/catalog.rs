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
        ),
        def(
            "cursor",
            "Cursor Agent",
            "native",
            "cursor-agent",
            "cursor-agent acp",
            None,
        ),
        def(
            "codex",
            "OpenAI Codex",
            "adapter",
            "codex",
            "codex-acp",
            Some("npm install -g @agentclientprotocol/codex-acp@latest"),
        ),
        def(
            "claude",
            "Claude Agent",
            "adapter",
            "claude",
            "claude-agent-acp",
            Some("npm install -g @agentclientprotocol/claude-agent-acp@latest"),
        ),
        def(
            "gemini",
            "Gemini CLI",
            "native",
            "gemini",
            "gemini --acp",
            None,
        ),
        def(
            "copilot",
            "GitHub Copilot CLI",
            "native",
            "copilot",
            "copilot --acp",
            None,
        ),
        def(
            "opencode",
            "OpenCode",
            "native",
            "opencode",
            "opencode acp",
            None,
        ),
        def(
            "deepseek",
            "DeepSeek Harness",
            "native",
            "dsh",
            "dsh --profile acp",
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
) -> AcpAgentDef {
    AcpAgentDef {
        id: id.into(),
        display_name: name.into(),
        description: format!("{name} over ACP."),
        transport: transport.into(),
        base_command: base.into(),
        server_command: server.into(),
        install_command: install.map(str::to_string),
    }
}

pub fn command_available(command: &str) -> bool {
    let exe = command.split_whitespace().next().unwrap_or(command);
    which(exe).is_ok()
}
