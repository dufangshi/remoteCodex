# 从 ElAgenteHarness 唤醒 Agent Session:调查报告

日期:2026-06-12
状态:调查结论,未实施。
范围:ElAgenteHarness(含 inact 子模块)与 remoteCodex 双侧代码。

## 背景与目标

Agent 在 sandbox 里提交一个长时间 compute job(ORCA、Slurm、Modal 等)后,
应当可以直接结束 turn 退出,等 job 完成时由系统把原 session 唤醒并注入
"job 已完成"的后续消息。inact 自带 notify 子系统但一直没有用上,原因是
缺少接收端的唤醒能力。约束:唤醒机制尽量不与 control-plane 耦合。

## 结论先行

**可行,且发送侧基本是现成的。**inact notify 不是只读收件箱,而是一套
完整的 push 系统;compute job 进入 terminal 状态时已经在自动发通知。
真正缺的只有一环:一个能收到回调后把 agent session 重新拉起来的接收端,
而 remoteCodex 的 worker(supervisor-api worker 模式)恰好已经暴露了
`resume` / `prompt` 接口。

notify 的回调注册机制天然解耦:harness 只管向"注册进来的 URL"发 POST,
不需要知道 URL 背后是 worker、control-plane 还是别的组件。"不耦合
control-plane"这一要求在 harness 侧自动满足;耦合发生在哪,完全是
remoteCodex 侧的选择。

## 一、现状盘点

### 1.1 inact notify 已经是 push 系统

源码:`ElAgenteHarness/src/inact/inact/apps/notify.py`

- `POST /notify/register`:agent 注册回调 URL + HMAC secret。
- 通知产生时立即 POST 到回调 URL,带 `X-Webhook-Signature`
  (HMAC-SHA256)。
- 通知持久化在 SQLite inbox;后台 revival 线程每 600 秒对有未读通知的
  agent 重发回调——自带"接收端暂时不在线也能最终唤醒"的重试机制。
- `GET /notify/inbox` 可轮询兜底。
- `src/inact/example/notify_agent.py` 是完整协议的示例实现。

### 1.2 job 完成已经在发通知

job 完成是服务端单点观测的:worker 上报
`POST /compute/worker/jobs/<id>/status`,状态进入 terminal
(done / failed / cancelled)时,同一个 choke point
(`ElAgenteHarness/src/elagente_harness/compute_job/compute_job.py`,
约 1868-1901 行)上已经挂了三件事:

1. `maybe_notify_terminal()` — 只要 job 提交时带了
   `notify_to=<agent_id>`,自动通过 notify 发送
   "Job xx finished" 通知(含回调 push);
2. `_record_compute_usage()` — 计费;
3. `on_terminal` 钩子 — 目前用于把结果 ingest 回
   farmaco / quntur / estructural 的 run 记录。

即:"job 完成 → 发出唤醒信号"这条链路今天就能跑通,只要提交 job 时填
`notify_to` 并注册回调。"notify 一直没用上"的准确表述是:回调没人注册,
信号发出去没人接。

### 1.3 remoteCodex 侧已有的唤醒入口

| 入口 | 端点 | 认证 | 耦合度 |
| --- | --- | --- | --- |
| worker 直连 | `POST /api/threads/:id/resume`、`POST /api/threads/:id/prompt`(`apps/supervisor-api/src/routes/threads.ts` 约 716、733 行) | worker token(`X-Remote-Codex-Worker-Token`)或 route token | 低,不经 control-plane |
| control-plane | `POST /api/sessions/:id/resume`、`POST /api/sessions/:id/prompt`(`apps/control-plane-api/src/app.ts` 约 4156、4216 行) | 产品用户 session token | 高 |

Claude / Codex 两个 runtime 都支持按 provider session id 恢复会话并开
新 turn(`packages/claude/src/runtimeAdapter.ts` 约 1277 行、
`packages/codex/src/runtimeAdapter.ts` 约 632 行),所以
"turn 结束、进程退出后,再注入一条消息继续"在 worker 层面是支持的。

另外两个相关事实:

- `ElAgenteHarness/clients/claude-managed-agent-client` 目前是空壳
  (只有目录结构),像是给受管 agent 循环预留的位置;
- remoteCodex 的交付清单文档里已写有
  "Add harness webhook receiver or polling importer" 条目。

## 二、推荐架构:回调收口在 worker,不碰 control-plane

```text
agent (sandbox 内)                          harness
  │ 提交 job, notify_to=<agent_id>   ──►  jobs 表
  │ (worker 代理层自动注册回调 URL)  ──►  notify_callbacks 表
  │ 结束 turn,正常退出
  ┊        (几小时后)
  ┊                                  job worker POST status=done
  ┊                                        │ terminal choke point
  ┊                                        ▼
  │ ◄── POST <callback_url>(HMAC 签名,600s revival 重试)
  ▼
worker 回调接收端:验证签名
  → 进程内调用 ThreadService.sendPrompt()
  → 以新 turn 注入:"你提交的 job xxx 已完成,结果在 ...,请继续"
```

要点:

- **注册时机**:按既有集成决策,sandbox 内 agent 通过 worker 本地的
  `/api/harness/*` 代理访问 harness(harness key 只在 worker 持有)。
  代理层知道自己的 thread id,可以在 agent 提交带 `notify_to` 的 job 时
  自动注册回调 URL,agent 无感。
- **harness 零改动或近零改动**:发送链路全部现成。
- **worker 新增量很小**:一个回调接收 route
  (验 HMAC → 查 thread → `sendPrompt`),加代理层的自动注册逻辑。
- **耦合方向健康**:harness 不感知 remoteCodex,只持有一个不透明的回调
  URL;依赖仍是单向(remoteCodex → harness,即既有 admin contract 方向)。

## 三、两个真正的难点

### 3.1 回调 URL 的公网可达性与认证

sandbox worker 在 EKS 私网内,外部流量经 sandbox-router,而 router 的
认证依赖 control-plane 签发的 route token,TTL 仅 300 秒——长 job 完成
时任何预签 token 都已过期。可选解法(按推荐排序):

1. **worker 自发自验的长效回调 token(推荐)**:worker 注册回调时自己
   生成随机 token 放进 URL,回调到达时自行验证(再叠加 notify 的 HMAC
   签名)。不需要 control-plane 参与签发;需要 sandbox-router 为回调
   路径开一个"透传、由 worker 自行鉴权"的口子——这是 router 的小改动,
   不是 control-plane 的。
2. 同集群 / 同网直连:harness(Railway)与 worker(EKS)目前网络不可
   达,除非 harness 进集群或走私网,暂不成立。
3. 本地 supervisor 模式最简单:单用户 Tailscale 网内,notify 直接回调
   supervisor-api,没有 router 这一层。

### 3.2 sandbox 已被回收(冷唤醒)

reaper 对空闲 4 小时的 sandbox 执行停止
(`apps/control-plane-api/src/sandbox-reaper.ts`)。化学计算 job 跑
6 小时回来,回调目标已不存在。这是唯一绕不开 control-plane 的环节——
重建 sandbox、重新 materialize session 本来就是 control-plane 的职权。
三种态度:

- **a. 分层接受(推荐)**:热路径(sandbox 存活)纯 worker 解决;
  冷路径后续补一个 control-plane 的通用 webhook 接收端
  ("resume session X")。harness 不感知两者区别——notify revival 每
  600 秒重发,冷路径接收端上线后自然接住。两条路径可分两期,第一期只做
  热路径即有完整价值。
- b. reaper 感知 pending job:有未完成 job 的 sandbox 不回收。实现最
  简单,但 sandbox 空转烧钱,违背"agent 可以退出"的初衷,只适合短期
  过渡。
- c. 完全冷恢复:依赖 EFS workspace 持久化,且要求 provider session
  状态(`CODEX_HOME` / Claude session 文件)也落在持久卷上——后者目前
  未验证(见 §5)。

## 四、工作量评估

| 工作项 | 位置 | 量级 |
| --- | --- | --- |
| 提交 job 时带 `notify_to` + 自动注册回调 | worker 的 harness 代理层 | 小 |
| worker 回调接收 route(HMAC 验证 → sendPrompt) | supervisor-api | 小 |
| sandbox-router 放行 worker 自鉴权的回调路径 | sandbox-router | 小~中 |
| 注入 prompt 的措辞 / 结果定位(让 agent 醒来知道该干嘛) | worker | 小 |
| 冷唤醒(control-plane webhook + sandbox 重建 + session 恢复) | control-plane(二期) | 中~大,依赖 provider session 持久化验证 |
| harness 侧改动 | — | ≈ 0 |

## 五、实施前需确认的开放问题

1. sandbox-router 当前对非 route-token 流量的处理方式
   (决定 §3.1 解法形态);
2. provider session 状态(Codex / Claude 会话文件)是否在 EFS 持久化
   范围内(决定冷唤醒是否可做);
3. notify revival 间隔(600 秒)与重发上限是否满足 SLA——当前实现会
   持续重发直到通知被读,对"接收端晚上线"友好;
4. `notify_to` 使用什么身份:harness 侧 agent 身份为 per-sandbox key
   (`remote-codex:sandbox:<sandboxId>`),sandbox 重建后 id 变化,
   冷唤醒场景需同步 reconcile 回调注册——admin contract 已有
   `reconcile` 接口,可顺带处理。

## 总体判断

热路径(turn 级唤醒)是一个小特性的量级,可以完全不碰 control-plane;
冷路径(sandbox 级唤醒)是真正的工程量所在,但可以推迟,且 notify 的
重试机制保证两期之间不丢信号。
