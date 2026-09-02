pub mod acp;
pub mod actor;
pub mod config;
pub mod db;
pub mod fake;
pub mod files;
pub mod service;

pub use actor::{EventBus, SharedRuntime};
pub use config::RuntimeConfig;
pub use db::Database;
pub use service::{bootstrap_runtimes, Supervisor};

use anyhow::Result;
use std::sync::Arc;

pub async fn boot() -> Result<Arc<Supervisor>> {
    crate::acp::augment_path();
    let config = RuntimeConfig::from_env();
    let db = Database::open(&config.database_url)?;
    let runtimes = bootstrap_runtimes(&config);
    for runtime in &runtimes {
        runtime.start().await?;
    }
    Ok(Arc::new(Supervisor::new(config, db, runtimes)))
}
