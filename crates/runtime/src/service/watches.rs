use super::*;

pub(super) fn schedule_label(cron: &str, recurring: bool) -> String {
    if !recurring {
        return format!("Once ({cron})");
    }
    let parts: Vec<_> = cron.split_whitespace().collect();
    if parts.len() != 5 {
        return format!("Cron: {cron}");
    }
    if parts[1..] == ["*", "*", "*", "*"] {
        if parts[0] == "*" {
            return "Every minute".into();
        }
        if let Some(n) = parts[0]
            .strip_prefix("*/")
            .and_then(|n| n.parse::<u32>().ok())
            .filter(|n| *n > 0 && *n <= 60 && 60 % *n == 0)
        {
            return format!("Every {n} minutes");
        }
        let mut minutes = parts[0]
            .split(',')
            .map(str::parse::<u32>)
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap_or_default();
        minutes.sort_unstable();
        minutes.dedup();
        if !minutes.is_empty() && minutes.iter().all(|n| *n < 60) {
            let gaps: Vec<_> = (0..minutes.len())
                .map(|i| {
                    if i + 1 == minutes.len() {
                        60 + minutes[0] - minutes[i]
                    } else {
                        minutes[i + 1] - minutes[i]
                    }
                })
                .collect();
            if gaps.iter().all(|gap| *gap == gaps[0]) {
                return format!(
                    "Every {} minutes (at {})",
                    gaps[0],
                    minutes
                        .iter()
                        .map(|m| format!(":{m:02}"))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
            }
        }
    }
    if parts[0] == "0" && parts[2..] == ["*", "*", "*"] {
        if let Some(n) = parts[1]
            .strip_prefix("*/")
            .and_then(|n| n.parse::<u32>().ok())
            .filter(|n| *n > 0 && *n <= 24 && 24 % *n == 0)
        {
            return format!("Every {n} hours");
        }
    }
    format!("Cron: {cron}")
}

fn input_and_result(detail: &str) -> Option<(Value, &str)> {
    let (_, input) = detail.split_once("Input:\n")?;
    let (input, result) = input
        .split_once("\n\nResult:\n")
        .or_else(|| input.split_once("\n\nOutput:\n"))?;
    Some((serde_json::from_str(input).ok()?, result))
}

impl Supervisor {
    pub async fn thread_watches(&self, id: &str) -> Result<Value> {
        let thread = self.get_thread(id)?;
        if thread.provider != Provider::Claude
            && !(thread.provider == Provider::Acp && thread.agent_id.as_deref() == Some("claude"))
        {
            return Ok(json!({"watches":[]}));
        }
        self.sync_claude_scheduled_history(id).await?;
        let current = if let Some(session) = thread.provider_session_id.as_deref() {
            self.runtime(thread.provider)?
                .session_instance_id(session)
                .await
        } else {
            None
        };
        let records=self.db.with(|conn|{
            let mut stmt=conn.prepare("SELECT item_json,turn_id FROM thread_history_items WHERE thread_id=?1 AND json_extract(item_json,'$.text') IN ('CronCreate','CronDelete') ORDER BY created_at,rowid")?;
            let rows=stmt.query_map([id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
            Ok(rows)
        })?;
        let mut jobs = HashMap::<String, Value>::new();
        for (raw, turn) in records {
            let item: ThreadHistoryItemDto = serde_json::from_str(&raw)?;
            if item.status.as_deref() != Some("completed") {
                continue;
            }
            let Some((input, result)) = item.detail_text.as_deref().and_then(input_and_result)
            else {
                continue;
            };
            if item.text == "CronDelete" {
                if let Some(job) = input["id"].as_str() {
                    jobs.remove(job);
                }
                continue;
            }
            let (Some(cron), Some(prompt)) = (input["cron"].as_str(), input["prompt"].as_str())
            else {
                continue;
            };
            if !result.to_ascii_lowercase().contains("scheduled") {
                continue;
            }
            let Some(job) = result
                .split_once("job ")
                .and_then(|(_, rest)| rest.split_whitespace().next())
                .map(|id| id.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-'))
            else {
                continue;
            };
            let recurring = input["recurring"]
                .as_bool()
                .unwrap_or_else(|| result.contains("recurring"));
            let expiry = result
                .split_once("expires after ")
                .and_then(|(_, tail)| tail.split_whitespace().next())
                .and_then(|n| n.parse::<i64>().ok())
                .filter(|n| *n > 0 && *n < 366)
                .and_then(|days| {
                    item.created_at
                        .as_deref()
                        .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
                        .map(|at| at + chrono::Duration::days(days))
                });
            if expiry.is_some_and(|at| at < chrono::Utc::now()) {
                continue;
            }
            let last=self.db.with(|conn|Ok(conn.query_row("SELECT MAX(started_at) FROM thread_turns WHERE thread_id=?1 AND id LIKE '%:scheduled:%' AND display_prompt=?2",params![id,prompt],|r|r.get::<_,Option<String>>(0))?))?;
            if !recurring
                && last
                    .as_deref()
                    .zip(item.created_at.as_deref())
                    .is_some_and(|(last, created)| last > created)
            {
                continue;
            }
            let created_instance = self.db.get_kv(&format!("turn-process:{turn}"))?;
            let status = match (&created_instance, &current) {
                (Some(a), Some(b)) if a == b => "active",
                (Some(_), _) => "sessionEnded",
                _ => "unconfirmed",
            };
            jobs.insert(job.into(),json!({"id":job,"cron":cron,"schedule":schedule_label(cron,recurring),"prompt":prompt,"recurring":recurring,"createdAt":item.created_at,"lastTriggeredAt":last,"expiresAt":expiry.map(|at|at.to_rfc3339()),"status":status}));
        }
        let mut watches: Vec<_> = jobs.into_values().collect();
        watches.sort_by(|a, b| a["createdAt"].as_str().cmp(&b["createdAt"].as_str()));
        Ok(
            json!({"watches":watches,"timezone":format!("Device local time (UTC{})",chrono::Local::now().offset())}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_real_claude_watch_result_and_supported_cadences_without_guessing() {
        let raw="Tool: CronCreate\n\nInput:\n{\"cron\":\"13,43 * * * *\",\"prompt\":\"Read inbox\",\"recurring\":true}\n\nResult:\nScheduled recurring job 9b3254c0 (13,43 * * * *). Auto-expires after 7 days.";
        let (input, result) = input_and_result(raw).unwrap();
        assert_eq!(input["prompt"], "Read inbox");
        assert!(result.contains("9b3254c0"));
        assert_eq!(
            schedule_label("13,43 * * * *", true),
            "Every 30 minutes (at :13, :43)"
        );
        assert_eq!(schedule_label("*/5 * * * *", true), "Every 5 minutes");
        assert_eq!(schedule_label("*/7 * * * *", true), "Cron: */7 * * * *");
        assert_eq!(schedule_label("0 */3 * * *", true), "Every 3 hours");
        assert_eq!(schedule_label("0 9 * * MON", true), "Cron: 0 9 * * MON");
        assert_eq!(schedule_label("* * * * *", false), "Once (* * * * *)");
        assert!(input_and_result("Input:\n{incomplete").is_none());
    }
}
