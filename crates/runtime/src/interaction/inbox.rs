use crate::Supervisor;
use anyhow::{ensure, Result};
use remote_codex_protocol::now_rfc3339;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

fn prefix(thread: &str) -> String {
    format!("cli:inbox:{thread}:")
}
fn key(thread: &str, id: &str) -> String {
    format!("{}{id}", prefix(thread))
}
pub(super) struct Envelope<'a> {
    pub subject: Option<&'a str>,
    pub kind: &'a str,
    pub in_reply_to: Option<&'a str>,
}
pub(super) fn store(
    conn: &Connection,
    thread: &str,
    id: &str,
    from: Option<&str>,
    text: &str,
    now: &str,
    envelope: Envelope<'_>,
) -> Result<()> {
    // subject/kind ride on the stored record so `inbox list`, which returns it
    // verbatim, lets a receiver triage without opening anything.
    conn.execute("INSERT INTO kv(key,value) VALUES(?1,?2)", params![key(thread,id),json!({"id":id,"threadId":thread,"fromThreadId":from,"text":text,"createdAt":now,"acknowledgedAt":null,"subject":envelope.subject,"kind":envelope.kind,"inReplyTo":envelope.in_reply_to}).to_string()])?;
    Ok(())
}
fn get(conn: &Connection, thread: &str, id: &str) -> Result<Value> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM kv WHERE key=?1",
            [key(thread, id)],
            |r| r.get(0),
        )
        .optional()?;
    Ok(serde_json::from_str(&raw.ok_or_else(|| {
        anyhow::anyhow!("inbox message not found")
    })?)?)
}
impl Supervisor {
    /// Subject lines of waiting mail, newest first, for the start-of-turn notice.
    /// Showing what is waiting is what makes a passive inbox workable: a bare count
    /// tells an agent nothing about whether looking now is worth interrupting itself.
    pub fn inbox_unread_digest(&self, thread: &str, limit: usize) -> Result<Vec<(String, String)>> {
        self.db.with(|c| {
            let mut stmt = c.prepare(
                "SELECT value FROM kv WHERE key GLOB ?1
                   AND json_extract(value,'$.acknowledgedAt') IS NULL
                 ORDER BY json_extract(value,'$.createdAt') DESC LIMIT ?2",
            )?;
            let rows = stmt
                .query_map(params![format!("{}*", prefix(thread)), limit as i64], |r| {
                    r.get::<_, String>(0)
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(rows
                .iter()
                .filter_map(|raw| serde_json::from_str::<Value>(raw).ok())
                .map(|m| {
                    let kind = m["kind"].as_str().unwrap_or("status").to_string();
                    let subject = m["subject"].as_str().map(str::to_owned).unwrap_or_else(|| {
                        // Pre-envelope mail, and senders that skipped --subject.
                        let text = m["text"].as_str().unwrap_or("");
                        let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
                        line.chars().take(60).collect()
                    });
                    (kind, subject)
                })
                .collect())
        })
    }
    pub fn inbox_unread_count(&self, thread: &str) -> Result<i64> {
        self.db.with(|c| Ok(c.query_row("SELECT count(*) FROM kv WHERE key GLOB ?1 AND json_extract(value,'$.acknowledgedAt') IS NULL",[format!("{}*",prefix(thread))],|r|r.get(0))?))
    }
    pub fn inbox_list(&self, thread: &str, query: &Value) -> Result<Value> {
        self.get_thread(thread)?;
        let limit = query["limit"].as_u64().unwrap_or(20).clamp(1, 100) as usize;
        let all = query["all"].as_bool().unwrap_or(false);
        self.db.with(|c| {
            let before=query["before"].as_str().map(|id|get(c,thread,id)).transpose()?;
            let date=before.as_ref().and_then(|v|v["createdAt"].as_str());
            let id=query["before"].as_str();
            let mut stmt=c.prepare("SELECT value FROM kv WHERE key GLOB ?1 AND (?2 OR json_extract(value,'$.acknowledgedAt') IS NULL) AND (?3 IS NULL OR (json_extract(value,'$.createdAt'),json_extract(value,'$.id')) < (?3,?4)) ORDER BY json_extract(value,'$.createdAt') DESC,json_extract(value,'$.id') DESC LIMIT ?5")?;
            let raw=stmt.query_map(params![format!("{}*",prefix(thread)),all,date,id,limit+1],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
            let has_more=raw.len()>limit;
            let mut messages=raw.iter().take(limit).map(|r|serde_json::from_str::<Value>(r)).collect::<std::result::Result<Vec<_>,_>>()?;
            let next=if has_more {messages.last().map(|m|m["id"].clone())} else {None};
            for message in &mut messages {
                let text=message["text"].as_str().unwrap_or("");
                let count=text.chars().count();
                message["preview"]=json!(text.chars().take(240).collect::<String>());
                message["textLength"]=json!(count);
                message.as_object_mut().unwrap().remove("text");
            }
            messages.reverse();
            Ok(json!({"threadId":thread,"messages":messages,"nextBefore":next,"readCommand":format!("remote-codex inbox read MESSAGE_ID --thread {thread}"),"acknowledgement":"Reading does not acknowledge a message. Use inbox ack after handling it."}))
        })
    }
    pub fn inbox_read(&self, thread: &str, query: &Value) -> Result<Value> {
        self.get_thread(thread)?;
        let id = query["messageId"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("messageId required"))?;
        let offset = query["textOffset"].as_u64().unwrap_or(0) as usize;
        self.db.with(|c| {
            let mut message = get(c, thread, id)?;
            let chars: Vec<char> = message["text"].as_str().unwrap_or("").chars().collect();
            let end = offset.saturating_add(8192).min(chars.len());
            ensure!(offset <= chars.len(), "textOffset exceeds message length");
            message["text"] = json!(chars[offset..end].iter().collect::<String>());
            message["nextTextOffset"] = if end < chars.len() {
                json!(end)
            } else {
                Value::Null
            };
            Ok(message)
        })
    }
    pub fn inbox_ack(&self, thread: &str, query: &Value) -> Result<Value> {
        self.get_thread(thread)?;
        let ids = query["messageIds"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("messageIds required"))?;
        ensure!(
            !ids.is_empty() && ids.len() <= 100,
            "acknowledge 1 to 100 messages"
        );
        self.db.with(|c| {
            let tx = c.unchecked_transaction()?;
            let now = now_rfc3339();
            for id in ids {
                let id = id
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("invalid message ID"))?;
                let mut message = get(&tx, thread, id)?;
                if message["acknowledgedAt"].is_null() {
                    message["acknowledgedAt"] = json!(now);
                    tx.execute(
                        "UPDATE kv SET value=?1 WHERE key=?2",
                        params![message.to_string(), key(thread, id)],
                    )?;
                }
            }
            tx.commit()?;
            Ok(json!({"threadId":thread,"acknowledged":ids}))
        })
    }
}
