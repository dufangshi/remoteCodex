use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSendInput {
    pub text: String,
    #[serde(default = "inbox_delivery")]
    pub delivery: String,
    #[serde(default = "inbox_delivery")]
    pub notify_delivery: String,
    #[serde(default)]
    pub from_thread_id: Option<String>,
    #[serde(default)]
    pub notify_on_complete: bool,
    #[serde(default)]
    pub client_request_id: Option<String>,
    /// One-line summary. Lets a receiver triage from a listing or an unread notice
    /// without opening the message, and gives a sender something to name work by.
    #[serde(default)]
    pub subject: Option<String>,
    /// What the message is for: result, question, status or task. Freeform text
    /// alone forces the receiver to read everything to find out whether anything is
    /// expected of it. Defaults to `status` - the least demanding reading.
    #[serde(default)]
    pub kind: Option<String>,
    /// Message this answers, so an exchange correlates instead of relying on prose.
    #[serde(default)]
    pub in_reply_to: Option<String>,
}

/// Accepted `kind` values. `question` is the only one that implies the sender is
/// waiting on the receiver; the rest are informational, which keeps the passive
/// inbox the right default rather than something to escalate around.
pub const MESSAGE_KINDS: [&str; 4] = ["result", "question", "status", "task"];

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadTranscriptQuery {
    pub limit: Option<u32>,
    pub before_turn_id: Option<String>,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub view: Option<String>,
    pub offset: Option<u32>,
    pub text_offset: Option<u32>,
    #[serde(default)]
    pub raw: bool,
}

fn inbox_delivery() -> String {
    "inbox".into()
}
