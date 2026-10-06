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
    /// inbox is passive (send default); queue assigns a task (create default); direct/steer require an urgent correction or unblock request plus --interrupt-reason for peer sends.
    #[arg(long, value_parser=["inbox","direct","queue","steer"])]
    pub delivery: Option<String>,
    /// Completion notifications are passive inbox mail; they never wake or queue the caller.
    #[arg(long, default_value="inbox", value_parser=["inbox"], requires="notify_on_complete")]
    pub notify_delivery: String,
    /// One-line summary, shown in `inbox list` and in the unread notice so the
    /// receiver can triage without opening the message. Strongly recommended.
    #[arg(long)]
    pub subject: Option<String>,
    /// What this message is for. `question` is the only kind that implies you are
    /// waiting on a reply; the rest are informational.
    #[arg(long, value_parser=["result","question","status","task"])]
    pub kind: Option<String>,
    /// Message id this answers, so the exchange correlates.
    #[arg(long, value_name = "MESSAGE_ID")]
    pub in_reply_to: Option<String>,
    /// Why waiting for the next checkpoint would cause harm or wasted work.
    /// Required for peer direct/steer; ordinary results and progress stay in inbox.
    #[arg(long)]
    pub interrupt_reason: Option<String>,
    /// Replace older full inbox status snapshots on this topic, from you only.
    /// Never use for results, questions, replies or incremental patches.
    #[arg(long)]
    pub topic_key: Option<String>,
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
    /// Threads a person started, with a count of the agent threads under each.
    List {
        #[arg(long)]
        workspace: Option<String>,
        #[arg(long, default_value_t = 20)]
        limit: u32,
        /// Include agent-created threads flat, instead of only lineage roots.
        #[arg(long)]
        all: bool,
        /// List the descendants of one root instead of the roots themselves.
        #[arg(long, value_name = "THREAD_ID")]
        group: Option<String>,
    },
    Show {
        id: String,
    },
    Status {
        id: String,
    },
    /// Delete your own finished or unused direct child. Running/queued children and children with descendants are refused.
    Delete {
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
        /// Address for this delegate, unique among open threads in your lineage
        /// (`reviewer`). Every command that takes a thread id accepts it.
        #[arg(long)]
        name: Option<String>,
        /// Start from `.remote-codex/agents/ROLE.md` (workspace, then home): its
        /// model/effort/agent become defaults and its body prefixes the first prompt.
        #[arg(long)]
        role: Option<String>,
        /// Work in an isolated git worktree (sibling `REPO.worktrees/NAME`, branch
        /// `agent/NAME`) checked out from HEAD. Merge its branch when done.
        #[arg(long)]
        worktree: bool,
        /// Branch for --worktree; an existing branch is checked out as is.
        #[arg(long, value_name = "BRANCH")]
        worktree_branch: Option<String>,
        #[command(flatten)]
        body: Body,
    },
    /// Block until the threads settle (finish, fail, or go idle), one blocks on an
    /// approval, or the timeout passes. Returns each one's closing message.
    Wait {
        #[arg(required = true, num_args = 1..)]
        ids: Vec<String>,
        /// Return as soon as any one settles instead of all of them.
        #[arg(long)]
        any: bool,
        /// Seconds to wait (max 1800). Keep it below your shell tool's own timeout.
        #[arg(long, default_value_t = 300)]
        timeout: u64,
        /// Do not block: queue one turn on yourself when they all settle, so you can
        /// end your turn now.
        #[arg(long, conflicts_with_all = ["any", "timeout"])]
        wake: bool,
    },
    /// Your lineage at a glance: every delegate's state, unread mail, current task
    /// and worktree, plus task counts.
    Tree {
        /// A root thread id; defaults to your own lineage.
        root: Option<String>,
        /// Include closed threads.
        #[arg(long)]
        all: bool,
    },
    /// Close a finished delegate: frees its slot under the 20-thread cap and its
    /// name. History stays readable; prompting it again reopens it.
    Close {
        #[arg(required = true, num_args = 1..)]
        ids: Vec<String>,
        /// Also `git worktree remove` its worktree (fails if it has uncommitted changes).
        #[arg(long)]
        remove_worktree: bool,
    },
    /// Role templates available to `thread create --role`.
    Roles,
    /// Send passive mail or request execution; direct/steer also await the steering acknowledgement when running.
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
        self.request_for(input, 0).await
    }
    pub async fn skill(&self) -> Result<String> {
        let value = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            self.request(json!({"operation":"skill"})),
        )
        .await??;
        Ok(value["text"]
            .as_str()
            .context("Supervisor did not return a skill")?
            .to_owned())
    }
    /// `wait_seconds` extends the HTTP timeout for operations that block server-side.
    async fn request_for(&self, input: Value, wait_seconds: u64) -> Result<Value> {
        let response = self
            .http
            .post(format!("{}/api/cli", self.url.trim_end_matches('/')))
            .bearer_auth(&self.token)
            .timeout(std::time::Duration::from_secs(120 + wait_seconds.min(1800)))
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
        if let Ok(id) = uuid::Uuid::parse_str(value) {
            return Ok(id.to_string());
        }
        // A delegate name, or self/parent/root, resolved within the caller's lineage.
        let found = self
            .request(json!({"operation":"resolve","name":value,"fromThreadId":self.from}))
            .await?;
        Ok(found["threadId"]
            .as_str()
            .context("resolve returned no thread")?
            .to_string())
    }
    async fn send(&self, id: &str, body: &Body, default_delivery: &str) -> Result<Value> {
        let text = body
            .text()?
            .context("send requires --text or --text-file")?;
        self.request(json!({"operation":"send","threadId":id,"text":text,"delivery":body.delivery.as_deref().unwrap_or(default_delivery),"notifyDelivery":body.notify_delivery,"fromThreadId":self.from,"notifyOnComplete":body.notify_on_complete,"clientRequestId":body.request_id,"subject":body.subject,"kind":body.kind,"inReplyTo":body.in_reply_to,"interruptReason":body.interrupt_reason,"topicKey":body.topic_key})).await
    }
    pub async fn thread(&self, command: ThreadCommand) -> Result<Value> {
        match command {
            ThreadCommand::SelfInfo=>self.request(json!({"operation":"status","threadId":self.from.as_ref().context("Current thread is unknown; use --from ID")?})).await,
            ThreadCommand::List{workspace,limit,all,group}=>self.request(json!({"operation":"list","workspaceId":workspace,"limit":limit,"includeAgentThreads":all,"groupId":group})).await,
            ThreadCommand::Show{id}|ThreadCommand::Status{id}=>self.request(json!({"operation":"status","threadId":self.id(&id).await?})).await,
            ThreadCommand::Delete{id}=>self.request(json!({"operation":"delete","threadId":self.id(&id).await?,"fromThreadId":self.from})).await,
            ThreadCommand::Backends=>self.request(json!({"operation":"backends"})).await,
            ThreadCommand::Models{provider,agent}=>self.request(json!({"operation":"models","provider":provider,"agentId":agent,"fromThreadId":self.from})).await,
            ThreadCommand::Send{id,body}=>self.send(&self.id(&id).await?,&body,"inbox").await,
            ThreadCommand::Wait{ids,any,timeout,wake}=>{
                let mut resolved=Vec::new();
                for id in &ids { resolved.push(self.id(id).await?); }
                if wake {
                    return self.request(json!({"operation":"wake","threadIds":resolved,"fromThreadId":self.from})).await;
                }
                self.request_for(json!({"operation":"wait","threadIds":resolved,"any":any,"timeoutSeconds":timeout,"fromThreadId":self.from}),timeout).await
            }
            ThreadCommand::Tree{root,all}=>{
                let root=match root { Some(r)=>Some(self.id(&r).await?), None=>None };
                self.request(json!({"operation":"tree","rootThreadId":root,"all":all,"fromThreadId":self.from})).await
            }
            ThreadCommand::Close{ids,remove_worktree}=>{
                let (mut closed,mut failed)=(Vec::new(),Vec::new());
                for id in &ids {
                    let result=match self.id(id).await {
                        Ok(resolved)=>self.request(json!({"operation":"close","threadId":resolved,"removeWorktree":remove_worktree,"fromThreadId":self.from})).await,
                        Err(e)=>Err(e),
                    };
                    match result { Ok(v)=>closed.push(v), Err(e)=>failed.push(json!({"thread":id,"error":e.to_string()})) }
                }
                // The caller exits nonzero when `failed` is nonempty, so `&&` chains do
                // not treat a refusal as success; stdout stays plain JSON either way.
                Ok(json!({"closed":closed,"failed":failed}))
            }
            ThreadCommand::Roles=>self.request(json!({"operation":"roles","fromThreadId":self.from})).await,
            ThreadCommand::Create{workspace,title,provider,agent,model,reasoning_effort,approval_mode,name,role,worktree,worktree_branch,body}=>{
                ensure!(!body.notify_on_complete || body.text.is_some() || body.text_file.is_some(),"notification requires an initial prompt");
                ensure!(!body.notify_on_complete || self.from.is_some(),"notification requires --from ID or managed thread context");
                let mut input=json!({"operation":"create","title":title.clone().or_else(||name.clone()),"provider":provider,"agentId":agent,"model":model,"reasoningEffort":reasoning_effort,"fromThreadId":self.from,"name":name,"role":role,"worktree":worktree,"worktreeBranch":worktree_branch});
                if let Some(ws)=workspace {input["workspaceId"]=json!(ws);}
                if let Some(mode)=approval_mode {input["approvalMode"]=json!(mode);}
                let mut result=self.request(input).await?;
                if body.text.is_some() || body.text_file.is_some() {
                    let id=result["threadId"].as_str().context("create returned no thread ID")?.to_string();
                    // Label the opening message by construction rather than relying on the
                    // caller to remember: a create's initial prompt is a task by
                    // definition, and --title is already the one-line summary of it.
                    // Observed agents consistently omit these flags even when documented.
                    let mut body=body;
                    if body.kind.is_none() { body.kind=Some("task".into()); }
                    if body.subject.is_none() { body.subject=title.clone(); }
                    result["send"]=self.send(&id,&body,"queue").await.with_context(||format!("Thread {id} was created, but initial send failed; reuse this thread"))?;
                }
                Ok(result)
            }
        }
    }
    pub async fn transcript(&self, q: Transcript) -> Result<Value> {
        self.request(json!({"operation":"transcript","threadId":self.id(&q.id).await?,"limit":q.limit,"beforeTurnId":q.before_turn,"turnId":q.turn,"itemId":q.item,"view":q.view,"offset":q.offset,"textOffset":q.text_offset,"raw":q.raw})).await
    }
}

#[derive(Args)]
pub struct Inbox {
    /// Defaults to the managed caller's remoteCodex identity.
    #[arg(long, global = true)]
    pub thread: Option<String>,
    #[command(subcommand)]
    pub command: Option<InboxCommand>,
}
#[derive(Subcommand)]
pub enum InboxCommand {
    /// List bounded previews. Reading never marks mail as acknowledged.
    List {
        #[arg(long, default_value_t = 20)]
        limit: u32,
        #[arg(long)]
        before: Option<String>,
        #[arg(long)]
        all: bool,
        /// Only mail from these threads (ids or names). Repeatable.
        #[arg(long = "from-thread", value_name = "ID_OR_NAME")]
        from_threads: Vec<String>,
        /// Only these kinds. Repeatable; include question while waiting on results.
        #[arg(long, value_parser=["result","question","status","task"])]
        kind: Vec<String>,
    },
    /// Read one message, expanding long text in bounded chunks.
    Read {
        id: String,
        #[arg(long, default_value_t = 0)]
        text_offset: u32,
    },
    /// Acknowledge messages after handling them; keep them accessible with list --all.
    Ack {
        #[arg(required=true,num_args=1..)]
        ids: Vec<String>,
    },
    /// Block until unacknowledged mail (optionally from given threads or of given
    /// kinds) is waiting, and return it with text inline. Stays in your turn
    /// without polling.
    Wait {
        /// Only mail from these threads (ids or names). Repeatable.
        #[arg(long = "from-thread", value_name = "ID_OR_NAME")]
        from_threads: Vec<String>,
        /// Only these kinds (result, question, status, task). Repeatable.
        #[arg(long, value_parser=["result","question","status","task"])]
        kind: Vec<String>,
        /// Ignore mail already waiting when the wait starts.
        #[arg(long)]
        new: bool,
        /// Seconds to wait (max 1800). Keep it below your shell tool's own timeout.
        #[arg(long, default_value_t = 300)]
        timeout: u64,
    },
}
impl Client {
    pub async fn inbox(&self, args: Inbox) -> Result<Value> {
        let thread = args
            .thread
            .or_else(|| self.from.clone())
            .context("Current thread is unknown; pass --thread ID")?;
        let thread = self.id(&thread).await?;
        let mut input = match args.command.unwrap_or(InboxCommand::List {
            limit: 20,
            before: None,
            all: false,
            from_threads: vec![],
            kind: vec![],
        }) {
            InboxCommand::List {
                limit,
                before,
                all,
                from_threads,
                kind,
            } => {
                let mut from = Vec::new();
                for id in &from_threads {
                    from.push(self.id(id).await?);
                }
                json!({"operation":"inbox","limit":limit,"before":before,"all":all,"fromThreadIds":from,"kinds":kind})
            }
            InboxCommand::Read { id, text_offset } => {
                json!({"operation":"inboxRead","messageId":id,"textOffset":text_offset})
            }
            InboxCommand::Ack { ids } => json!({"operation":"inboxAck","messageIds":ids}),
            InboxCommand::Wait {
                from_threads,
                kind,
                new,
                timeout,
            } => {
                let mut from = Vec::new();
                for id in &from_threads {
                    from.push(self.id(id).await?);
                }
                let input = json!({"operation":"inboxWait","threadId":thread,"fromThreadIds":from,"kinds":kind,"onlyNew":new,"timeoutSeconds":timeout});
                return self.request_for(input, timeout).await;
            }
        };
        input["threadId"] = json!(thread);
        self.request(input).await
    }
}

/// A task board shared by every thread in one lineage.
#[derive(Subcommand)]
pub enum TaskCommand {
    /// Add a task. Use --after for dependencies and --assign to give it to a delegate.
    Add {
        title: String,
        #[arg(long, conflicts_with = "detail_file")]
        detail: Option<String>,
        #[arg(long)]
        detail_file: Option<PathBuf>,
        /// Task numbers that must complete first. Repeatable or comma-separated.
        #[arg(long, value_delimiter = ',')]
        after: Vec<i64>,
        /// Thread id or name that should do it; it gets passive mail.
        #[arg(long)]
        assign: Option<String>,
    },
    /// Open tasks with owner, dependencies and whether each is ready.
    List {
        /// Include completed and failed tasks.
        #[arg(long)]
        all: bool,
    },
    /// One task with its detail and result.
    Show { number: i64 },
    /// Take a task: the given one, or the lowest ready one assigned to you or nobody.
    /// `claimed: null` with `finished: false` means work is only blocked; use --wait.
    Claim {
        number: Option<i64>,
        /// Block while pending tasks are blocked on in-progress work, until one
        /// becomes ready or the board is finished.
        #[arg(long)]
        wait: bool,
        /// Seconds to wait (max 1800). Keep it below your shell tool's own timeout.
        #[arg(long, default_value_t = 300, requires = "wait")]
        timeout: u64,
    },
    /// Finish a task you own or created. Its creator gets the result as mail, and
    /// dependents become ready.
    Done {
        number: i64,
        #[arg(long, conflicts_with = "result_file")]
        result: Option<String>,
        #[arg(long)]
        result_file: Option<PathBuf>,
        /// Record failure instead; dependents stay blocked.
        #[arg(long)]
        failed: bool,
    },
    /// Hand an in-progress task back to the pool.
    Release { number: i64 },
}

fn read_text(inline: Option<String>, file: Option<PathBuf>) -> Result<Option<String>> {
    Ok(match file {
        Some(path) if path.as_os_str() == "-" => {
            let mut s = String::new();
            std::io::stdin().take(65537).read_to_string(&mut s)?;
            Some(s)
        }
        Some(path) => Some(std::fs::read_to_string(path)?),
        None => inline,
    })
}

impl Client {
    pub async fn task(&self, command: TaskCommand) -> Result<Value> {
        let from = self
            .from
            .clone()
            .context("Current thread is unknown; tasks belong to a lineage, pass --from ID")?;
        let input = match command {
            TaskCommand::Add {
                title,
                detail,
                detail_file,
                after,
                assign,
            } => {
                let assign = match assign {
                    Some(a) => Some(self.id(&a).await?),
                    None => None,
                };
                json!({"operation":"taskAdd","title":title,"detail":read_text(detail,detail_file)?,"after":after,"assignThreadId":assign})
            }
            TaskCommand::List { all } => json!({"operation":"taskList","all":all}),
            TaskCommand::Show { number } => json!({"operation":"taskShow","number":number}),
            TaskCommand::Claim {
                number,
                wait,
                timeout,
            } => {
                let input = json!({"operation":"taskClaim","number":number,"wait":wait,"timeoutSeconds":timeout,"fromThreadId":from});
                return self
                    .request_for(input, if wait { timeout } else { 0 })
                    .await;
            }
            TaskCommand::Done {
                number,
                result,
                result_file,
                failed,
            } => {
                json!({"operation":"taskDone","number":number,"result":read_text(result,result_file)?,"failed":failed})
            }
            TaskCommand::Release { number } => json!({"operation":"taskRelease","number":number}),
        };
        let mut input = input;
        input["fromThreadId"] = json!(from);
        self.request(input).await
    }
}
