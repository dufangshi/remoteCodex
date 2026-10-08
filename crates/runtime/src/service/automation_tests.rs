use super::*;
use crate::fake::FakeRuntime;

fn supervisor(dir: &Path) -> Arc<Supervisor> {
    let config = RuntimeConfig {
        mode: remote_codex_protocol::Mode::Local,
        host: "127.0.0.1".into(),
        port: 0,
        workspace_root: dir.into(),
        database_url: dir.join("db.sqlite"),
        app_name: "test".into(),
        app_version: "test".into(),
        environment: "test".into(),
        auth_required: false,
        admin_username: None,
        admin_password: None,
        session_secret: None,
        relay_server_url: None,
        relay_agent_token: None,
        enabled_providers: vec![Provider::Codex],
        acp_command: None,
        acp_startup_timeout_ms: 1000,
        fake_runtime: true,
    };
    let db = Database::open(&config.database_url).unwrap();
    let s = Arc::new(Supervisor::new(
        config,
        db,
        vec![Arc::new(FakeRuntime::new(Provider::Codex))],
    ));
    s.spawn_live_item_persister();
    s
}
async fn setup() -> (tempfile::TempDir, Arc<Supervisor>, String) {
    let dir = tempfile::tempdir().unwrap();
    let s = supervisor(dir.path());
    let w = s
        .create_workspace(CreateWorkspaceInput {
            abs_path: Some(dir.path().to_string_lossy().into()),
            git_url: None,
            label: None,
        })
        .unwrap();
    let t = s
        .create_thread(CreateThreadInput {
            workspace_id: w.id,
            title: None,
            provider: Some(Provider::Codex),
            agent_id: None,
            model: "ios-e2e-stream".into(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
            parent_thread_id: None,
        })
        .await
        .unwrap();
    (dir, s, t.id)
}
fn def(trigger: Value, action: Value) -> Definition {
    serde_json::from_value(json!({"name":"fixture","trigger":trigger,"action":action})).unwrap()
}
fn hourly(action: Value) -> Definition {
    def(
        json!({"kind":"interval","everySeconds":3600,"anchorAt":"2030-01-01T01:00:00Z"}),
        action,
    )
}
fn prompt() -> Value {
    json!({"kind":"prompt","text":"hello automation"})
}
fn notice() -> Value {
    json!({"kind":"notifyInbox","subject":"fixture result","text":"done","includeClosingMessage":true})
}
fn runs(s: &Supervisor, t: &str, id: &str) -> Vec<Value> {
    s.automation_runs(t, id, 100).unwrap()["runs"]
        .as_array()
        .unwrap()
        .clone()
}
fn pending(s: &Supervisor, t: &str) -> i64 {
    s.db.with(|c| {
        Ok(c.query_row(
            "SELECT count(*) FROM thread_pending_steers WHERE thread_id=?1",
            [t],
            |r| r.get(0),
        )?)
    })
    .unwrap()
}
fn mail(s: &Supervisor, t: &str) -> i64 {
    s.db.with(|c| {
        Ok(c.query_row(
            "SELECT count(*) FROM kv WHERE key GLOB ?1",
            [format!("cli:inbox:{t}:*")],
            |r| r.get(0),
        )?)
    })
    .unwrap()
}
fn turn(s: &Supervisor, t: &str, id: &str, status: &str) {
    s.db.with(|c|{c.execute("INSERT INTO thread_turns(id,thread_id,status,display_prompt,started_at,ordinal) VALUES(?1,?2,?3,'fixture','2030-01-01T00:00:00Z',(SELECT coalesce(max(ordinal),0)+1 FROM thread_turns WHERE thread_id=?2))",params![id,t,status])?;c.execute("UPDATE threads SET status='running' WHERE id=?1",[t])?;Ok(())}).unwrap();
}
fn finish(s: &Supervisor, t: &str, id: &str, status: &str) {
    s.persist_turn_result(t, id, status, None, &[], "2030-01-01T03:30:00Z")
        .unwrap();
}
async fn wait_command(s: &Supervisor, t: &str, run: &str) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let r = runs(s, t, run);
            if r[0]["state"] != "running" {
                return r[0].clone();
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn automation_busy_two_and_half_periods_coalesces_until_whole_turn_ends() {
    let (_dir, s, t) = setup().await;
    turn(&s, &t, "user-turn", "inProgress");
    let a = s
        .automation_create(&t, hourly(prompt()), Some("hourly"))
        .unwrap();
    let id = a["id"].as_str().unwrap();
    s.automation_tick("2030-01-01T01:00:00Z").await.unwrap();
    s.drain_steers(&t).await.unwrap();
    assert_eq!(pending(&s, &t), 1);
    // Tool/item progress is deliberately not a completion boundary.
    s.bus.emit(remote_codex_protocol::ThreadEventEnvelope{event_type:"thread.item.completed".into(),thread_id:t.clone(),timestamp:"2030-01-01T02:00:00Z".into(),payload:json!({"turnId":"user-turn","item":{"id":"tool","kind":"toolCall","text":"batch finished","status":"completed"}})});
    s.automation_tick("2030-01-01T03:30:00Z").await.unwrap();
    s.drain_steers(&t).await.unwrap();
    let r = runs(&s, &t, id);
    assert_eq!(r.len(), 1);
    assert_eq!(r[0]["state"], "queued");
    assert_eq!(r[0]["missedCount"], 2);
    assert!(r[0]["turnId"].is_null());
    assert_eq!(pending(&s, &t), 1);
    assert_eq!(
        s.automation_show(&t, id).unwrap()["nextRunAt"],
        "2030-01-01T04:00:00.000Z"
    );
    finish(&s, &t, "user-turn", "completed");
    s.drain_steers(&t).await.unwrap();
    assert_eq!(pending(&s, &t), 0);
    assert!(runs(&s, &t, id)[0]["turnId"].is_string());
}

#[tokio::test]
async fn automation_restart_merges_downtime_and_lost_ack_does_not_repeat_acceptance() {
    let (dir, s, t) = setup().await;
    let d = hourly(prompt());
    let a = s.automation_create(&t, d.clone(), Some("stable")).unwrap();
    let id = a["id"].as_str().unwrap().to_owned();
    s.automation_tick("2030-01-01T01:00:00Z").await.unwrap();
    drop(s);
    let s = supervisor(dir.path());
    s.automation_tick("2030-01-01T03:30:00Z").await.unwrap();
    assert_eq!(pending(&s, &t), 1);
    assert_eq!(runs(&s, &t, &id)[0]["missedCount"], 2);
    assert_eq!(
        s.automation_create(&t, d, Some("stable")).unwrap()["id"],
        id
    );
    s.automation_tick("2030-01-01T03:30:00Z").await.unwrap();
    assert_eq!(pending(&s, &t), 1);
    assert!(s
        .automation_create(&t, hourly(notice()), Some("stable"))
        .unwrap_err()
        .to_string()
        .contains("conflict"));
    s.automation_control(&t, &id, "pause").unwrap();
    assert_eq!(pending(&s, &t), 0);
}

#[tokio::test]
async fn automation_exact_turn_conditions_and_repeated_terminal_events_are_passive() {
    let (_dir, s, t) = setup().await;
    turn(&s, &t, "source", "inProgress");
    turn(&s, &t, "other", "inProgress");
    let mut d = def(
        json!({"kind":"turnEnded","sourceThreadId":t,"turnId":"source"}),
        notice(),
    );
    d.condition = Condition::All {
        conditions: vec![
            Condition::StatusIn {
                values: vec!["completed".into()],
            },
            Condition::Not {
                condition: Box::new(Condition::StatusIn {
                    values: vec!["failed".into()],
                }),
            },
        ],
    };
    let a = s.automation_create(&t, d, None).unwrap();
    let id = a["id"].as_str().unwrap();
    finish(&s, &t, "other", "completed");
    s.automation_tick("2030-01-01T03:30:00Z").await.unwrap();
    assert!(runs(&s, &t, id).is_empty());
    finish(&s, &t, "source", "completed");
    finish(&s, &t, "source", "completed");
    // Receiver can be running; ordinary result still never queues or prompts.
    s.db.with(|c| {
        c.execute("UPDATE threads SET status='running' WHERE id=?1", [&t])?;
        Ok(())
    })
    .unwrap();
    s.automation_tick("2030-01-01T03:30:00Z").await.unwrap();
    s.automation_tick("2030-01-01T03:30:00Z").await.unwrap();
    assert_eq!(mail(&s, &t), 1);
    assert_eq!(pending(&s, &t), 0);
    assert_eq!(runs(&s, &t, id).len(), 1);
    assert!(s
        .automation_create(
            &t,
            def(
                json!({"kind":"turnEnded","sourceThreadId":t,"turnId":"source"}),
                notice()
            ),
            None
        )
        .unwrap_err()
        .to_string()
        .contains("sourceAlreadyEnded"));
    let mut d = def(
        json!({"kind":"turnEnded","sourceThreadId":t,"turnId":"source"}),
        notice(),
    );
    d.replay_existing = true;
    let b = s.automation_create(&t, d, None).unwrap();
    s.automation_tick(&now_rfc3339()).await.unwrap();
    assert_eq!(
        runs(&s, &t, b["id"].as_str().unwrap())[0]["state"],
        "completed"
    );
    assert_eq!(mail(&s, &t), 2);
}

#[tokio::test]
async fn automation_task_failed_is_distinct_and_does_not_unblock_dependencies() {
    let (_dir, s, t) = setup().await;
    let task = s.task_add(&t, "build", None, &[], None).unwrap();
    let number = task["number"]
        .as_i64()
        .or_else(|| task["task"]["number"].as_i64())
        .unwrap();
    s.task_add(&t, "dependent", None, &[number], None).unwrap();
    let mut d = def(
        json!({"kind":"taskEnded","rootThreadId":t,"taskNumber":number}),
        notice(),
    );
    d.condition = Condition::StatusIn {
        values: vec!["completed".into()],
    };
    let a = s.automation_create(&t, d, None).unwrap();
    s.task_done(&t, number, Some("build failed"), true).unwrap();
    s.automation_tick(&now_rfc3339()).await.unwrap();
    assert_eq!(
        runs(&s, &t, a["id"].as_str().unwrap())[0]["state"],
        "conditionSkipped"
    );
    assert_eq!(pending(&s, &t), 0);
    assert_eq!(mail(&s, &t), 0);
    let claimed = s.task_claim(&t, Some(number + 1)).unwrap_err().to_string();
    assert!(claimed.contains("waiting on"), "{claimed}");
}

#[tokio::test]
async fn automation_pause_cancel_and_user_stop_remove_only_owned_pending() {
    let (_dir, s, t) = setup().await;
    turn(&s, &t, "user", "inProgress");
    s.send_to_thread(
        &t,
        serde_json::from_value(
            json!({"text":"user queued message","delivery":"queue","kind":"task"}),
        )
        .unwrap(),
    )
    .unwrap();
    let a = s.automation_create(&t, hourly(prompt()), None).unwrap();
    let id = a["id"].as_str().unwrap();
    s.automation_tick("2030-01-01T01:00:00Z").await.unwrap();
    assert_eq!(pending(&s, &t), 2);
    s.automation_control(&t, id, "pause").unwrap();
    assert_eq!(pending(&s, &t), 1);
    s.automation_tick("2030-01-01T05:00:00Z").await.unwrap();
    assert_eq!(pending(&s, &t), 1);
    s.automation_control(&t, id, "resume").unwrap();
    s.automation_tick("2030-01-01T05:00:00Z").await.unwrap();
    s.interrupt(&t).await.unwrap();
    assert_eq!(pending(&s, &t), 1);
    assert_eq!(s.automation_show(&t, id).unwrap()["state"], "paused");
    s.automation_control(&t, id, "cancel").unwrap();
    assert!(s.automation_control(&t, id, "resume").is_err());
    assert_eq!(pending(&s, &t), 1);
}

#[tokio::test]
async fn automation_at_inbox_is_passive_for_idle_and_missed_policy_skips_late_runs() {
    let (_dir, s, t) = setup().await;
    let a = s
        .automation_create(
            &t,
            def(json!({"kind":"at","at":"2030-01-01T01:00:00Z"}), notice()),
            None,
        )
        .unwrap();
    s.automation_tick("2030-01-01T01:00:00Z").await.unwrap();
    assert_eq!(mail(&s, &t), 1);
    assert_eq!(pending(&s, &t), 0);
    assert_eq!(s.get_thread(&t).unwrap().status, "idle");
    assert_eq!(
        runs(&s, &t, a["id"].as_str().unwrap())[0]["state"],
        "completed"
    );
    let mut d = hourly(prompt());
    d.missed_run_policy = MissedRunPolicy::Skip;
    let a = s.automation_create(&t, d, None).unwrap();
    s.automation_tick("2030-01-01T04:00:00Z").await.unwrap();
    assert_eq!(
        runs(&s, &t, a["id"].as_str().unwrap())[0]["state"],
        "skipped"
    );
    let a = s
        .automation_create(
            &t,
            def(json!({"kind":"at","at":"2030-01-01T01:00:00Z"}), prompt()),
            None,
        )
        .unwrap();
    s.automation_tick("2030-01-03T01:00:00Z").await.unwrap();
    assert_eq!(
        runs(&s, &t, a["id"].as_str().unwrap())[0]["state"],
        "skipped"
    );
    assert_eq!(pending(&s, &t), 0);
}

#[cfg(unix)]
#[tokio::test]
async fn automation_time_and_command_events_execute_real_scripts_once_and_exclude_failures() {
    let (dir, s, t) = setup().await;
    let script = json!({"kind":"runScript","argv":["/bin/sh","-c","printf 'run\\n' >> executions; test -z \"$REMOTE_CODEX_TOKEN$REMOTE_CODEX_URL$REMOTE_CODEX_CLI_CONFIG\""],"cwd":".","timeoutSeconds":3});
    let a = s
        .automation_create(
            &t,
            def(
                json!({"kind":"at","at":"2030-01-01T01:00:00Z"}),
                script.clone(),
            ),
            None,
        )
        .unwrap();
    let aid = a["id"].as_str().unwrap();
    s.automation_tick("2030-01-01T01:00:00Z").await.unwrap();
    assert_eq!(wait_command(&s, &t, aid).await["state"], "completed");
    let mut d = def(
        json!({"kind":"commandEnded","sourceThreadId":t,"commandKey":"build"}),
        script,
    );
    d.condition = Condition::ExitCodeEquals { value: 0 };
    let a = s.automation_create(&t, d, None).unwrap();
    let aid = a["id"].as_str().unwrap();
    let input:CommandRunInput=serde_json::from_value(json!({"argv":["/bin/sh","-c","printf wrapper"],"cwd":".","commandKey":"build","clientRequestId":"build-once"})).unwrap();
    let result = s.command_run(&t, input.clone()).await.unwrap();
    assert_eq!(result["state"], "completed");
    assert_eq!(result["stdout"], "wrapper");
    assert_eq!(s.command_run(&t, input).await.unwrap()["id"], result["id"]);
    s.automation_tick(&now_rfc3339()).await.unwrap();
    assert_eq!(wait_command(&s, &t, aid).await["state"], "completed");
    s.automation_tick(&now_rfc3339()).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("executions")).unwrap(),
        "run\nrun\n"
    );
    assert_eq!(runs(&s, &t, aid).len(), 1);
    assert_eq!(pending(&s, &t), 0);
    for (key, shell, timeout, expected) in [
        ("fail", "exit 7", 3, "failed"),
        ("timeout", "sleep 30", 1, "timedOut"),
    ] {
        let result=s.command_run(&t,serde_json::from_value(json!({"shell":shell,"cwd":".","timeoutSeconds":timeout,"commandKey":"build","clientRequestId":key})).unwrap()).await.unwrap();
        assert_eq!(result["state"], expected);
    }
    s.automation_tick(&now_rfc3339()).await.unwrap();
    let r = runs(&s, &t, aid);
    assert_eq!(r.len(), 3);
    assert_eq!(
        r.iter()
            .filter(|r| r["state"] == "conditionSkipped")
            .count(),
        2
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("executions")).unwrap(),
        "run\nrun\n"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn automation_spawn_then_crash_is_uncertain_and_does_not_repeat_effects() {
    let (dir, s, t) = setup().await;
    let input:CommandRunInput=serde_json::from_value(json!({"shell":"printf x >> effect; echo $$ > childpid; sleep 30","cwd":".","clientRequestId":"crash"})).unwrap();
    let id =
        s.db.with(|c| insert_command(c, &t, &input, None, &[], &now_rfc3339()))
            .unwrap();
    let worker = {
        let s = s.clone();
        let id = id.clone();
        tokio::spawn(async move { s.execute_command(&id).await })
    };
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while !dir.path().join("childpid").exists() {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    worker.abort();
    let _ = worker.await;
    let pid = std::fs::read_to_string(dir.path().join("childpid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    kill_command_tree(pid).await;
    s.recover_automation_commands().unwrap();
    assert_eq!(s.command_show(&t, &id).unwrap()["state"], "uncertain");
    assert_eq!(
        s.command_run(&t, input).await.unwrap()["state"],
        "uncertain"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("effect")).unwrap(),
        "x"
    );
    assert_eq!(mail(&s, &t), 1);
}

#[test]
fn automation_typed_conditions_and_loop_guard_do_not_treat_unknown_exit_as_success() {
    let cond = Condition::Any {
        conditions: vec![
            Condition::ExitCodeEquals { value: 0 },
            Condition::All {
                conditions: vec![
                    Condition::StatusIn {
                        values: vec!["completed".into()],
                    },
                    Condition::CommandId {
                        value: "selected".into(),
                    },
                ],
            },
        ],
    };
    assert!(!condition_ok(
        &cond,
        &json!({"status":"uncertain","exitCode":0})
    ));
    assert!(!condition_ok(&cond, &json!({"status":"completed"})));
    assert!(condition_ok(
        &cond,
        &json!({"status":"completed","commandId":"selected"})
    ));
    assert!(serde_json::from_value::<Definition>(
        json!({"name":"bad","trigger":{"kind":"ptyRegex"},"action":prompt()})
    )
    .is_err());
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.with(|c|{c.execute("INSERT INTO automations(id,thread_id,definition_json,state,event_cursor,created_at,updated_at) VALUES('same','t','{}','enabled',0,'now','now')",[])?;create_run(c,"same",&hourly(prompt()),"loop","2030-01-01T00:00:00Z","2030-01-01T00:00:00Z",&json!({"ancestry":["same"]}),0)?;let state:String=c.query_row("SELECT state FROM automation_runs",[],|r|r.get(0))?;assert_eq!(state,"loopSkipped");Ok(())}).unwrap();
}

#[tokio::test]
async fn automation_failed_and_interrupted_turn_conditions_are_exact_and_expired_queue_is_removed()
{
    let (_dir, s, t) = setup().await;
    for status in ["failed", "interrupted"] {
        turn(&s, &t, status, "inProgress");
        let mut d = def(
            json!({"kind":"turnEnded","sourceThreadId":t,"turnId":status}),
            notice(),
        );
        d.condition = Condition::StatusIn {
            values: vec![status.into()],
        };
        let a = s.automation_create(&t, d, None).unwrap();
        finish(&s, &t, status, status);
        s.automation_tick("2030-01-01T03:30:00Z").await.unwrap();
        assert_eq!(
            runs(&s, &t, a["id"].as_str().unwrap())[0]["state"],
            "completed"
        );
    }
    turn(&s, &t, "busy", "inProgress");
    let mut d = def(json!({"kind":"at","at":"2020-01-01T00:00:00Z"}), prompt());
    d.max_lateness_seconds = u64::MAX.min(31536000);
    // Admit with a deterministic clock, then prove the real queue boundary checks lateness.
    let a = s.automation_create(&t, d, None).unwrap();
    let id = a["id"].as_str().unwrap();
    s.automation_tick("2020-01-01T00:00:00Z").await.unwrap();
    assert_eq!(pending(&s, &t), 1);
    finish(&s, &t, "busy", "completed");
    s.drain_steers(&t).await.unwrap();
    assert_eq!(pending(&s, &t), 0);
    assert_eq!(runs(&s, &t, id)[0]["state"], "skipped");
}

#[tokio::test]
async fn automation_stop_does_not_reemit_historical_interrupted_turns() {
    let (_dir, s, t) = setup().await;
    turn(&s, &t, "historical", "interrupted");
    let mut d = def(
        json!({"kind":"turnEnded","sourceThreadId":t,"turnId":"historical"}),
        notice(),
    );
    d.replay_existing = true;
    let a = s.automation_create(&t, d, None).unwrap();
    s.automation_tick(&now_rfc3339()).await.unwrap();
    assert_eq!(mail(&s, &t), 1);
    turn(&s, &t, "current", "inProgress");
    s.interrupt(&t).await.unwrap();
    s.automation_tick(&now_rfc3339()).await.unwrap();
    assert_eq!(runs(&s, &t, a["id"].as_str().unwrap()).len(), 1);
    assert_eq!(mail(&s, &t), 1);
    let old_events =
        s.db.with(|c| {
            Ok(c.query_row(
                "SELECT count(*) FROM automation_events WHERE event_key='turn:historical:terminal'",
                [],
                |r| r.get::<_, i64>(0),
            )?)
        })
        .unwrap();
    assert_eq!(old_events, 0);
}

#[cfg(unix)]
#[tokio::test]
async fn automation_target_deleted_before_spawn_records_failure_without_execution() {
    let (dir, s, t) = setup().await;
    let input: CommandRunInput =
        serde_json::from_value(json!({"shell":"touch should-not-exist","cwd":"."})).unwrap();
    let id =
        s.db.with(|c| insert_command(c, &t, &input, None, &[], &now_rfc3339()))
            .unwrap();
    s.delete_thread(&t).unwrap();
    s.execute_command(&id).await.unwrap();
    assert_eq!(s.command_show(&t, &id).unwrap()["state"], "failed");
    assert!(!dir.path().join("should-not-exist").exists());
}
