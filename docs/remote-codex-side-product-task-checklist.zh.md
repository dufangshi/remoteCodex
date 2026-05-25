# Remote Codex 侧产品化任务清单

这份文档用于把 Agente sandbox-worker 产品规划拆成 Remote Codex 仓库内
需要完成的工程任务。它是人工执行清单，适合每天照着推进和勾选。

英文权威证据清单仍然是
`docs/remote-codex-side-detailed-checklist.md`。Phase 0-6 的自动 evidence
脚本会读取英文清单，所以这里不要替代它。完成本文件中的任务后，如果该
任务对应英文清单中的某个 staging/AWS/provider-runtime checkbox，也必须等
真实环境证据存在后再去英文清单里勾选。

本文件是 Remote Codex 侧后续产品化工作的中文主任务板。每个任务都应该能被
单独领取、实现、验证、勾选和提交。外部系统的内部任务不在这里打勾；这里
只打勾 Remote Codex 仓库内已经落地的 API、UI、worker、router、配置、部署
wiring、contract、client、smoke 或文档。

## 当前优先级

先不要从后面的 Phase 随机挑任务。当前推荐顺序是：

- [ ] 完成 Phase 0-6 剩余真实环境 evidence。
  - 包含：AWS/EKS lifecycle、staging router、direct-worker denial、
    browser-to-router-to-worker、Codex/Claude Code/OpenCode gateway runtime smoke。
  - 对应任务：P3.04-P3.08、P5.07-P5.09、P6.10-P6.13。
  - 勾选条件：真实 AWS/staging/provider runtime evidence，不能用本地 mock。

- [ ] 启动 Phase 7 ElAgenteHarness integration。
  - 包含：harness admin contract、scoped `INACT_X_APP_KEY`、worker env 注入、
    harness tool surface、task/job/artifact UI、harness usage import。
  - 对应任务：P7.01-P7.17。
  - 勾选条件：Remote Codex 侧 contract/client/schema/bootstrap/UI/importer/smoke
    已实现；ElAgenteHarness 内部实现不在本仓库勾选。

- [ ] 启动 Phase 8 MCP 和 tool policy。
  - 包含：approved MCP registry、stdio/remote MCP policy、env/path containment、
    Codex/Claude Code/OpenCode config rendering、audit、status UI。
  - 对应任务：P8.01-P8.12。

- [ ] 启动 Phase 9 workspace persistence、files、diffs、artifacts。
  - 包含：snapshot 策略、safe file API、diff API、credential exclusion、
    chemistry artifact display。
  - 对应任务：P9.01-P9.14。

- [ ] 启动 Phase 10 billing、quota 和 unified usage。
  - 包含：LLM、Harness、Compute、Storage、Sandbox runtime 的统一 ledger 和 quota。
  - 对应任务：P10.01-P10.10。

- [ ] 启动 Phase 11 deployment、operations 和 CI。
  - 包含：Railway、ECR、EKS Fargate、S3、secrets、logs、metrics、alerts、CI smoke。
  - 对应任务：P11.01-P11.12。

- [ ] 最后执行 Phase 12 staging end-to-end acceptance。
  - 包含：一个真实用户从登录到 sandbox、provider、harness、usage、quota、
    admin inspection 和 secret leakage review 的完整路径。
  - 对应任务：P12.01-P12.16。

## 如何使用这份清单

这份文档是 Remote Codex 侧的日常任务看板。推荐执行方式是一次只拿一个
checkbox，或者一个非常紧密的小组，完成后立刻验证、勾选、提交。

每个 checkbox 的标准流程：

1. 先读该项的 `Done when`，确认真正要交付的行为。
2. 再读 `Verify with`，确认需要本地测试、CI、staging smoke，还是外部服务证据。
3. 只改 Remote Codex 侧需要改的代码、配置、部署 wiring 或文档。
4. 跑对应验证；如果是 AWS、Railway、gateway、ElAgenteHarness、provider
   runtime 或 billing 相关任务，必须拿到真实环境证据。
5. 验证通过后，把对应 `[ ]` 改成 `[x]`。
6. 在 commit message、`docs/status.md` 或对应 release/staging 文档里记录证据。
7. 提交这一小步，避免把未来任务一起批量勾掉。

任务类型判断：

- 本地代码任务：本仓库测试、typecheck、local smoke 通过后可以勾选。
- CI 任务：workflow 已存在且至少有一次对应 CI run 通过后可以勾选。
- Staging 任务：真实 staging 环境 smoke 通过后才能勾选。
- AWS/runtime 任务：真实 EKS/Fargate、ECR、S3、CloudWatch 或 Kubernetes evidence
  存在后才能勾选。
- 外部集成任务：只在 Remote Codex 侧 contract、client、fixture、mock、env
  wiring、UI 或 usage importer 完成时勾选；外部服务内部实现不在本仓库勾选。
- 生产 readiness 任务：必须有生产或准生产部署、回滚、监控、secret rotation
  或 release gate 证据，不能只靠本地测试。

## 勾选规则

- 只有代码、测试、部署配置、smoke evidence 或明确的架构文档已经落到本
  branch 后，才可以把 `[ ]` 改成 `[x]`。
- 涉及 AWS、Railway、gateway、ElAgenteHarness、provider runtime、billing
  或 production readiness 的任务，不能只靠 mock 或本地测试勾选。
- 每次勾选都要能回答三件事：改了哪些文件、怎么验证、还剩什么风险。
- 不要把真实 provider root key、gateway token、`INACT_X_APP_KEY`、product
  JWT、worker internal token 写入日志、前端存储、API response、route token、
  smoke output 或文档。
- 如果任务实际应该在 LLM gateway、ElAgenteHarness 或 compute worker 仓库完
  成，本仓库只勾选“Remote Codex 侧 contract/client/wiring 已完成”的任务。

建议每次勾选时在 commit message 或相关状态文档中留下：

```text
Task:
- <exact checkbox text>

Evidence:
- Files: <main files changed>
- Verification: <commands, smoke output, deploy record, or docs review>
- Residual risk: <remaining unchecked risk>
```

## 单任务执行协议

每个 checkbox 都按同一个流程推进，避免“写了代码但没有证据”或“勾了未来任务”：

```markdown
- [ ] Scope: 明确本任务会改哪些 package、API route、UI route、worker behavior、
      runtime config、deployment wiring 或 docs。
- [ ] Contract: 如果涉及 gateway、ElAgenteHarness、AWS、router、provider runtime
      或 billing，先固定输入、输出、错误格式、身份边界和 secret 边界。
- [ ] Implement: 完成最小可用切片，不把无关 refactor 混进同一次提交。
- [ ] Tests: 增加或更新 unit、API、frontend、worker、policy、contract 或 importer tests。
- [ ] Smoke: 跑本任务指定 smoke；真实环境任务必须保留 staging/deploy evidence。
- [ ] Secret review: 确认 raw key、gateway token、`INACT_X_APP_KEY`、product JWT、
      worker token 不进入日志、响应、artifact、browser state、route token 或 docs。
- [ ] Docs/status: 如果影响架构、release gate、staging 状态或当前 focus，同步
      `docs/status.md`、`docs/staging-release-readiness.md` 或相关架构文档。
- [ ] Checklist: 只勾选已经满足完成标准且有证据的 checkbox。
- [ ] Commit: 提交实现、测试和 checklist/evidence 引用。
```

本地实现任务可以用本仓库测试、typecheck、local smoke 或 docs review 作为证据。
真实 AWS、Railway、gateway、provider runtime、ElAgenteHarness、billing、production
readiness 任务必须用真实目标环境证据，不能用 synthetic JSON 或本地 mock 勾选。

## Remote Codex 侧交付边界

本仓库需要完成：

- Web 产品入口：login、project/workspace/session UI、billing/usage/admin UI。
- Control Plane API：auth、users、projects、workspaces、sessions、sandbox
  registry、route token、quota、usage、audit、admin API。
- Sandbox lifecycle：每个用户一个 active sandbox，启动/停止/观察 AWS runtime。
- Sandbox Router 集成：浏览器经 route token 进入 router，router 再转发到 worker。
- Worker-mode supervisor：sandbox 内的 API、workspace、shell、file/diff、
  artifact、provider runtime、MCP、checkpoint sync。
- Worker image bootstrap：Codex、Claude Code、OpenCode、MCP、gateway config、
  harness env/config 都在镜像或启动流程里准备好。
- LLM Gateway 集成：创建 scoped key、渲染 provider config、导入 usage、做 quota。
- ElAgenteHarness 集成：生成 scoped `INACT_X_APP_KEY`、注入 worker、暴露 workflow
  和 task/job/artifact 能力、导入 usage。
- Deployment/ops：Railway、AWS EKS Fargate、ECR、S3/object storage、secrets、
  logs、metrics、alerts、CI smoke。

本仓库不需要完成：

- LLM gateway 内部模型路由和真实 provider root-key 管理。
- ElAgenteHarness 的 workflow 执行内部逻辑。
- Modal、AWS Batch、Slurm、ORCA 或其它重计算 worker 内部实现。
- sandbox 外执行用户命令。
- 直接把 provider root key、harness admin key 或 gateway admin key 暴露给 sandbox
  内 agent。

## 当前目标架构

```text
Browser
  -> Railway Frontend
  -> Railway Control Plane API
     - auth / users
     - projects / workspaces / sessions
     - billing / quota / usage
     - sandbox registry
     - route-token issuance
     - gateway and harness credential mapping

Browser
  -> Sandbox Router
     - validates route tokens
     - resolves sandbox endpoint
     - injects worker token and signed identity envelope
     - proxies HTTP / SSE / WebSocket

Control Plane API
  -> AWS Sandbox Manager
     - wraps EKS / Kubernetes operations
     - creates / deletes worker Pods
     - injects non-root worker env and scoped credentials
     - manages worker endpoint registration
     - triggers snapshots when persistence is enabled

AWS EKS Fargate
  -> one user = one active sandbox = one Pod = one container
     - remote-codex supervisor-api in worker mode
     - Codex / Claude Code / OpenCode
     - /workspace with multiple project directories
     - multiple sessions per project directory
     - approved MCP servers and tool configs
     - ElAgenteHarness client config

Worker
  -> LLM Gateway
     - gateway-scoped token only
     - real provider root keys stay outside sandbox

Worker
  -> ElAgenteHarness
     - ELAGENTE_HARNESS_BASE_URL
     - scoped INACT_X_APP_KEY
     - workflow / task / job / artifact APIs
```

## Phase 0: 文档和产品边界

目标：所有人都能看懂 Remote Codex 负责什么，不负责什么，以及当前阶段怎么
验收。

- [x] P0.01 写清 Remote Codex 的 ownership boundary。
  - Done when: 文档说明前端、control plane、router、worker supervisor、worker
    image bootstrap、gateway/harness contract 属于本仓库；LLM gateway 内部、
    ElAgenteHarness workflow 内部和 compute worker 不属于本仓库。
  - Verify with: `docs/agente-product-architecture.md` 和
    `docs/remote-codex-side-detailed-checklist.md` review。

- [x] P0.02 记录当前部署方向。
  - Done when: 文档明确 frontend/control-plane 初期在 Railway，sandbox runtime
    在 AWS EKS Fargate，gateway 可用 sub2api/sub2api-like 服务，harness 独立
    Railway 服务，重计算走 Modal/AWS Batch/HPC 等 job pool。
  - Verify with: architecture docs review。

- [x] P0.03 建立英文权威 evidence checklist。
  - Done when: Phase 0-12 的英文 checkbox、Done when、Verify with 和证据规则
    已存在。
  - Verify with: `docs/remote-codex-side-detailed-checklist.md`。

- [x] P0.04 建立中文产品化任务清单。
  - Done when: 本文件存在，并且覆盖 Remote Codex 侧需要实现的主要任务。
  - Verify with: docs review and `git diff --check`。

- [x] P0.05 保持 docs index 清晰。
  - Done when: `docs/README.md` 明确推荐从产品架构、当前状态、英文 evidence
    checklist、中文产品任务清单开始阅读。
  - Verify with: docs review。

## Phase 1: 登录、用户和管理边界

目标：用户能安全进入产品，product identity 只在 control plane 生效，不变成
sandbox 或 worker credential。

- [x] P1.01 保留本地开发 auth。
  - Done when: 本地 dev bearer auth 能创建/识别开发用户。
  - Verify with: control-plane auth tests。

- [x] P1.02 支持 production-style JWT 校验。
  - Done when: issuer、audience、expiry、not-before、issued-at、clock skew 都被
    校验。
  - Verify with: `pnpm smoke:production-auth`。

- [x] P1.03 实现用户 bootstrap 和 account status。
  - Done when: 重复认证请求映射到同一个用户；用户有 active/disabled 等状态。
  - Verify with: control-plane API/repository tests。

- [x] P1.04 实现 `GET /api/me` 和基本 profile API。
  - Done when: 用户能读取自己的 profile，敏感字段不外泄。
  - Verify with: API tests。

- [x] P1.05 实现 admin user management API。
  - Done when: admin 可以 list/update 用户状态和 quota profile；非 admin 被拒绝。
  - Verify with: admin API tests。

- [x] P1.06 前端加入 login/register/logout/auth guard。
  - Done when: 未登录、loading、已登录、session expired、disabled account 都有稳
    定 UI。
  - Verify with: supervisor-web tests。

- [x] P1.07 前端加入 admin 用户管理界面。
  - Done when: admin 能查看用户、状态、quota profile；非 admin 路径被拒绝。
  - Verify with: frontend tests。

- [ ] P1.08 接入真实产品 auth provider 的 staging 配置。
  - Done when: Railway staging 中配置真实 issuer/audience/JWKS，浏览器登录能获
    得 control-plane 接受的 token。
  - Verify with: staging browser login smoke。

## Phase 2: Projects、Workspaces、Sessions

目标：control plane 管 durable metadata，worker 管 live runtime state。一个用
户一个 sandbox，sandbox 内可以有多个 workspace/project directory，每个
workspace/project directory 内可以有多个 session。

- [x] P2.01 实现 project 数据模型和 CRUD API。
  - Done when: project 有 owner、name、status、timestamps 和 archive/delete 语义。
  - Verify with: migration/repository/API ownership tests。

- [x] P2.02 实现 workspace 数据模型和 API。
  - Done when: workspace 归属 project/user，支持 create/list/update/archive。
  - Verify with: ownership tests。

- [x] P2.03 实现 session 数据模型和 API。
  - Done when: session 归属 workspace/user，记录 worker session id、status 和
    last activity。
  - Verify with: session API tests。

- [x] P2.04 实现 project/workspace/session 前端流。
  - Done when: 用户能创建 project、进入 workspace、创建 session、看到 loading、
    empty 和 error state。
  - Verify with: frontend tests。

- [x] P2.05 实现 open session 时的 route token 获取。
  - Done when: 前端只把 route token 放在内存，不写入 localStorage、sessionStorage、
    IndexedDB、URL 或日志。
  - Verify with: frontend tests and code review。

- [x] P2.06 实现 worker checkpoint sync。
  - Done when: worker 能回写 durable session status、workerSessionId 和
    lastActivityAt。
  - Verify with: `pnpm smoke:local-worker-checkpoint`。

- [x] P2.07 实现 session close/resume。
  - Done when: close 会请求 worker finalize/disconnect 并更新 durable session；
    resume 能恢复或返回清晰 unavailable 状态。
  - Verify with: API/worker/frontend tests。

- [ ] P2.08 明确 sandbox 内多 workspace 的目录规范。
  - Done when: 文档和 worker API 明确 `/workspace/<workspace-id>` 或等价目录规范，
    session 只能访问其 workspace root。
  - Verify with: worker path tests and docs review。

## Phase 3: Sandbox Lifecycle 和 AWS Runtime

目标：control plane 能为每个用户启动、停止、观察一个专属 sandbox。Phase 1
先采用 EKS Fargate Pod，一 sandbox 一 Pod，一 Pod 一 container。

- [x] P3.01 保持 `SandboxManager` 接口稳定。
  - Done when: create/start/stop/restart/delete/status/endpoint/env preparation
    都藏在接口后面。
  - Verify with: control-plane typecheck and adapter tests。

- [x] P3.02 保留本地 sandbox adapter。
  - Done when: 本地可用 no-op adapter 和 local worker-process adapter。
  - Verify with: adapter tests and local smoke。

- [x] P3.03 实现 AWS/EKS adapter 的本地可测试骨架。
  - Done when: adapter 能生成 Pod spec、labels、env、endpoint discovery，并映射
    capacity/image-pull/readiness failure。
  - Verify with: mocked adapter tests。

- [ ] P3.04 确定 AWS staging 基础配置。
  - Done when: account、region、EKS cluster、namespace、Fargate profile、VPC、
    subnets、security groups、IAM roles、ECR image registry、CloudWatch log group
    都有记录。
  - Verify with:
    `pnpm verify:aws-staging-preflight-evidence -- <evidence-json>`。

- [ ] P3.05 配好最小权限 Kubernetes/RBAC credentials。
  - Done when: control plane 只能 create/inspect/delete 自己管理的 worker Pods 和
    相关资源。
  - Verify with: `kubectl auth can-i` evidence and AWS preflight verifier。

- [ ] P3.06 从 control plane 创建真实 worker Pod。
  - Done when: staging API start sandbox 后，EKS Fargate 启动 immutable image tag
    的 worker Pod，`/readyz` 通过。
  - Verify with: staging lifecycle smoke。

- [ ] P3.07 从 control plane 停止真实 worker Pod。
  - Done when: stop 后 registry 变为 stopped，Pod 终止。
  - Verify with: staging lifecycle smoke。

- [ ] P3.08 验证 start/stop/restart 幂等。
  - Done when: 重复 start/stop/restart 不会产生重复 active sandbox 或破坏 registry。
  - Verify with: staging idempotent lifecycle smoke。

- [x] P3.09 实现 runtime event log。
  - Done when: lifecycle transition、readiness failure、capacity failure、admin
    action 等可审计且不含 secret。
  - Verify with: API tests。

- [x] P3.10 实现 idle warning、idle stop 和 admin force-stop。
  - Done when: 用户可看到 idle warning；系统可按策略 stop；admin force-stop 有原
    因和操作者审计。
  - Verify with: job/API/frontend tests。

## Phase 4: Worker Image 和 Runtime Guardrails

目标：sandbox 用预构建镜像启动，不在每个 sandbox 里现场安装 Codex、Claude
Code、OpenCode 等依赖；worker 启动时 fail closed。

- [x] P4.01 以 `Dockerfile.worker` 作为 canonical worker image。
  - Done when: clean checkout 能构建 worker image。
  - Verify with: `docker build -f Dockerfile.worker -t remote-codex-worker:verify .`。

- [x] P4.02 固定或明确管理 runtime dependencies。
  - Done when: Node、pnpm、Codex、Claude Code、OpenCode、SDK 和系统包版本有可
    审计策略。
  - Verify with: image manifest/build logs review。

- [x] P4.03 worker 以非 root 用户运行。
  - Done when: runtime user 是 `agent`，workspace 是 `/workspace`，provider homes
    在 `/home/agent`。
  - Verify with: container smoke and image inspection。

- [x] P4.04 worker mode 校验身份和 filesystem roots。
  - Done when: 缺少 sandbox id/user id/worker token/runtime role 或 root 配置不安全
    时拒绝启动。
  - Verify with: supervisor-api startup tests。

- [x] P4.05 worker metadata 只暴露非敏感 runtime 信息。
  - Done when: image/runtime/provider config status 可诊断，但不包含 token。
  - Verify with: metadata/redaction tests。

- [x] P4.06 worker image CI build and smoke。
  - Done when: CI 构建 image，启动 container，检查 `/readyz`，验证 auth denial 和
    auth success。
  - Verify with: passing GitHub Actions run。

- [ ] P4.07 配置 worker image 发布到 ECR。
  - Done when: CI/CD 能用 immutable tag push worker image 到 staging/production
    ECR。
  - Verify with: ECR publish logs and image digest。

## Phase 5: Sandbox Router、Route Token 和 Worker Authorization

目标：浏览器不能直连裸 worker；所有 worker traffic 都通过 router、短期 route
token 和 router-injected worker identity。

- [x] P5.01 定义 route-token payload schema。
  - Done when: token 包含 user/sandbox/project/workspace/session/scopes/expiry/
    nonce 或 token id/signing key id。
  - Verify with: schema tests。

- [x] P5.02 实现 route-token 签发、校验和 key rotation。
  - Done when: expiry、tampering、wrong sandbox、wrong scope、previous key 都有测
    试。
  - Verify with: control-plane/router tests。

- [x] P5.03 token 签发前检查账号、sandbox、session 和 quota。
  - Done when: disabled user、stopped sandbox、archived session、wrong owner、
    over quota 不能拿到 route token。
  - Verify with: API tests。

- [x] P5.04 router 支持 HTTP、SSE、WebSocket proxy。
  - Done when: 三种 traffic mode 都通过 route-token 校验后转发。
  - Verify with: router tests and local smoke。

- [x] P5.05 router 注入 internal worker token 和 signed identity envelope。
  - Done when: browser-supplied identity headers 被剥离，worker 收到 router 注入
    的 token/envelope。
  - Verify with: router and worker tests。

- [x] P5.06 worker 对非 health API 校验 worker token 和 identity envelope。
  - Done when: shell/file/provider/artifact/session API 拒绝 missing/expired/wrong
    scope envelope。
  - Verify with: worker scope tests。

- [ ] P5.07 在 staging 部署 sandbox-router。
  - Done when: staging browser 能访问 router health，router 能解析 live sandbox
    endpoint。
  - Verify with: staging smoke recording `router_health`。

- [ ] P5.08 证明 direct worker access 被拒绝。
  - Done when: 直连 worker public endpoint 不带 router-injected token 返回 401/403。
  - Verify with: staging direct-worker-denial smoke。

- [ ] P5.09 证明 browser-to-router-to-worker 全链路可用。
  - Done when: 真实 browser 用 control-plane route token 通过 router 访问真实
    worker，且 browser Authorization 被剥离。
  - Verify with: staging browser smoke。

## Phase 6: LLM Gateway 和 Provider Bootstrap

目标：Codex、Claude Code、OpenCode 在 sandbox 内直接可用，但只拿到
gateway-scoped token，不拿真实 provider root key。

- [x] P6.01 固化 LLM gateway contract。
  - Done when: base URL、admin auth、user/key provisioning、usage export、failure
    response shape 都有文档和 fixture。
  - Verify with: gateway contract docs and tests。

- [x] P6.02 实现 gateway admin client。
  - Done when: control plane 可 create user/key、rotate、revoke、reconcile key
    status。
  - Verify with: mocked gateway client tests。

- [x] P6.03 在 user/sandbox provisioning 时创建 gateway credential。
  - Done when: worker start 前已有 scoped gateway credential。
  - Verify with: provisioning tests。

- [x] P6.04 安全存储 gateway key metadata。
  - Done when: 只存 external key id、user/sandbox/provider/model scopes/status/
    timestamps；只有确实需要恢复 raw token 时才加密存储 ciphertext。
  - Verify with: schema/repository/redaction tests。

- [x] P6.05 渲染 Codex gateway config。
  - Done when: Codex 使用 gateway base URL 和 scoped token，不使用 provider root
    key。
  - Verify with: provider bootstrap tests。

- [x] P6.06 渲染 Claude Code gateway config。
  - Done when: Claude Code 使用 gateway base URL 和 scoped token。
  - Verify with: provider bootstrap tests。

- [x] P6.07 渲染 OpenCode gateway config。
  - Done when: OpenCode 使用 gateway base URL 和 scoped token。
  - Verify with: provider bootstrap tests。

- [x] P6.08 实现 gateway degraded API/UI state。
  - Done when: provisioning 或 usage import 失败返回稳定错误，前端展示非敏感降级
    状态。
  - Verify with: API/frontend tests。

- [x] P6.09 实现 gateway usage import 和 LLM quota preflight。
  - Done when: gateway events 能映射到 usage ledger/summary，over-quota 用户可被
    阻止。
  - Verify with: import/quota/frontend tests。

- [ ] P6.10 部署或接入 staging LLM gateway。
  - Done when: staging gateway 有 admin account，control plane 能签发用户 scoped
    key，能查询 usage。
  - Verify with: gateway staging admin smoke。

- [ ] P6.11 Codex staging gateway smoke。
  - Done when: 真实 worker 内 Codex 通过 gateway 发出一次 model request；worker
    env/config 中没有 provider root key。
  - Verify with: provider smoke plus gateway usage record。

- [ ] P6.12 Claude Code staging gateway smoke。
  - Done when: 真实 worker 内 Claude Code 通过 gateway 发出一次 model request；无
    root key。
  - Verify with: provider smoke plus gateway usage record。

- [ ] P6.13 OpenCode staging gateway smoke。
  - Done when: 真实 worker 内 OpenCode 通过 gateway 发出一次 model request；无
    root key。
  - Verify with: provider smoke plus gateway usage record。

## Phase 7: ElAgenteHarness Integration

目标：sandbox agent 能用 scoped `INACT_X_APP_KEY` 调用 ElAgenteHarness，获取
workflow skill、更新任务状态、提交复杂计算 job，但不持有 harness admin key。

- [ ] P7.01 固化 Remote Codex 到 ElAgenteHarness 的 admin contract。
  - Done when: base URL、admin credential、key create/rotate/revoke、workflow
    catalog、task list、artifact metadata、usage/event API 都有文档。
  - Verify with: contract docs and fixture tests。

- [ ] P7.02 实现 harness admin client。
  - Done when: control plane 能通过 admin credential 创建/轮换/撤销用户或 sandbox
    harness key。
  - Verify with: mocked harness client tests。

- [ ] P7.03 新增 harness credential schema。
  - Done when: user/sandbox harness credential 记录 key id/hash、scopes、status、
    timestamps、rotation fields 和 safe storage policy。
  - Verify with: migration/repository tests。

- [ ] P7.04 决定并记录 harness key 存储模型。
  - Done when: 文档说明只存 hash、加密存 raw key，还是 write-only metadata；以及
    为什么。
  - Verify with: architecture decision and redaction tests。

- [ ] P7.05 在用户或 sandbox provisioning 时生成 `INACT_X_APP_KEY`。
  - Done when: worker start 前已有 scoped harness key。
  - Verify with: provisioning tests。

- [ ] P7.06 将 harness key 绑定 user、sandbox、scopes 和 quota。
  - Done when: key 可按 user/sandbox revoke，scope 至少覆盖 workflow/task/job/
    artifact 的 launch 所需权限。
  - Verify with: ownership/scope/quota tests。

- [ ] P7.07 将 harness env 注入 worker。
  - Done when: worker 只收到 `ELAGENTE_HARNESS_BASE_URL` 和 scoped
    `INACT_X_APP_KEY`，不收到 harness admin key。
  - Verify with: worker env and redaction tests。

- [ ] P7.08 worker mode 校验 harness env。
  - Done when: chemistry integration enabled 时缺少 harness env 会 fail closed；
    disabled 时不会阻塞 worker 启动。
  - Verify with: startup config tests。

- [ ] P7.09 实现 harness key redaction。
  - Done when: `INACT_X_APP_KEY` 不出现在 logs、metadata、API responses、browser
    state、route token、identity envelope、smoke output。
  - Verify with: redaction tests and artifact secret scan。

- [ ] P7.10 决定 first harness tool surface。
  - Done when: 明确第一阶段用 MCP、shell wrapper、provider-native tool config，或
    组合方案，并记录 fallback。
  - Verify with: architecture decision。

- [ ] P7.11 渲染 harness MCP config 或 wrapper。
  - Done when: approved harness tools 在 sandbox 内可用，cwd/env/path 都受控。
  - Verify with: config rendering tests。

- [ ] P7.12 将 harness tools 暴露给 Codex/Claude Code/OpenCode。
  - Done when: 三种 provider runtime 能发现 approved harness tool surface。
  - Verify with: provider bootstrap tests。

- [ ] P7.13 增加 workflow catalog API/proxy。
  - Done when: 前端可通过 Remote Codex 安全路径列出 workflow，不直接暴露 admin
    credential。
  - Verify with: API tests for success/unavailable/auth denial。

- [ ] P7.14 增加 task/job/artifact API。
  - Done when: 用户能 list/inspect 自己的 task、job status、artifact metadata；跨
    用户访问被拒绝。
  - Verify with: API ownership tests。

- [ ] P7.15 增加 workflow/task/job/artifact UI。
  - Done when: 用户可浏览 workflow、查看任务和 job 状态、查看 chemistry artifact
    metadata/preview。
  - Verify with: frontend tests。

- [ ] P7.16 增加 harness usage import。
  - Done when: harness events 能映射 workflow/task/job/units/cost/currency/user/
    sandbox/project/workspace/session。
  - Verify with: webhook or polling importer tests。

- [ ] P7.17 跑 staging worker-to-harness smoke。
  - Done when: 真实 worker 用 injected `INACT_X_APP_KEY` 调 staging harness，并取
    得 authenticated response。
  - Verify with: staging smoke and no raw key exposure。

## Phase 8: MCP 和 Tool Policy

目标：agent 可用的工具都在 sandbox 内执行、可审计、不可挂载 host-local 资源，
也不能逃出 workspace。

- [ ] P8.01 定义 approved MCP server registry。
  - Done when: registry entry 包含 id、owner、command/remote origin、args、env、
    cwd、scopes、risk class、enabled state。
  - Verify with: schema tests。

- [ ] P8.02 定义 stdio MCP launch policy。
  - Done when: stdio MCP 只能在 sandbox 内启动，cwd 必须在 `/workspace` 或显式允
    许的 sandbox path 下。
  - Verify with: policy tests。

- [ ] P8.03 定义 remote MCP allowlist policy。
  - Done when: remote MCP endpoint 必须按 origin/scope allowlist。
  - Verify with: policy tests。

- [ ] P8.04 定义 MCP env allowlist。
  - Done when: MCP server 只接收显式 env，不继承完整 worker env。
  - Verify with: rendering tests。

- [ ] P8.05 阻止 MCP filesystem escape。
  - Done when: filesystem MCP 不能通过 path traversal 或 symlink 逃出 workspace。
  - Verify with: path validation tests。

- [ ] P8.06 默认阻止 Docker/host socket/SSH agent 等资源。
  - Done when: MCP config 不能暴露 Docker socket、host DB、host SSH agent 或其它
    runtime socket，除非未来有显式例外。
  - Verify with: policy tests。

- [ ] P8.07 为 Codex 渲染 MCP config。
  - Done when: Codex config 只引用 approved MCP servers。
  - Verify with: provider bootstrap tests。

- [ ] P8.08 为 Claude Code 渲染 MCP config。
  - Done when: Claude config 只引用 approved MCP servers。
  - Verify with: provider bootstrap tests。

- [ ] P8.09 为 OpenCode 渲染 MCP config。
  - Done when: OpenCode config 只引用 approved MCP servers。
  - Verify with: provider bootstrap tests。

- [ ] P8.10 将 ElAgenteHarness tools 加入 registry。
  - Done when: harness tools 有 scoped env、allowed commands/origins 和 audit
    metadata。
  - Verify with: registry tests。

- [ ] P8.11 增加 MCP startup 和 tool-call audit。
  - Done when: 启动成功/失败/禁用和 tool call success/failure 都有非敏感审计记录。
  - Verify with: audit tests。

- [ ] P8.12 增加 MCP status UI。
  - Done when: 用户能看到 enabled tools 和 failure state。
  - Verify with: frontend tests。

## Phase 9: Workspace Persistence、Files、Diffs、Artifacts

目标：sandbox 重启不丢有价值工作，用户能安全查看文件、diff 和 chemistry
artifacts。

- [ ] P9.01 选择 phase-one persistence backend。
  - Done when: EFS、S3 snapshots 或临时 MVP storage 的取舍和限制被记录。
  - Verify with: architecture decision。

- [ ] P9.02 定义 workspace/artifact/file/patch size limits。
  - Done when: 限制写入 config 并在 API/worker 侧执行。
  - Verify with: config and worker tests。

- [ ] P9.03 增加 snapshot metadata model。
  - Done when: snapshot 记录 user/sandbox/workspace/object path/size/status/error/
    timestamps。
  - Verify with: migration/repository tests。

- [ ] P9.04 worker ready 前 restore snapshot。
  - Done when: restore 完成或按策略失败前，workspace 不被标记 ready。
  - Verify with: lifecycle tests。

- [ ] P9.05 sandbox stop 前保存 snapshot。
  - Done when: controlled stop 时保存 workspace state。
  - Verify with: lifecycle tests。

- [ ] P9.06 增加 manual snapshot 和 status UI。
  - Done when: 用户/admin 可触发 snapshot 并查看 pending/complete/failed。
  - Verify with: API/frontend tests。

- [ ] P9.07 增加 snapshot retention job。
  - Done when: 旧 snapshot 根据策略保留或删除。
  - Verify with: job tests。

- [ ] P9.08 实现 scoped file read/write API。
  - Done when: 文件 API 不能逃出 `/workspace`，包括 traversal 和 symlink case。
  - Verify with: worker tests。

- [ ] P9.09 实现 changed-files 和 diff API。
  - Done when: worker 返回 changed files、text diffs、binary metadata，并执行 size
    limits。
  - Verify with: worker tests。

- [ ] P9.10 排除 generated credentials。
  - Done when: provider/gateway/harness/MCP credential files 不进入 diff、snapshot、
    download、UI preview，除非明确 safe。
  - Verify with: worker tests。

- [ ] P9.11 增加 diff review/apply UI。
  - Done when: 用户可查看 changed files，并把接受的变化应用回 durable project
    storage。
  - Verify with: frontend/API tests。

- [ ] P9.12 定义 artifact ownership 和 object-storage path。
  - Done when: artifact ownership、S3 prefix、retention、access rules 被记录。
  - Verify with: docs and schema tests。

- [ ] P9.13 实现 artifact upload/download path。
  - Done when: artifact 通过 signed URL 或 safe proxy path 上传/查看，并有 size
    limits。
  - Verify with: API/worker tests。

- [ ] P9.14 增加 chemistry artifact display hooks。
  - Done when: 前端能链接或预览支持的 chemistry artifact 类型。
  - Verify with: frontend fixture tests。

## Phase 10: Billing、Quota 和 Unified Usage

目标：Remote Codex 把 LLM、Harness、Compute、Storage、Sandbox runtime 的用
量归一到一个产品 ledger，用户看到统一计费。

- [ ] P10.01 完成 usage ledger schema。
  - Done when: ledger 支持 source、dedupe key、user/sandbox/project/workspace/
    session、units、cost、currency、timestamps、metadata。
  - Verify with: migration/repository tests。

- [ ] P10.02 增加 source-specific event mappers。
  - Done when: `llm`、`harness`、`compute`、`storage`、`sandbox_runtime` 都有明确归
    一化规则。
  - Verify with: mapper tests。

- [ ] P10.03 实现 idempotent import。
  - Done when: gateway/harness/compute duplicate events 不会重复计费。
  - Verify with: dedupe tests。

- [ ] P10.04 增加 usage summary API。
  - Done when: 用户/admin 可获取 current period totals 和 recent usage。
  - Verify with: API tests。

- [ ] P10.05 增加 quota profile schema/config。
  - Done when: quota 环境可配置，不硬编码在 route handler。
  - Verify with: config/repository tests。

- [ ] P10.06 增加统一 quota evaluation service。
  - Done when: LLM、harness、compute、storage、sandbox runtime 都能通过同一服务
    评估 quota。
  - Verify with: unit tests。

- [ ] P10.07 执行 LLM quota。
  - Done when: over-quota 用户在 route-token issuance 或 model use 前被阻止。
  - Verify with: API tests。

- [ ] P10.08 执行 harness/compute quota。
  - Done when: Remote Codex 可见的昂贵 harness/compute action 在超额前被阻止或警告。
  - Verify with: API/harness integration tests。

- [ ] P10.09 增加用户 billing dashboard。
  - Done when: 用户能看到 current-period total、remaining quota、source breakdown、
    recent usage。
  - Verify with: frontend tests。

- [ ] P10.10 增加 admin usage inspection。
  - Done when: admin 能按 user/source/period/status 查看 usage。
  - Verify with: API/frontend tests。

## Phase 11: Deployment、Operations 和 CI

目标：系统能支撑几百个用户、每用户一个 active sandbox，并且有清晰的部署和
回滚路径。

- [ ] P11.01 定义 Railway frontend deployment。
  - Done when: build command、start command、health check、domain、env vars 可复现。
  - Verify with: staging deploy logs。

- [ ] P11.02 定义 Railway control-plane deployment。
  - Done when: API deployment 有 build/start/health/database/auth/gateway/harness/
    route-token/AWS env 文档。
  - Verify with: staging deploy logs。

- [ ] P11.03 增加 DB migration runbook。
  - Done when: staging/production migration command、backup、rollback expectation
    被记录。
  - Verify with: staging migration dry run or deploy log。

- [ ] P11.04 增加 scheduled jobs 部署 wiring。
  - Done when: usage import、sandbox reaper、idle stop、snapshot retention、
    reconciliation jobs 有部署方式。
  - Verify with: staging job logs。

- [ ] P11.05 定义 ECR/image publishing pipeline。
  - Done when: worker image immutable tag、scan、push、digest record 都有流程。
  - Verify with: CI/deploy logs。

- [ ] P11.06 定义 EKS Fargate deployment config。
  - Done when: namespace、labels、Fargate profile、service discovery、ingress/private
    routing、security groups 都记录。
  - Verify with: staging cluster smoke。

- [ ] P11.07 定义 S3/object storage config。
  - Done when: bucket、prefix、encryption、lifecycle、access roles 被记录。
  - Verify with: staging storage smoke if enabled。

- [ ] P11.08 定义 secrets management 和 rotation。
  - Done when: route-token keys、worker-token material、gateway admin token、
    harness admin token、DB credentials、AWS credentials 都有 storage/rotation/
    emergency revoke 流程。
  - Verify with: runbook review and config validation。

- [ ] P11.09 增加 secret-safe structured logs。
  - Done when: control plane、router、worker 有 correlation id 和非敏感 structured
    logs。
  - Verify with: tests or staging log review。

- [ ] P11.10 增加 metrics、dashboards 和 alerts。
  - Done when: sandbox lifecycle、route-token issuance、worker connections、usage
    import、harness import、error rates 可观测；auth/gateway/AWS/image/DB/runaway
    usage/stuck sandbox 有 alert entry。
  - Verify with: staging operations review。

- [ ] P11.11 增加 CI typecheck/test jobs。
  - Done when: control-plane API、sandbox-router、supervisor-api、supervisor-web、
    config、shared、DB packages 在 CI 中运行必要检查。
  - Verify with: passing CI run。

- [ ] P11.12 增加 CI e2e/smoke jobs。
  - Done when: CI 覆盖 worker image build、`/readyz`、auth denial/success、
    route-token、gateway config rendering、harness env rendering、login-to-session
    open、本地 browser-to-router-to-worker。
  - Verify with: passing CI run。

## Phase 12: End-To-End Acceptance

目标：一个真实用户能从登录开始，完成 sandbox session、provider request、
chemistry workflow、usage/billing 可见和 admin inspection。

- [ ] P12.01 用户可在 staging 注册或登录。
  - Verify with: staging browser smoke。

- [ ] P12.02 用户只能获得一个 active sandbox。
  - Verify with: control-plane state and sandbox registry。

- [ ] P12.03 用户可创建 project、workspace、session。
  - Verify with: staging browser smoke。

- [ ] P12.04 用户可启动 sandbox。
  - Verify with: control-plane and AWS smoke。

- [ ] P12.05 用户可通过 router 打开 worker session。
  - Verify with: browser-to-router-to-worker smoke。

- [ ] P12.06 worker direct unauthenticated access 被拒绝。
  - Verify with: direct-worker-denial smoke。

- [ ] P12.07 Codex 通过 LLM gateway 可用。
  - Verify with: provider smoke and gateway usage event。

- [ ] P12.08 Claude Code 通过 LLM gateway 可用。
  - Verify with: provider smoke and gateway usage event。

- [ ] P12.09 OpenCode 通过 LLM gateway 可用。
  - Verify with: provider smoke and gateway usage event。

- [ ] P12.10 worker 可用 scoped `INACT_X_APP_KEY` 调 ElAgenteHarness。
  - Verify with: worker-to-harness smoke。

- [ ] P12.11 harness 可提交或模拟一个 chemistry workflow task。
  - Verify with: harness staging task smoke and Remote Codex task visibility。

- [ ] P12.12 LLM usage 出现在用户 billing summary。
  - Verify with: gateway usage import smoke。

- [ ] P12.13 harness/compute usage 出现在用户 billing summary。
  - Verify with: harness usage import or webhook smoke。

- [ ] P12.14 quota exceeded 状态能干净阻止后续 paid usage。
  - Verify with: API/frontend staging smoke。

- [ ] P12.15 admin 可查看 user、sandbox、usage、audit events。
  - Verify with: staging admin smoke。

- [ ] P12.16 staging smoke 中无 secret leakage。
  - Verify with: browser storage、API response、worker metadata、logs、smoke
    artifacts inspection。

## 推荐验证命令

```bash
pnpm --filter @remote-codex/control-plane-api typecheck
pnpm --filter @remote-codex/control-plane-api test
pnpm --filter @remote-codex/sandbox-router typecheck
pnpm --filter @remote-codex/sandbox-router test
pnpm --filter @remote-codex/supervisor-api typecheck
pnpm --filter @remote-codex/supervisor-api test
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-web test
pnpm --filter @remote-codex/config typecheck
pnpm --filter @remote-codex/db typecheck
pnpm smoke:local-worker-checkpoint
pnpm smoke:production-auth
pnpm smoke:provider-gateway -- <codex|claude|opencode>
pnpm smoke:staging-phase-one
pnpm collect:phase-zero-six-evidence -- --output-dir ./.temp/phase-zero-six-evidence/<run-id>
pnpm verify:phase-zero-six-evidence
pnpm test:phase-zero-six-evidence
docker build -f Dockerfile.worker -t remote-codex-worker:verify .
git diff --check
```

## 近期执行顺序

1. 完成 Phase 0-6 剩余 staging evidence：AWS/EKS lifecycle、router staging、
   provider runtime gateway smokes。
2. 做 Phase 7：ElAgenteHarness contract、credential provisioning、worker env
   injection、tool surface、workflow/task/artifact UI、harness usage import。
3. 做 Phase 8：MCP registry、tool policy、provider MCP rendering、audit 和 UI。
4. 做 Phase 9：workspace persistence、file/diff API、artifact storage/display。
5. 做 Phase 10：unified usage ledger、quota、billing UI、admin usage inspection。
6. 做 Phase 11：Railway/AWS deployment、secrets rotation、observability、CI。
7. 做 Phase 12：真实 staging end-to-end acceptance。
