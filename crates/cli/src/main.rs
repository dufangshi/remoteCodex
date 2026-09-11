mod threads;
use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "remote-codex",
    version,
    about = "Remote Codex supervisor and relay"
)]
struct Cli {
    #[command(flatten)]
    connection: threads::Connection,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create, contact, and inspect threads on the local Supervisor.
    Thread {
        #[command(subcommand)]
        command: threads::ThreadCommand,
    },
    /// Read recent conversation text, then expand one turn or item.
    Transcript(threads::Transcript),
    /// Print the bundled thread interaction skill.
    Skill,

    /// Run the local supervisor HTTP API.
    Supervisor,
    /// Alias for supervisor (local mode).
    Start,
    /// Print a simple status payload.
    Status,
    /// Run the public relay server.
    Relay,
    /// Inspect or apply a non-destructive relay database migration.
    RelayMigrate {
        /// Relay data directory containing relay-store.sqlite or relay.sqlite.
        #[arg(
            long,
            env = "REMOTE_CODEX_RELAY_DATA_DIR",
            default_value = ".local/relay-server"
        )]
        data_dir: std::path::PathBuf,
        /// Print the migration plan and row counts without writing any files.
        #[arg(long)]
        dry_run: bool,
        /// Proceed while preserving data for relay features not yet implemented in Rust.
        #[arg(long, conflicts_with = "dry_run")]
        allow_unsupported_data: bool,
    },
    /// Run a supervisor that connects out to a relay.
    RelaySupervisor,
    /// Show the device encryption fingerprint for independent browser verification.
    RelayFingerprint {
        /// Supervisor database path; defaults to relay-mode configuration.
        #[arg(long, env = "REMOTE_CODEX_DATABASE_PATH")]
        database: Option<std::path::PathBuf>,
    },
    /// Print version.
    Version,
}

#[tokio::main]
async fn main() -> Result<()> {
    if std::env::args().nth(1).as_deref() == Some("app-server")
        && std::env::var_os("REMOTE_CODEX_APP_SERVER_BRIDGE").is_some()
    {
        return remote_codex_runtime::acp::run_codex_app_server_bridge().await;
    }
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,rusqlite=warn,hyper=warn".into()),
        )
        .init();
    let cli = Cli::parse();
    match cli.command {
        Commands::Skill => println!(
            "{}",
            include_str!("../../../skills/thread-interaction/SKILL.md")
        ),
        Commands::Thread { command } => {
            let value = threads::Client::new(cli.connection)?
                .thread(command)
                .await?;
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
        Commands::Transcript(query) => {
            let value = threads::Client::new(cli.connection)?
                .transcript(query)
                .await?;
            println!("{}", serde_json::to_string_pretty(&value)?);
        }

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
        Commands::RelayMigrate {
            data_dir,
            dry_run,
            allow_unsupported_data,
        } => {
            let report = if dry_run {
                remote_codex_relay::inspect_relay_migration(&data_dir)?
            } else {
                remote_codex_relay::migrate_relay_data_dir_with_options(
                    &data_dir,
                    remote_codex_relay::RelayMigrationOptions {
                        allow_unsupported_data,
                    },
                )?
            };
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        Commands::RelaySupervisor => {
            std::env::set_var("REMOTE_CODEX_MODE", "relay");
            let state = remote_codex_runtime::boot().await?;
            remote_codex_supervisor::serve(state).await?;
        }
        Commands::RelayFingerprint { database } => {
            std::env::set_var("REMOTE_CODEX_MODE", "relay");
            let database = database
                .unwrap_or_else(|| remote_codex_runtime::RuntimeConfig::from_env().database_url);
            println!(
                "SHA-256 {}",
                remote_codex_supervisor::relay_device_fingerprint(&database)?
            );
        }
        Commands::Version => {
            println!("{}", env!("CARGO_PKG_VERSION"));
        }
    }
    Ok(())
}

async fn reqwest_status(port: &str) -> Result<String> {
    let response = reqwest::get(format!("http://127.0.0.1:{port}/healthz")).await?;
    if !response.status().is_success() {
        anyhow::bail!("unhealthy: HTTP {}", response.status());
    }
    Ok(response.text().await?)
}
