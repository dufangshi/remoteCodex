mod export;
mod http;
mod shells;
mod tunnel;

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Result;
use remote_codex_runtime::Supervisor;
use tokio::net::TcpListener;

pub use http::router;
pub use tunnel::run_relay_tunnel;

pub async fn serve(state: Arc<Supervisor>) -> Result<()> {
    state.spawn_live_item_persister();
    let addr: SocketAddr = format!("{}:{}", state.config.host, state.config.port).parse()?;
    let listener = TcpListener::bind(addr).await?;
    tracing::info!("supervisor listening on {addr}");
    if state.config.mode == remote_codex_protocol::Mode::Relay {
        let tunnel_state = state.clone();
        tokio::spawn(async move {
            if let Err(err) = run_relay_tunnel(tunnel_state).await {
                tracing::error!(error = %err, "relay tunnel exited");
            }
        });
    }
    axum::serve(listener, router(state)).await?;
    Ok(())
}
