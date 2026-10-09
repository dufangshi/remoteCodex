// Adapted from CC Switch src-tauri/src/live/floor.rs.
// Copyright (c) 2025 Jason Young. Licensed under MIT.
// Source revision: 889b797d8aa252299221ed6569f992bda0a31a72.
// See THIRD_PARTY_NOTICES.md for the full license.
// Provider-owned fields are cleared before applying a direct Claude upstream.
// User-owned hooks, MCP, permissions and feature flags remain untouched.
/// Claude Code 的协议选择器。
///
/// `CLAUDE_CODE_USE_` 不能按前缀匹配：同一前缀下还有 `USE_POWERSHELL_TOOL`、
/// `USE_NATIVE_FILE_SEARCH`、`USE_COWORK_PLUGINS`、`USE_CCR_V2` 这类与供应商无关的
/// 功能开关（Claude Code 2.1.282 核实）。预设里出现的 `CLAUDE_CODE_USE_*` 必须在这里。
pub const CLAUDE_PROTOCOL_SELECTORS: &[&str] = &[
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_GATEWAY",
    "CLAUDE_CODE_USE_MANTLE",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
];

/// `env` 里整个前缀都属于连接和鉴权的前缀：`ANTHROPIC_*` 是地址、凭据、各档模型名、
/// 自定义头；`AWS_*` 是 Bedrock 的区域与凭据；`VERTEX_REGION_*` 是 Vertex 的分模型区域。
pub const CLAUDE_FLOOR_ENV_PREFIXES: &[&str] = &["ANTHROPIC_", "AWS_", "VERTEX_REGION_"];

/// `env` 里按名字列出的关键字段（协议选择器之外）。
pub const CLAUDE_FLOOR_ENV_KEYS: &[&str] = &[
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
    "CLOUD_ML_REGION",
    // Vertex 的凭据路径。
    "GOOGLE_APPLICATION_CREDENTIALS",
    // 订阅账号的长期 token 及其配套键。
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
    "CLAUDE_CODE_OAUTH_SCOPES",
    // 与顶层 apiKeyHelper 配套。
    "CLAUDE_CODE_API_KEY_HELPER_TTL_MS",
];

/// Claude Code `settings.json` 的 `env` 里，这个键是否是关键字段。
///
/// 前端的预设扫描（`tests/config/claudeKeyFields.json`）是这里的镜像，由下面的测试
/// 保证两边一致。
pub fn claude_floor_env(key: &str) -> bool {
    CLAUDE_FLOOR_ENV_PREFIXES
        .iter()
        .any(|prefix| key.starts_with(prefix))
        || CLAUDE_PROTOCOL_SELECTORS.contains(&key)
        || CLAUDE_FLOOR_ENV_KEYS.contains(&key)
        || (key.starts_with("CLAUDE_CODE_SKIP_") && key.ends_with("_AUTH"))
}

/// Claude Code `settings.json` 顶层的关键字段。
pub const CLAUDE_FLOOR_TOP: &[&str] = &[
    "apiKeyHelper",
    "apiBaseUrl",
    "primaryModel",
    "smallFastModel",
    // 旧 Bedrock API Key 预设写在顶层的真实 Key。
    "apiKey",
    // `/model` 保存的选择，属于当时所在的那一家。
    "model",
    // 备用模型链；模型 ID → 供应商专属 ID（如 Bedrock ARN）。
    "fallbackModel",
    "modelOverrides",
    // `/model` 选择器的行：聚合模式下是 CC Switch 列的 Stack 模型，其余时候不留。
    "modelPicker",
    // advisor 只在 Anthropic API 上可用。
    "advisorModel",
    // Bedrock / Vertex 的凭据命令。
    "awsAuthRefresh",
    "awsCredentialExport",
    "gcpAuthRefresh",
];

pub fn claude_floor_top(key: &str) -> bool {
    CLAUDE_FLOOR_TOP.contains(&key)
}
