use anyhow::{ensure, Context, Result};
use clap::{Args, Subcommand};
use serde_json::{json, Value};
use std::{io::Read, path::PathBuf};

#[derive(Args)]
pub struct Connection {
    #[arg(long, global = true, env = "REMOTE_CODEX_URL")]
    pub url: Option<String>,
    #[arg(
        long,
        global = true,
        env = "REMOTE_CODEX_TOKEN",
        hide_env_values = true
    )]
    pub token: Option<String>,
    #[arg(long, global = true, env = "REMOTE_CODEX_THREAD_ID")]
    pub from: Option<String>,
    #[arg(long, global = true, env = "REMOTE_CODEX_CLI_CONFIG")]
    pub cli_config: Option<PathBuf>,
}
#[derive(Args)]
pub struct Body {
    #[arg(long, conflicts_with = "text_file")]
    pub text: Option<String>,
    #[arg(long)]
    pub text_file: Option<PathBuf>,
    #[arg(long)]
    pub notify_on_complete: bool,
    #[arg(long)]
    pub request_id: Option<String>,
}
impl Body {
    fn text(&self) -> Result<Option<String>> {
        Ok(if let Some(path) = &self.text_file {
            Some(if path.as_os_str() == "-" {
                let mut s = String::new();
                std::io::stdin().take(262145).read_to_string(&mut s)?;
                s
            } else {
                std::fs::read_to_string(path)?
            })
        } else {
            self.text.clone()
        })
    }
}
#[derive(Subcommand)]
pub enum ThreadCommand {
    /// Current remoteCodex thread identity and status.
    #[command(name = "self")]
    SelfInfo,
    List {
        #[arg(long)]
        workspace: Option<String>,
        #[arg(long, default_value_t = 20)]
        limit: u32,
    },
    Show {
        id: String,
    },
    Status {
        id: String,
    },
    Backends,
    Models {
        #[arg(long, default_value = "acp")]
        provider: String,
        #[arg(long)]
        agent: Option<String>,
    },
    Create {
        #[arg(long)]
        workspace: Option<String>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long, default_value = "acp")]
        provider: String,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long, default_value = "default")]
        model: String,
        #[arg(long)]
        reasoning_effort: Option<String>,
        #[arg(long,value_parser=["guarded","yolo"])]
        approval_mode: Option<String>,
        #[command(flatten)]
        body: Body,
    },
    /// Submit a prompt and return immediately after durable acceptance.
    Send {
        id: String,
        #[command(flatten)]
        body: Body,
    },
}
#[derive(Args)]
pub struct Transcript {
    pub id: String,
    #[arg(long, default_value_t = 3)]
    pub limit: u32,
    #[arg(long, conflicts_with = "turn")]
    pub before_turn: Option<String>,
    #[arg(long)]
    pub turn: Option<String>,
    #[arg(long, requires = "turn")]
    pub item: Option<String>,
    #[arg(long,value_parser=["overview","turn"])]
    pub view: Option<String>,
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
    #[arg(long, default_value_t = 0)]
    pub text_offset: u32,
    #[arg(long, requires = "item")]
    pub raw: bool,
}

pub struct Client {
    url: String,
    token: String,
    pub from: Option<String>,
    http: reqwest::Client,
}
impl Client {
    pub fn new(c: Connection) -> Result<Self> {
        let path = c.cli_config.unwrap_or_else(|| {
            remote_codex_runtime::RuntimeConfig::from_env()
                .database_url
                .with_extension("cli.json")
        });
        let saved: Value = std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(Value::Null);
        let url=c.url.or_else(||saved["url"].as_str().map(str::to_owned)).context("No local Supervisor connection. Set REMOTE_CODEX_URL and REMOTE_CODEX_TOKEN, or --cli-config PATH.")?;
        let parsed = reqwest::Url::parse(&url)?;
        ensure!(
            matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
                && parsed.scheme() == "http",
            "CLI requires a local loopback HTTP Supervisor URL"
        );
        let token = c
            .token
            .or_else(|| saved["token"].as_str().map(str::to_owned))
            .context("Local CLI token is missing")?;
        Ok(Self {
            url,
            token,
            from: c.from,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
        })
    }
    async fn request(&self, input: Value) -> Result<Value> {
        let response = self
            .http
            .post(format!("{}/api/cli", self.url.trim_end_matches('/')))
            .bearer_auth(&self.token)
            .json(&input)
            .send()
            .await?;
        let status = response.status();
        let value: Value = response.json().await?;
        ensure!(status.is_success(), "HTTP {status}: {value}");
        Ok(value)
    }
    async fn id(&self, value: &str) -> Result<String> {
        if value.starts_with("https://") || value.starts_with("http://") {
            let url = reqwest::Url::parse(value)?;
            let parts = url
                .path_segments()
                .context("invalid thread URL")?
                .collect::<Vec<_>>();
            ensure!(
                parts.len() == 4 && parts[0] == "devices" && parts[2] == "threads",
                "expected /devices/DEVICE/threads/THREAD URL"
            );
            let info = self.request(json!({"operation":"info"})).await?;
            ensure!(
                info["deviceId"].as_str() == Some(parts[1]),
                "thread URL belongs to another device"
            );
            return Ok(uuid::Uuid::parse_str(parts[3])?.to_string());
        }
        Ok(uuid::Uuid::parse_str(value)?.to_string())
    }
    async fn send(&self, id: &str, body: &Body) -> Result<Value> {
        let text = body
            .text()?
            .context("send requires --text or --text-file")?;
        self.request(json!({"operation":"send","threadId":id,"text":text,"fromThreadId":self.from,"notifyOnComplete":body.notify_on_complete,"clientRequestId":body.request_id})).await
    }
    pub async fn thread(&self, command: ThreadCommand) -> Result<Value> {
        match command {
            ThreadCommand::SelfInfo=>self.request(json!({"operation":"status","threadId":self.from.as_ref().context("Current thread is unknown; use --from ID")?})).await,
            ThreadCommand::List{workspace,limit}=>self.request(json!({"operation":"list","workspaceId":workspace,"limit":limit})).await,
            ThreadCommand::Show{id}|ThreadCommand::Status{id}=>self.request(json!({"operation":"status","threadId":self.id(&id).await?})).await,
            ThreadCommand::Backends=>self.request(json!({"operation":"backends"})).await,
            ThreadCommand::Models{provider,agent}=>self.request(json!({"operation":"models","provider":provider,"agentId":agent,"fromThreadId":self.from})).await,
            ThreadCommand::Send{id,body}=>self.send(&self.id(&id).await?,&body).await,
            ThreadCommand::Create{workspace,title,provider,agent,model,reasoning_effort,approval_mode,body}=>{
                ensure!(!body.notify_on_complete || body.text.is_some() || body.text_file.is_some(),"notification requires an initial prompt");
                ensure!(!body.notify_on_complete || self.from.is_some(),"notification requires --from ID or managed thread context");
                let mut input=json!({"operation":"create","title":title,"provider":provider,"agentId":agent,"model":model,"reasoningEffort":reasoning_effort,"fromThreadId":self.from});
                if let Some(ws)=workspace {input["workspaceId"]=json!(ws);}
                if let Some(mode)=approval_mode {input["approvalMode"]=json!(mode);}
                let mut result=self.request(input).await?;
                if body.text.is_some() || body.text_file.is_some() {
                    let id=result["threadId"].as_str().context("create returned no thread ID")?.to_string();
                    result["send"]=self.send(&id,&body).await.with_context(||format!("Thread {id} was created, but initial send failed; reuse this thread"))?;
                }
                Ok(result)
            }
        }
    }
    pub async fn transcript(&self, q: Transcript) -> Result<Value> {
        self.request(json!({"operation":"transcript","threadId":self.id(&q.id).await?,"limit":q.limit,"beforeTurnId":q.before_turn,"turnId":q.turn,"itemId":q.item,"view":q.view,"offset":q.offset,"textOffset":q.text_offset,"raw":q.raw})).await
    }
}
