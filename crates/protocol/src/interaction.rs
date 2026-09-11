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
}

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
