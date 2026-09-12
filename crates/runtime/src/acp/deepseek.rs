//! DSH startup discovery runs as a plugin in the process owned by ACP. The
//! appReady boundary joins asynchronous provider loading before initialize/new.
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    net::TcpListener,
};

pub(super) struct Discovery {
    listener: TcpListener,
    token: String,
    pub directory: tempfile::TempDir,
}

impl Discovery {
    pub async fn prepare(command: &mut String) -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let token = uuid::Uuid::new_v4().to_string();
        let directory = tempfile::tempdir()?;
        let plugin = directory.path().join("discovery.mjs");
        std::fs::write(&plugin, include_str!("deepseek-plugin.mjs"))?;
        let patch = directory.path().join("patch.json");
        std::fs::write(
            &patch,
            serde_json::to_vec(&json!([{"insert":[{
                "id":"remote-codex-discovery", "name":plugin,
                "config":{"port":listener.local_addr()?.port(),"token":token}
            }]}]))?,
        )?;
        command.push_str(" --patch ");
        if cfg!(windows) {
            // cmd.exe does not interpret POSIX single-quoted arguments.
            command.push_str(&format!("\"{}\"", patch.to_string_lossy()));
        } else {
            command.push_str(&shell_words::quote(&patch.to_string_lossy()));
        }
        Ok(Self {
            listener,
            token,
            directory,
        })
    }

    pub async fn receive(&self) -> Result<Value> {
        loop {
            let (stream, _) = self.listener.accept().await?;
            let mut reader = BufReader::new(stream.take(2 * 1024 * 1024));
            let mut line = String::new();
            if !matches!(
                tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    reader.read_line(&mut line)
                )
                .await,
                Ok(Ok(_))
            ) {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if value["token"].as_str() != Some(self.token.as_str()) {
                continue;
            }
            if let Some(error) = value["error"].as_str() {
                bail!("DSH discovery: {error}");
            }
            return value
                .get("data")
                .cloned()
                .context("DSH discovery returned no data");
        }
    }
}
