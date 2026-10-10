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

const REFRESH_INTERVAL: Duration = Duration::from_secs(5 * 60);
const MAX_STALE_AGE: Duration = Duration::from_secs(30 * 60);
const MAX_BACKOFF: Duration = Duration::from_secs(30 * 60);

enum RefreshResult {
    Available(Value),
    // No subscription credentials (or rejected credentials): do not retain old account data.
    Unavailable,
    TemporaryFailure(Option<Duration>),
}

struct CacheEntry {
    refresh_at: Instant,
    success: Option<(Instant, Value)>,
    failures: u32,
    unavailable: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionUsageReport {
    pub usage: Option<Value>,
    pub unavailable: bool,
}

impl CacheEntry {
    fn new(now: Instant) -> Self {
        Self {
            refresh_at: now,
            success: None,
            failures: 0,
            unavailable: false,
        }
    }

    fn value(&self, now: Instant) -> Option<Value> {
        let (observed, value) = self.success.as_ref()?;
        if now.duration_since(*observed) >= MAX_STALE_AGE {
            return None;
        }
        let mut value = value.clone();
        value["stale"] = json!(self.failures > 0);
        Some(value)
    }

    fn update(&mut self, result: RefreshResult, now: Instant) -> Option<Value> {
        let delay = match result {
            RefreshResult::Available(value) => {
                self.success = Some((now, value));
                self.failures = 0;
                self.unavailable = false;
                REFRESH_INTERVAL
            }
            RefreshResult::Unavailable => {
                self.success = None;
                self.failures = 0;
                self.unavailable = true;
                REFRESH_INTERVAL
            }
            RefreshResult::TemporaryFailure(retry_after) => {
                self.failures = self.failures.saturating_add(1);
                self.unavailable = false;
                let backoff = (REFRESH_INTERVAL * (1 << self.failures.min(4).saturating_sub(1)))
                    .min(MAX_BACKOFF);
                // Some OAuth usage responses say Retry-After: 0. Never retry immediately.
                backoff.max(retry_after.unwrap_or_default())
            }
        };
        self.refresh_at = now + delay;
        self.value(now)
    }
}

#[derive(Default)]
pub struct SubscriptionUsage {
    cache: Mutex<HashMap<String, CacheEntry>>,
}

impl SubscriptionUsage {
    pub async fn read(&self, provider: &str) -> SubscriptionUsageReport {
        self.read_with(provider, async {
            match provider {
                "claude" => claude().await,
                "codex" => codex()
                    .await
                    .map(RefreshResult::Available)
                    .unwrap_or(RefreshResult::Unavailable),
                "grok" => grok()
                    .await
                    .map(RefreshResult::Available)
                    .unwrap_or(RefreshResult::Unavailable),
                _ => RefreshResult::Unavailable,
            }
        })
        .await
    }

    async fn read_with(
        &self,
        provider: &str,
        fetch: impl std::future::Future<Output = RefreshResult>,
    ) -> SubscriptionUsageReport {
        // All threads in this Supervisor share the provider cache. Serialize misses so
        // concurrent viewers cannot create a burst of upstream OAuth requests.
        let mut cache = self.cache.lock().await;
        let now = Instant::now();
        if let Some(entry) = cache.get(provider) {
            if now < entry.refresh_at {
                return SubscriptionUsageReport {
                    usage: entry.value(now),
                    unavailable: entry.unavailable,
                };
            }
        }
        let result = tokio::time::timeout(Duration::from_secs(12), fetch)
            .await
            .unwrap_or(RefreshResult::TemporaryFailure(None));
        let now = Instant::now();
        let entry = cache
            .entry(provider.into())
            .or_insert_with(|| CacheEntry::new(now));
        let usage = entry.update(result, now);
        SubscriptionUsageReport {
            usage,
            unavailable: entry.unavailable,
        }
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
            json!({"clientInfo":{"name":"pockymoe-usage","version":"1"},"capabilities":{}}),
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
    process.request("initialize",json!({"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"pockymoe-usage","version":"1"}})).await.ok()?;
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

async fn claude_token() -> Result<Option<String>, ()> {
    // API-key sessions should not show the local OAuth account's allowance.
    if has_env("ANTHROPIC_API_KEY")
        || has_env("ANTHROPIC_AUTH_TOKEN")
        || has_env("CLAUDE_CODE_USE_BEDROCK")
        || has_env("CLAUDE_CODE_USE_VERTEX")
    {
        return Ok(None);
    }
    let parsed =
        parse_spawn_command(&std::env::var("CLAUDE_COMMAND").unwrap_or_else(|_| "claude".into()))
            .map_err(|_| ())?;
    let mut command = tokio::process::Command::new(parsed.program);
    crate::child_process::hide_tokio(&mut command);
    let status = command
        .args(parsed.args)
        .args(["auth", "status", "--json"])
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|_| ())?;
    if !status.status.success() {
        return Err(());
    }
    let status: Value = serde_json::from_slice(&status.stdout).map_err(|_| ())?;
    if status["loggedIn"] != true
        || !matches!(status["authMethod"].as_str(), Some("claude.ai" | "oauth"))
    {
        return Ok(None);
    }
    let Some(home) = home() else {
        return Ok(None);
    };
    let config = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or(home.join(".claude"));
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
        let Some(credentials) = credentials else {
            return Ok(None);
        };
        let value: Value = serde_json::from_slice(&credentials).map_err(|_| ())?;
        let Some(token) = value
            .pointer("/claudeAiOauth/accessToken")
            .and_then(Value::as_str)
        else {
            return Ok(None);
        };
        token.to_string()
    };
    if token.is_empty() {
        return Ok(None);
    }
    Ok(Some(token))
}

async fn claude() -> RefreshResult {
    let token = match claude_token().await {
        Ok(Some(token)) => token,
        Ok(None) => return RefreshResult::Unavailable,
        Err(()) => return RefreshResult::TemporaryFailure(None),
    };
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return RefreshResult::TemporaryFailure(None);
    };
    let Ok(response) = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
    else {
        return RefreshResult::TemporaryFailure(None);
    };
    if matches!(response.status().as_u16(), 401 | 403) {
        return RefreshResult::Unavailable;
    }
    if !response.status().is_success() {
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            // Bound an untrusted header to a day; still honor server delays over our backoff.
            .map(|seconds| Duration::from_secs(seconds.min(86400)));
        return RefreshResult::TemporaryFailure(retry_after);
    }
    match response
        .json::<Value>()
        .await
        .ok()
        .as_ref()
        .and_then(parse_claude)
    {
        Some(value) => RefreshResult::Available(value),
        None => RefreshResult::TemporaryFailure(None),
    }
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
mod cache_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn usage() -> Value {
        json!({"observedAt":"2026-10-02T12:00:00Z","stale":false,"windows":[{"label":"5h"}]})
    }

    #[test]
    fn success_is_cached_for_five_minutes() {
        let now = Instant::now();
        let mut entry = CacheEntry::new(now);
        assert_eq!(
            entry.update(RefreshResult::Available(usage()), now),
            Some(usage())
        );
        assert_eq!(entry.refresh_at, now + REFRESH_INTERVAL);
        assert_eq!(entry.value(now + Duration::from_secs(299)), Some(usage()));
    }

    #[test]
    fn transient_failures_keep_observation_and_back_off_even_with_retry_after_zero() {
        let now = Instant::now();
        let mut entry = CacheEntry::new(now);
        entry.update(RefreshResult::Available(usage()), now);
        let mut at = now + REFRESH_INTERVAL;
        for minutes in [5, 10, 20, 30, 30] {
            let cached = entry.update(RefreshResult::TemporaryFailure(Some(Duration::ZERO)), at);
            if at.duration_since(now) < MAX_STALE_AGE {
                let cached = cached.unwrap();
                assert_eq!(cached["stale"], true);
                assert_eq!(cached["observedAt"], usage()["observedAt"]);
            } else {
                assert!(cached.is_none());
            }
            assert_eq!(entry.refresh_at, at + Duration::from_secs(minutes * 60));
            assert!(!entry.unavailable);
            at = entry.refresh_at;
        }
        assert!(entry.value(now + MAX_STALE_AGE).is_none());
        assert_eq!(
            entry.update(RefreshResult::Available(usage()), at),
            Some(usage())
        );
        assert_eq!(entry.refresh_at, at + REFRESH_INTERVAL);
    }

    #[test]
    fn rejected_or_missing_auth_clears_old_account_data() {
        let now = Instant::now();
        let mut entry = CacheEntry::new(now);
        entry.update(RefreshResult::Available(usage()), now);
        assert!(entry
            .update(RefreshResult::Unavailable, now + REFRESH_INTERVAL)
            .is_none());
        assert!(entry.unavailable);
        assert!(entry.success.is_none());
    }

    #[test]
    fn negative_cache_and_server_retry_after_are_respected() {
        let now = Instant::now();
        let mut entry = CacheEntry::new(now);
        assert!(entry
            .update(
                RefreshResult::TemporaryFailure(Some(Duration::from_secs(1200))),
                now
            )
            .is_none());
        assert_eq!(entry.refresh_at, now + Duration::from_secs(1200));
        assert!(!entry.unavailable);
    }

    #[tokio::test]
    async fn concurrent_threads_share_one_upstream_request_and_providers_are_isolated() {
        let cache = SubscriptionUsage::default();
        let calls = AtomicUsize::new(0);
        let fetch = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            RefreshResult::Available(usage())
        };
        let (first, second) = tokio::join!(
            cache.read_with("claude", fetch()),
            cache.read_with("claude", fetch())
        );
        assert_eq!(first.usage, second.usage);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        cache.read_with("codex", fetch()).await;
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
}
