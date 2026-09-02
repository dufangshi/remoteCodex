use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "remote-codex",
    version,
    about = "Remote Codex supervisor and relay"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run the local supervisor HTTP API.
    Supervisor,
    /// Alias for supervisor (local mode).
    Start,
    /// Print a simple status payload.
    Status,
    /// Run the public relay server.
    Relay,
    /// Run a supervisor that connects out to a relay.
    RelaySupervisor,
    /// Print version.
    Version,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,rusqlite=warn,hyper=warn".into()),
        )
        .init();
    let cli = Cli::parse();
    match cli.command {
        Commands::Supervisor | Commands::Start => {
            let state = remote_codex_runtime::boot().await?;
            remote_codex_supervisor::serve(state).await?;
        }
        Commands::Status => {
            let port = std::env::var("PORT").unwrap_or_else(|_| "8787".into());
            match reqwest_status(&port).await {
                Ok(body) => println!("{body}"),
                Err(_) => println!("{{\"status\":\"stopped\",\"port\":{port}}}"),
            }
        }
        Commands::Relay => {
            remote_codex_relay::serve().await?;
        }
        Commands::RelaySupervisor => {
            std::env::set_var("REMOTE_CODEX_MODE", "relay");
            let state = remote_codex_runtime::boot().await?;
            remote_codex_supervisor::serve(state).await?;
        }
        Commands::Version => {
            println!("{}", env!("CARGO_PKG_VERSION"));
        }
    }
    Ok(())
}

async fn reqwest_status(port: &str) -> Result<String> {
    let body = tokio::process::Command::new("curl")
        .args(["-fsS", &format!("http://127.0.0.1:{port}/healthz")])
        .output()
        .await?;
    if !body.status.success() {
        anyhow::bail!("unhealthy");
    }
    Ok(String::from_utf8_lossy(&body.stdout).into_owned())
}
