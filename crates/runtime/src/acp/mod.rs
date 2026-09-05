mod adapter;
mod capabilities;
mod catalog;
mod elicitation;
mod grok;
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
pub use catalog::{augment_path, classify_availability, command_available, parse_command_models};
pub use modes::{parse_available_modes, ProductSessionPolicy};
pub use runtime::AcpRuntime;

mod usage;
