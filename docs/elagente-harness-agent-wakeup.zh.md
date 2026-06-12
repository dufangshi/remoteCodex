# 从 ElAgenteHarness 唤醒 Agent Session:调查报告与 Phase 1 计划

日期:2026-06-12
状态:Phase 1(thread-level wakeup)实施中,见文末实施章节。
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

---

# Phase 1 实施方案(thread-level wakeup)

前提:worker pod 常驻热运行,不考虑冷启动恢复。control-plane 代码
零改动(staging 测试用 kubectl 手动注入 env;动态 sandbox 的 env
注入列为后续部署 TODO)。harness 侧代码零改动。

## 实施前确认的事实(代码核对结论)

- agent 被 developer instructions 指示**直接** curl harness
  (`harness-developer-instructions.ts`),携带 sandbox env
  `INACT_X_APP_KEY`;agent 与 worker 共用同一个 harness member 身份。
- worker 全局 onRequest hook 对除 `/healthz`、`/readyz` 外的所有路径
  强制 worker token(`app.ts` WORKER_AUTH_EXEMPT_PATHS);agent 在
  pod 内无 worker token,所以 agent 自助路由需 loopback 放行。
- notify 回调签名:HMAC-SHA256 **hexdigest**,签 JSON 原始字节
  (`X-Webhook-Signature`);Python `json.dumps` 与 JS
  `JSON.stringify` 字节不同,因此回调链路全程必须保留**原始 body**
  (router 与 worker 都用 scoped buffer content-type parser)。
- 通知已读语义:`GET /notify/inbox/{id}` 标记已读;revival 只对未读
  通知每 600s 重发;未读残留会导致 revival 永久重发,所以唤醒成功后
  必须 ack。
- 路由器 route token TTL 300s,不能用于回调;hooks 路径需要免
  route-token 透传,由 worker 自鉴权(URL 内 256-bit token + HMAC)。
- `GET /members/.me` 返回 TOML,含数字 `id`,即 `notify_to` 与
  `/notify/register` 的 `agent_id`。
- `GET /compute/jobs/{id}` 返回 TOML(`status` ∈
  pending/running/done/failed/cancelled);inbox 列表为
  `[[notifications]]` TOML 块,均可行解析。

## 改动清单

### packages/config

- 新增 `REMOTE_CODEX_HARNESS_WAKEUP_CALLBACK_BASE_URL`(见下)→
  `harnessWakeupCallbackBaseUrl: string | null`。
  语义:**映射到本 worker `/api/hooks` 的公网(或本地)base URL**:
  - EKS:`https://sandbox-router.lnz.app/api/sandboxes/<sandboxId>/hooks`
  - 本地:`http://127.0.0.1:8787/api/hooks`
  未设置 = wakeup 关闭。

### packages/db(迁移 0027)

- `harness_notify_registrations`:单行(id='default'),存
  agent_id、hook_token、secret、callback_url、注册时间。回调 URL
  变化时重新注册。
- `harness_job_watches`:job_id UNIQUE、thread_id、title、
  status(pending|delivered|failed)、last_job_status、last_error、
  delivered_at。

### apps/supervisor-api

- `WorkerHarnessClient` 新增:`whoami()`(解析 .me 的 id)、
  `registerNotifyCallback()`、`getComputeJob()`(TOML 行解析)、
  `listInboxUnread()`、`markNotificationRead()`。
- 新服务 `HarnessWakeupService`:
  - `ensureRegistration()`:懒注册;生成 hook token + HMAC secret,
    callback = `${base}/harness-notify/${token}?u=${userId}`。
  - `watchJob({jobId, threadId?, title?})`:threadId 缺省时复用
    invoke 路由的"唯一 running thread"推断;upsert watch 并确保注册。
  - `handleCallback(token, rawBody, signature)`:timing-safe 校验
    token + HMAC → 立即 202 → 后台 reconcile(harness 回调超时仅 5s)。
  - `reconcile()`:对所有 pending watch 查 job 状态;terminal →
    唤醒(thread 断连先 `resumeThread`,再 `sendPrompt` 注入唤醒
    消息);成功标记 delivered;thread 正在跑 turn 且 backend 不支持
    steering(409)→ 保持 pending,靠 revival 重试;最后对“对应
    watch 已 delivered/不存在”的未读 jobs 通知逐条 ack。
- 路由:
  - `POST /api/hooks/harness-notify/:token`:豁免 worker token 与
    product auth;scoped buffer parser 保原始字节。
  - `GET /api/harness/wakeup`:返回 {enabled, notifyTo};
  - `POST /api/harness/job-watches`:注册 watch;
    后两条豁免全局 worker-token hook,handler 内放行
    loopback(pod 内 agent)或合法 worker token。
- invoke 路由(`/api/harness/modules/:module/tools/:tool/invoke`):
  响应含 jobId 且上下文有 threadId 时自动 watchJob(尽力而为)。
- developer instructions:wakeup 启用时追加说明,教 agent:
  `GET /api/harness/wakeup` 拿 notify_to → 提交 job 带 notify_to →
  `POST /api/harness/job-watches` → 结束 turn 等唤醒。

### apps/sandbox-router

- `SandboxEndpointResolver` 入参从 routeToken 改为
  `{sandboxId, userId}`(纯重构)。
- 新路由 `POST /api/sandboxes/:sandboxId/hooks/*`:
  - 免 route token;scoped buffer parser,原始字节透传;
  - userId 取 `?u=`(control-plane resolver 需要);
  - 限流 key `hook:<sandboxId>`;审计 action `hook.forwarded`;
  - **不**注入 worker token / identity headers(剥除入站内部头不变);
  - 转发到 worker `/api/hooks/<rest>`,剥除 `u`/`token` 查询参数。

## 唤醒消息(注入 prompt)

```
[Harness job wakeup] Job <id> ("<title>") finished with status: <status>.
Fetch details/outputs via the harness API (GET /compute/jobs/<id>,
GET /compute/jobs/<id>/files/...), then continue the original task.
```

## 测试计划

- supervisor-api 单测:watch 注册(loopback/worker-token/拒绝)、
  回调验签(token/HMAC/原始字节)、reconcile 唤醒与 409 重试、
  通知 ack、TOML 解析。
- sandbox-router 单测:hooks 免 token 转发、原始 body 透传、不注入
  内部头、限流。
- 本地 e2e:本地起 harness(uv)+ supervisor,真实提交 local
  backend job,验证回调→唤醒闭环。
- EKS staging:对常驻 worker 手动注入 callback env,走
  `sandbox-router.lnz.app` 验证公网回调路径。

## 实施进展(2026-06-12)

- ✅ worker 侧全部落地(config / 迁移 0027 / WorkerHarnessClient 扩展 /
  HarnessWakeupService / hooks 与 watch 路由 / invoke 自动 watch /
  developer instructions),单测 21 个全绿;另暴露
  `GET /api/harness/job-watches` 供运维观测。
- ✅ sandbox-router hooks 透传落地(resolver 入参重构为
  `{sandboxId, userId}`,`POST /api/sandboxes/:id/hooks/*` 免 route
  token、原始字节透传、不注入内部头、独立限流与审计),16 个测试全绿。
- ✅ 本地 e2e 全链路通过(`harness-wakeup-local-e2e.test.ts`,
  `RUN_HARNESS_WAKEUP_E2E=1` 门控):真实本地 harness → 提交 local
  backend job → watch → 模拟 compute worker 上报 done → 真实 notify
  回调(HMAC 原始字节)→ 验签 → reconcile → sendPrompt 注入
  `[Harness job wakeup]` → watch delivered → 通知 ack。
- ⏳ EKS staging 验证进行中:自建 `wakeup-e2e` 镜像已推 ECR;
  独立测试 worker + 静态路由测试 router(公网 NLB)部署中。

### 过程中发现的环境事实(影响后续部署)

1. **Railway harness 没有 local backend 的 compute worker 在消费**:
   提交的 probe job 一直 pending。staging 全闭环需要 harness 侧有
   worker,或拿到其 `COMPUTE_WORKER_TOKEN` 模拟。
2. **main 上 `packages/thread-ui` 已移除,lockfile 指向兄弟目录
   `../remote-codex-thread-ui`(私有仓库)**:本机两把 ssh key 均无权
   克隆;`Dockerfile.worker` 的全量 `pnpm install` 因此失败。本次用
   filtered install(`--filter @remote-codex/supervisor-api...` 等)
   绕过;`staging-images.yml` 对 main 的镜像构建大概率同样会挂,需要
   后续适配(checkout 兄弟仓库或改 filtered install)。
3. staging 的 sandbox-router 由 control-plane resolver 驱动,静态
   endpoints 在 CP 配置存在时不参与解析;因此 EKS 验证采用独立测试
   router(静态解析 + 临时 NLB),不动现网 router 的配置。

## 后续(非 Phase 1)

- control-plane 在创建 sandbox pod 时注入
  `REMOTE_CODEX_HARNESS_WAKEUP_CALLBACK_BASE_URL`;
- 冷唤醒(sandbox 重建)与 control-plane webhook 接收端;
- provider session 状态持久化验证(EFS)。
