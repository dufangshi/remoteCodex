mod adapter;
mod capabilities;
mod catalog;
mod codex_bridge;
mod codex_models;
pub use codex_bridge::run as run_codex_app_server_bridge;
mod elicitation;
mod grok;
pub(crate) use grok::billing_usage as grok_billing_usage;
mod mapper;
mod modes;
mod prompt;
pub(crate) mod rpc;
mod runtime;
mod terminal;

pub use adapter::{
    adapter_for, ClaudeAdapter, CodexAdapter, CursorAdapter, DeepSeekAdapter, GrokAdapter,
    HarnessAdapter, StandardAdapter,
};
pub use capabilities::NegotiatedCaps;
pub use catalog::{
    augment_path, builtin_agents, classify_availability, command_available, parse_command_models,
};
pub use modes::{parse_available_modes, ProductSessionPolicy};
pub use runtime::AcpRuntime;

mod usage;

pub(crate) use catalog::command_program;
