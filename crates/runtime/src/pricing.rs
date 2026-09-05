//! User-editable prices live in this supervisor's database; credentials never do.
use crate::Supervisor;
use anyhow::{bail, Result};
use serde_json::{json, Value};

pub(crate) fn normalized(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

pub(crate) fn match_model(catalog: &Value, model: &str) -> Option<String> {
    let models = catalog["models"].as_object()?;
    for candidate in [
        model.trim(),
        model.rsplit('/').next().unwrap_or(model).trim(),
    ] {
        let key = normalized(candidate);
        for (id, rates) in models {
            if normalized(id) == key
                || rates["aliases"].as_array().is_some_and(|aliases| {
                    aliases
                        .iter()
                        .any(|alias| alias.as_str().is_some_and(|a| normalized(a) == key))
                })
            {
                return Some(id.clone());
            }
        }
        for (id, _) in models {
            let lower = candidate.to_lowercase();
            if let Some(suffix) = lower.strip_prefix(&format!("{}-", id.to_lowercase())) {
                let digits: String = suffix.chars().filter(|c| *c != '-').collect();
                if [4, 8].contains(&digits.len()) && digits.bytes().all(|c| c.is_ascii_digit()) {
                    return Some(id.clone());
                }
            }
        }
    }
    None
}

impl Supervisor {
    pub fn model_pricing(&self) -> Value {
        let mut config = crate::usage::pricing().clone();
        let overrides: Value = self
            .db
            .get_kv("model_pricing")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(json!({}));
        for (id, rates) in overrides.as_object().into_iter().flatten() {
            config["models"][id] = rates.clone();
            config["models"][id]["custom"] = json!(true);
        }
        // A harness may advertise opaque IDs and readable names. Remember both.
        let names: Value = self
            .db
            .get_kv("model_display_names")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(json!({}));
        for (id, name) in names.as_object().into_iter().flatten() {
            if let Some(key) = match_model(&config, id)
                .or_else(|| name.as_str().and_then(|n| match_model(&config, n)))
            {
                let mut aliases = config["models"][&key]["aliases"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                for alias in [json!(id), name.clone()] {
                    if !aliases.contains(&alias) {
                        aliases.push(alias);
                    }
                }
                config["models"][&key]["aliases"] = json!(aliases);
            }
        }
        config
    }

    pub fn update_model_pricing(&self, input: &Value) -> Result<Value> {
        let id = input["id"]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty() && v.len() <= 160)
            .ok_or_else(|| anyhow::anyhow!("Model ID is required (maximum 160 characters)"))?;
        let mut overrides: Value = self
            .db
            .get_kv("model_pricing")?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(json!({}));
        if input["reset"] == true {
            overrides.as_object_mut().unwrap().remove(id);
        } else {
            let mut rates = input["rates"].clone();
            if !rates.is_object() {
                bail!("Model rates are required");
            }
            for field in [
                "inputUsdPerMillion",
                "cachedInputUsdPerMillion",
                "outputUsdPerMillion",
            ] {
                if !rates[field]
                    .as_f64()
                    .is_some_and(|v| v.is_finite() && (0.0..=1e6).contains(&v))
                {
                    bail!("{} must be between 0 and 1000000", field);
                }
            }
            for field in [
                "cacheWriteInputUsdPerMillion",
                "longContextInputMultiplier",
                "longContextOutputMultiplier",
                "fastMultiplier",
                "offPeakMultiplier",
                "ratesChangeMultiplier",
            ] {
                if rates.get(field).is_some_and(|v| {
                    !v.is_null()
                        && !v
                            .as_f64()
                            .is_some_and(|v| v.is_finite() && (0.0..=1e6).contains(&v))
                }) {
                    bail!("Invalid {}", field);
                }
            }
            let aliases = rates.get("aliases").cloned().unwrap_or(json!([]));
            if !aliases.as_array().is_some_and(|a| {
                a.len() <= 50
                    && a.iter().all(|v| {
                        v.as_str()
                            .is_some_and(|s| !s.trim().is_empty() && s.len() <= 160)
                    })
            }) {
                bail!("Aliases must be a list of model IDs or names");
            }
            let config = self.model_pricing();
            for alias in
                std::iter::once(json!(id)).chain(aliases.as_array().unwrap().iter().cloned())
            {
                if let Some(existing) = match_model(&config, alias.as_str().unwrap()) {
                    if existing != id {
                        bail!("Model name already belongs to {}", existing);
                    }
                }
            }
            rates.as_object_mut().unwrap().remove("custom");
            rates["aliases"] = aliases;
            overrides[id] = rates;
        }
        self.db
            .set_kv("model_pricing", &serde_json::to_string(&overrides)?)?;
        Ok(self.model_pricing())
    }
}
