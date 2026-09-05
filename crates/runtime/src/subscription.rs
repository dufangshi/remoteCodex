//! Read-only account usage, independent of conversation writers and ACP prompts.
use crate::acp::rpc::{parse_spawn_command, AcpProcess};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct SubscriptionUsage {
    cache: Mutex<HashMap<String, (Instant, Option<Value>)>>,
}

impl SubscriptionUsage {
    pub async fn read(&self, provider: &str) -> Option<Value> {
        // Serialize refreshes, with a short negative cache as well as success cache.
        let mut cache = self.cache.lock().await;
        if let Some((at, value)) = cache.get(provider) {
            if at.elapsed() < Duration::from_secs(45) {
                return value.clone();
            }
        }
        let value = tokio::time::timeout(Duration::from_secs(12), async {
            match provider {
                "codex" => codex().await,
                "claude" => claude().await,
                "grok" => grok().await,
                _ => None,
            }
        })
        .await
        .ok()
        .flatten();
        cache.insert(provider.into(), (Instant::now(), value.clone()));
        value
    }
}

fn report(provider: &str, windows: Vec<Value>) -> Option<Value> {
    if windows.is_empty() {
        return None;
    }
    Some(
        json!({"provider":provider,"authKind":"subscription","observedAt":Utc::now().to_rfc3339(),"stale":false,"windows":windows}),
    )
}
fn reset(value: &Value) -> Option<String> {
    value
        .as_i64()
        .and_then(|s| DateTime::<Utc>::from_timestamp(s, 0))
        .or_else(|| {
            value.as_str().and_then(|s| {
                DateTime::parse_from_rfc3339(s)
                    .ok()
                    .map(|d| d.with_timezone(&Utc))
            })
        })
        .map(|d| d.to_rfc3339())
}
fn window(id: &str, minutes: i64, used: &Value, resets: &Value) -> Option<Value> {
    let used = used.as_f64().filter(|v| v.is_finite() && *v >= 0.0)?;
    let resets = reset(resets)?;
    if DateTime::parse_from_rfc3339(&resets).ok()? <= Utc::now() {
        return None;
    }
    let label = if minutes % 1440 == 0 {
        format!("{}d", minutes / 1440)
    } else if minutes % 60 == 0 {
        format!("{}h", minutes / 60)
    } else {
        format!("{}m", minutes)
    };
    Some(
        json!({"id":id,"durationMinutes":minutes,"label":label,"usedPercent":used.min(100.0),"resetsAt":resets}),
    )
}
fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}
fn has_env(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| !v.trim().is_empty())
}

async fn codex() -> Option<Value> {
    let command = format!(
        "{} app-server",
        std::env::var("CODEX_COMMAND").unwrap_or_else(|_| "codex".into())
    );
    let (process, _, _) = AcpProcess::spawn(&command, home()?.to_str()?, &[])
        .await
        .ok()?;
    process
        .request(
            "initialize",
            json!({"clientInfo":{"name":"remote-codex-usage","version":"1"},"capabilities":{}}),
        )
        .await
        .ok()?;
    process.notify("initialized", json!({})).await.ok()?;
    let account = process
        .request("account/read", json!({"refreshToken":false}))
        .await
        .ok()?;
    if account["requiresOpenaiAuth"] == false
        || !matches!(
            account.pointer("/account/type").and_then(Value::as_str),
            Some("chatgpt" | "chatgptAuthTokens")
        )
    {
        return None;
    }
    let data = process
        .request("account/rateLimits/read", json!({}))
        .await
        .ok()?;
    parse_codex(&data)
}
pub(crate) fn parse_codex(data: &Value) -> Option<Value> {
    let rates = data
        .pointer("/rateLimitsByLimitId/codex")
        .or_else(|| data.get("rateLimits"))?;
    let windows = ["primary", "secondary"]
        .iter()
        .filter_map(|key| {
            let value = &rates[*key];
            let minutes = value["windowDurationMins"].as_i64().filter(|v| *v > 0)?;
            window(key, minutes, &value["usedPercent"], &value["resetsAt"])
        })
        .collect();
    report("codex", windows)
}

async fn grok() -> Option<Value> {
    if has_env("XAI_API_KEY") || has_env("GROK_API_KEY") {
        return None;
    }
    let command = format!(
        "{} agent stdio",
        std::env::var("GROK_COMMAND").unwrap_or_else(|_| "grok".into())
    );
    let (process, _, _) = AcpProcess::spawn(&command, home()?.to_str()?, &[])
        .await
        .ok()?;
    process.request("initialize",json!({"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"remote-codex-usage","version":"1"}})).await.ok()?;
    let data = process.request("_x.ai/billing", json!({})).await.ok()?;
    parse_grok(&data)
}
pub(crate) fn parse_grok(data: &Value) -> Option<Value> {
    let tier = data["subscription_tier"].as_str()?;
    if tier.is_empty() || tier.eq_ignore_ascii_case("none") {
        return None;
    }
    let config = &data["config"];
    let minutes = match config
        .pointer("/currentPeriod/type")
        .and_then(Value::as_str)?
    {
        "USAGE_PERIOD_TYPE_WEEKLY" => 10080,
        "USAGE_PERIOD_TYPE_DAILY" => 1440,
        _ => return None,
    };
    report(
        "grok",
        vec![window(
            "subscription",
            minutes,
            &config["creditUsagePercent"],
            &config["currentPeriod"]["end"],
        )?],
    )
}

async fn claude() -> Option<Value> {
    // API-key sessions should not show the local OAuth account's allowance.
    if has_env("ANTHROPIC_API_KEY")
        || has_env("ANTHROPIC_AUTH_TOKEN")
        || has_env("CLAUDE_CODE_USE_BEDROCK")
        || has_env("CLAUDE_CODE_USE_VERTEX")
    {
        return None;
    }
    let parsed =
        parse_spawn_command(&std::env::var("CLAUDE_COMMAND").unwrap_or_else(|_| "claude".into()))
            .ok()?;
    let mut command = tokio::process::Command::new(parsed.program);
    crate::child_process::hide_tokio(&mut command);
    let status = command
        .args(parsed.args)
        .args(["auth", "status", "--json"])
        .kill_on_drop(true)
        .output()
        .await
        .ok()?;
    let status: Value = serde_json::from_slice(&status.stdout).ok()?;
    if status["loggedIn"] != true
        || !matches!(status["authMethod"].as_str(), Some("claude.ai" | "oauth"))
    {
        return None;
    }
    let config = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or(home()?.join(".claude"));
    let token = if let Ok(token) = std::env::var("CLAUDE_CODE_OAUTH_TOKEN") {
        token
    } else {
        let credentials = tokio::fs::read(config.join(".credentials.json")).await.ok();
        #[cfg(target_os = "macos")]
        let credentials = if credentials.is_none() && !has_env("CLAUDE_CONFIG_DIR") {
            let mut cmd = tokio::process::Command::new("security");
            cmd.args([
                "find-generic-password",
                "-s",
                "Claude Code-credentials",
                "-w",
            ])
            .kill_on_drop(true)
            .output()
            .await
            .ok()
            .filter(|o| o.status.success())
            .map(|o| o.stdout)
        } else {
            credentials
        };
        let value: Value = serde_json::from_slice(&credentials?).ok()?;
        value
            .pointer("/claudeAiOauth/accessToken")?
            .as_str()?
            .to_string()
    };
    if token.is_empty() {
        return None;
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let response = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    parse_claude(&response.json::<Value>().await.ok()?)
}
pub(crate) fn parse_claude(data: &Value) -> Option<Value> {
    let windows = [("five_hour", 300), ("seven_day", 10080)]
        .into_iter()
        .filter_map(|(id, mins)| {
            window(
                id,
                mins,
                data[id]
                    .get("utilization")
                    .or_else(|| data[id].get("used_percentage"))
                    .unwrap_or(&Value::Null),
                &data[id]["resets_at"],
            )
        })
        .collect();
    report("claude", windows)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_only_available_valid_oauth_windows() {
        let reset = (Utc::now() + chrono::Duration::days(7)).timestamp();
        let data = json!({"rateLimitsByLimitId":{"codex":{"primary":{"windowDurationMins":300,"usedPercent":25,"resetsAt":reset},"secondary":{"windowDurationMins":10080,"usedPercent":60,"resetsAt":reset}}}});
        let usage = parse_codex(&data).unwrap();
        assert_eq!(usage["windows"][0]["label"], "5h");
        assert_eq!(usage["windows"][1]["label"], "7d");
        assert_eq!(usage["windows"][0]["usedPercent"], 25.0);
        let usage = parse_claude(
            &json!({"five_hour":{"utilization":10,"resets_at":reset},"seven_day":null}),
        )
        .unwrap();
        assert_eq!(usage["windows"].as_array().unwrap().len(), 1);
        assert!(parse_claude(&json!({"five_hour":{"utilization":10,"resets_at":1}})).is_none());
        assert!(parse_codex(&json!({})).is_none());
    }
    #[test]
    fn grok_weekly_billing_is_not_a_five_hour_limit() {
        let end = (Utc::now() + chrono::Duration::days(3)).to_rfc3339();
        let data = json!({"subscription_tier":"SuperGrok Heavy","config":{"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","end":end},"creditUsagePercent":21}});
        let usage = parse_grok(&data).unwrap();
        assert_eq!(usage["windows"].as_array().unwrap().len(), 1);
        assert_eq!(usage["windows"][0]["label"], "7d");
        let mut api = data.clone();
        api["subscription_tier"] = Value::Null;
        assert!(parse_grok(&api).is_none());
        let mut bad = data;
        bad["config"]["creditUsagePercent"] = Value::Null;
        assert!(parse_grok(&bad).is_none());
    }
}
