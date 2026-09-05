//! Token accounting shared by ACP adapters, persistence, and history responses.
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Tokens {
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_write_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,
}

fn number(value: &Value, names: &[&str]) -> Option<u64> {
    names.iter().find_map(|key| {
        value.get(key).and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
    })
}

impl Tokens {
    pub(crate) fn parse(value: &Value) -> Option<Self> {
        let mut input = number(
            value,
            &[
                "inputTokens",
                "input_tokens",
                "prompt_tokens",
                "promptTokenCount",
            ],
        )?;
        let mut output = number(
            value,
            &[
                "outputTokens",
                "output_tokens",
                "completion_tokens",
                "candidatesTokenCount",
            ],
        )?;
        let reasoning = number(
            value,
            &[
                "reasoningOutputTokens",
                "reasoning_output_tokens",
                "thoughtTokens",
                "thought_tokens",
                "thoughtsTokenCount",
            ],
        )
        .or_else(|| {
            number(
                value.get("completion_tokens_details")?,
                &["reasoning_tokens"],
            )
        })
        .or_else(|| number(value.get("output_tokens_details")?, &["reasoning_tokens"]))
        .unwrap_or_default();
        if value.get("candidatesTokenCount").is_some() {
            output = output.saturating_add(reasoning);
        }
        let cached = number(
            value,
            &[
                "cachedInputTokens",
                "cached_input_tokens",
                "cachedReadTokens",
                "cached_read_tokens",
                "cache_read_input_tokens",
                "prompt_cache_hit_tokens",
                "cachedContentTokenCount",
            ],
        )
        .or_else(|| number(value.get("input_tokens_details")?, &["cached_tokens"]))
        .or_else(|| number(value.get("prompt_tokens_details")?, &["cached_tokens"]))
        .or_else(|| number(value.get("cache")?, &["read"]))
        .unwrap_or_default();
        let written = number(
            value,
            &[
                "cacheWriteInputTokens",
                "cache_write_input_tokens",
                "cachedWriteTokens",
                "cached_write_tokens",
                "cache_creation_input_tokens",
            ],
        )
        .or_else(|| number(value.get("cache")?, &["write"]))
        .unwrap_or_default();
        // ACP Usage counts uncached input separately; our existing DTO includes caches.
        if value.get("cachedReadTokens").is_some()
            || value.get("cachedWriteTokens").is_some()
            || value.get("cached_read_tokens").is_some()
            || value.get("cached_write_tokens").is_some()
            || value.get("cache_read_input_tokens").is_some()
            || value.get("cache_creation_input_tokens").is_some()
        {
            input = input.saturating_add(cached).saturating_add(written);
        }
        Some(Self {
            total_tokens: number(value, &["totalTokens", "total_tokens", "totalTokenCount"])
                .unwrap_or(input.saturating_add(output)),
            input_tokens: input,
            cached_input_tokens: cached,
            cache_write_input_tokens: written,
            output_tokens: output,
            reasoning_output_tokens: reasoning,
        })
    }

    /// Counters may restart with a new Codex process; the first report then
    /// represents fresh usage rather than a negative increment.
    pub(crate) fn cumulative_delta(&self, previous: &Self, last: Option<&Self>) -> Self {
        if self.total_tokens < previous.total_tokens {
            self.clone()
        } else {
            let delta = self.subtract(previous);
            // A restarted process can already exceed the old counter. A changed
            // report still cannot bill fewer tokens than its latest request.
            if self.total_tokens != previous.total_tokens {
                if let Some(last) = last.filter(|last| last.total_tokens > delta.total_tokens) {
                    return last.clone();
                }
            }
            delta
        }
    }

    pub(crate) fn add(&self, other: &Self) -> Self {
        Self {
            total_tokens: self.total_tokens.saturating_add(other.total_tokens),
            input_tokens: self.input_tokens.saturating_add(other.input_tokens),
            cached_input_tokens: self
                .cached_input_tokens
                .saturating_add(other.cached_input_tokens),
            cache_write_input_tokens: self
                .cache_write_input_tokens
                .saturating_add(other.cache_write_input_tokens),
            output_tokens: self.output_tokens.saturating_add(other.output_tokens),
            reasoning_output_tokens: self
                .reasoning_output_tokens
                .saturating_add(other.reasoning_output_tokens),
        }
    }

    pub(crate) fn subtract(&self, baseline: &Self) -> Self {
        Self {
            total_tokens: self.total_tokens.saturating_sub(baseline.total_tokens),
            input_tokens: self.input_tokens.saturating_sub(baseline.input_tokens),
            cached_input_tokens: self
                .cached_input_tokens
                .saturating_sub(baseline.cached_input_tokens),
            cache_write_input_tokens: self
                .cache_write_input_tokens
                .saturating_sub(baseline.cache_write_input_tokens),
            output_tokens: self.output_tokens.saturating_sub(baseline.output_tokens),
            reasoning_output_tokens: self
                .reasoning_output_tokens
                .saturating_sub(baseline.reasoning_output_tokens),
        }
    }
}

/// Normalize actual token breakdowns. `used` is context occupancy, never billable usage.
pub(crate) fn normalize_usage(raw: &Value) -> Option<Value> {
    let value = raw
        .get("tokenUsage")
        .or_else(|| raw.get("usageMetadata"))
        .or_else(|| raw.get("usage"))
        .or_else(|| raw.pointer("/_meta/tokenUsage"))
        .or_else(|| raw.pointer("/_meta/usage"))
        .unwrap_or(raw);
    let total = value
        .get("total")
        .or_else(|| value.get("total_token_usage"));
    let last = value.get("last").or_else(|| value.get("last_token_usage"));
    let (total, last) = match (total, last) {
        (Some(total), last) => {
            let total = Tokens::parse(total)?;
            let last = last
                .and_then(Tokens::parse)
                .unwrap_or_else(|| total.clone());
            (total, last)
        }
        _ => {
            let tokens = Tokens::parse(value)?;
            (tokens.clone(), tokens)
        }
    };
    Some(json!({
        "total": total, "last": last,
        "modelContextWindow": number(value, &["modelContextWindow", "model_context_window"])
            .or_else(|| number(raw, &["size"])),
        "cumulative": value.get("cumulative").and_then(Value::as_bool).unwrap_or(value.get("total_token_usage").is_some()),
        "baselineTotal": value.get("baselineTotal"),
    }))
}

pub(crate) fn pricing() -> &'static Value {
    static CONFIG: OnceLock<Value> = OnceLock::new();
    CONFIG.get_or_init(|| {
        serde_json::from_str(include_str!("../../../config/codex-model-pricing.json"))
            .expect("bundled model pricing")
    })
}

pub(crate) fn estimate_price(
    usage: &Value,
    model: Option<&str>,
    tier: Option<&str>,
) -> Option<Value> {
    estimate_price_with_catalog(usage, model, tier, pricing(), None)
}

pub(crate) fn estimate_price_with_catalog(
    usage: &Value,
    model: Option<&str>,
    tier: Option<&str>,
    catalog: &Value,
    at: Option<&str>,
) -> Option<Value> {
    let model = crate::pricing::match_model(catalog, model?)?;
    let rates = &catalog["models"][&model];
    for field in [
        "inputUsdPerMillion",
        "cachedInputUsdPerMillion",
        "outputUsdPerMillion",
    ] {
        rates[field].as_f64()?;
    }
    let mut signature_rates = rates.clone();
    for field in ["aliases", "sourceUrl", "verifiedAt", "notes", "custom"] {
        signature_rates.as_object_mut()?.remove(field);
    }
    let signature = signature_rates.to_string();
    if let Some(estimate) = usage.get("priceEstimate").filter(|v| v.is_object()) {
        if estimate["ratesSignature"] == signature
            || (estimate.get("ratesSignature").is_none() && rates["custom"] != true)
        {
            return Some(estimate.clone());
        }
    }
    let tokens = Tokens::parse(usage.get("total")?)?;
    let tier = if tier == Some("fast") && rates["supportsFastMode"] == true {
        "fast"
    } else {
        "standard"
    };
    let multiplier = if tier == "fast" {
        rates
            .get("fastMultiplier")
            .and_then(Value::as_f64)
            .unwrap_or(2.0)
    } else {
        1.0
    };
    let last_input = usage
        .pointer("/last/inputTokens")
        .and_then(Value::as_u64)
        .unwrap_or(tokens.input_tokens);
    let long = rates
        .get("longContextThresholdTokens")
        .and_then(Value::as_u64)
        .is_some_and(|threshold| last_input > threshold);
    let rate = |key: &str| rates.get(key).and_then(Value::as_f64).unwrap_or(0.0);
    use chrono::{Datelike, Timelike};
    let when = at
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
        .unwrap_or_else(chrono::Utc::now);
    let peak = when.weekday().num_days_from_monday() < 5
        && ((1..4).contains(&when.hour()) || (6..10).contains(&when.hour()));
    let multiplier = multiplier
        * if !peak {
            rates["offPeakMultiplier"].as_f64().unwrap_or(1.0)
        } else {
            1.0
        };
    let multiplier = multiplier
        * if rates["ratesChangeAt"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .is_some_and(|d| when >= d)
        {
            rates["ratesChangeMultiplier"].as_f64().unwrap_or(1.0)
        } else {
            1.0
        };
    let input_multiplier = multiplier
        * if long {
            rate("longContextInputMultiplier").max(1.0)
        } else {
            1.0
        };
    let output_multiplier = multiplier
        * if long {
            rate("longContextOutputMultiplier").max(1.0)
        } else {
            1.0
        };
    let input = tokens
        .input_tokens
        .saturating_sub(tokens.cached_input_tokens)
        .saturating_sub(tokens.cache_write_input_tokens);
    let input_usd = input as f64 * rate("inputUsdPerMillion") * input_multiplier / 1e6;
    let cached_usd =
        tokens.cached_input_tokens as f64 * rate("cachedInputUsdPerMillion") * input_multiplier
            / 1e6;
    let written_usd = tokens.cache_write_input_tokens as f64
        * rates
            .get("cacheWriteInputUsdPerMillion")
            .and_then(Value::as_f64)
            .unwrap_or(rate("inputUsdPerMillion"))
        * input_multiplier
        / 1e6;
    let output_usd =
        tokens.output_tokens as f64 * rate("outputUsdPerMillion") * output_multiplier / 1e6;
    Some(
        json!({"ratesSignature":signature,"pricingModelKey":model,"pricingTierKey":tier,"currency":"USD","inputUsd":input_usd,"cachedInputUsd":cached_usd,"cacheWriteInputUsd":written_usd,"outputUsd":output_usd,"totalUsd":input_usd+cached_usd+written_usd+output_usd}),
    )
}

pub(crate) fn public_usage(value: &Value) -> Option<Value> {
    Some(
        json!({"total": Tokens::parse(value.get("total")?)?, "last": Tokens::parse(value.get("last")?)?, "modelContextWindow": value.get("modelContextWindow").filter(|v| v.is_number())}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn context_occupancy_is_not_token_usage() {
        assert!(normalize_usage(&json!({"used":32000,"size":1000000})).is_none());
    }
    #[test]
    fn acp_input_and_cache_are_disjoint() {
        let tokens = Tokens::parse(&json!({"inputTokens":100,"cachedReadTokens":200,"cachedWriteTokens":50,"outputTokens":20})).unwrap();
        assert_eq!(tokens.input_tokens, 350);
        assert_eq!(tokens.total_tokens, 370);
    }
    #[test]
    fn prices_cached_tokens_and_fast_mode_without_double_charging() {
        let usage = json!({"total":{"inputTokens":1000000,"cachedInputTokens":600000,"outputTokens":10000},"last":{"inputTokens":200000}});
        let price = estimate_price(&usage, Some("openai/gpt-6-astra"), Some("fast")).unwrap();
        assert!((price["totalUsd"].as_f64().unwrap() - 10.2).abs() < 1e-10);
        assert!(estimate_price(&usage, Some("unknown-model"), None).is_none());
    }
    #[test]
    fn claude_cache_writes_use_the_default_five_minute_rate() {
        let usage = json!({"total":{"inputTokens":1000000,"cacheWriteInputTokens":1000000,"outputTokens":0}});
        assert_eq!(
            estimate_price(&usage, Some("claude-opus-4-6"), None).unwrap()["totalUsd"],
            6.25
        );
    }

    #[test]
    fn unsupported_fast_mode_uses_standard_rates() {
        let usage = json!({"total":{"inputTokens":1000000,"outputTokens":1000}});
        assert_eq!(
            estimate_price(&usage, Some("gpt-5.2"), Some("fast")),
            estimate_price(&usage, Some("gpt-5.2"), Some("standard"))
        );
    }

    #[test]
    fn long_context_threshold_is_per_request_not_turn_total() {
        let mut usage = json!({"total":{"inputTokens":500000,"outputTokens":1000},"last":{"inputTokens":250000}});
        assert_eq!(
            estimate_price(&usage, Some("gpt-6-astra"), None).unwrap()["totalUsd"],
            5.05
        );
        usage["last"]["inputTokens"] = json!(300000);
        assert_eq!(
            estimate_price(&usage, Some("gpt-6-astra"), None).unwrap()["totalUsd"],
            10.075
        );
    }
}

#[cfg(test)]
mod multi_provider_tests {
    use super::*;
    #[test]
    fn normalizes_chat_completion_and_gemini_cache_and_reasoning() {
        let chat=normalize_usage(&json!({"usage":{"prompt_tokens":10000,"completion_tokens":1000,"prompt_cache_hit_tokens":8000,"completion_tokens_details":{"reasoning_tokens":300}}})).unwrap();
        assert_eq!(chat["total"]["inputTokens"], 10000);
        assert_eq!(chat["total"]["cachedInputTokens"], 8000);
        assert_eq!(chat["total"]["reasoningOutputTokens"], 300);
        let gemini=normalize_usage(&json!({"usageMetadata":{"promptTokenCount":10000,"cachedContentTokenCount":8000,"candidatesTokenCount":700,"thoughtsTokenCount":300}})).unwrap();
        assert_eq!(gemini["total"], chat["total"]);
    }
    #[test]
    fn prices_aliases_peak_periods_and_context_boundaries() {
        let usage = normalize_usage(
            &json!({"inputTokens":10000,"cachedInputTokens":8000,"outputTokens":1000}),
        )
        .unwrap();
        assert!(estimate_price(&usage, Some("GPT-6-Astra"), None).is_some());
        for model in [
            "Claude Fable 5.1",
            "claude-opus-5",
            "claude-sonnet-5",
            "grok-4.6",
            "gemini-3.1-pro",
            "GLM-5.1",
        ] {
            assert!(
                estimate_price(&usage, Some(model), None).is_some(),
                "{model}"
            );
        }
        let off = estimate_price_with_catalog(
            &usage,
            Some("d4-pro"),
            None,
            pricing(),
            Some("2026-09-05T01:00:00Z"),
        )
        .unwrap();
        let peak = estimate_price_with_catalog(
            &usage,
            Some("deepseek-v4-pro"),
            None,
            pricing(),
            Some("2026-09-04T01:00:00Z"),
        )
        .unwrap();
        assert_eq!(
            peak["totalUsd"].as_f64().unwrap(),
            off["totalUsd"].as_f64().unwrap() * 2.0
        );
        let short = normalize_usage(&json!({"inputTokens":199999,"outputTokens":1000})).unwrap();
        let long = normalize_usage(&json!({"inputTokens":200000,"outputTokens":1000})).unwrap();
        assert_eq!(
            estimate_price(&short, Some("grok-4.6"), None).unwrap()["outputUsd"],
            0.006
        );
        assert_eq!(
            estimate_price(&long, Some("grok-4.6"), None).unwrap()["outputUsd"],
            0.012
        );
        assert!(estimate_price(&usage, Some("glm-5.3"), None).is_none());
    }
}
