# Remote Codex 侧执行任务 Checklist

这份文档是 Remote Codex 仓库内需要实现的详细任务板。它服务于当前
Agente 产品方向：Railway 上的 Web/control plane 负责用户、项目、计费和
sandbox 生命周期；AWS sandbox 中的 worker 运行 remote-codex supervisor、
Codex、Claude Code、OpenCode、MCP 和 ElAgenteHarness 工具。

本文只记录 Remote Codex 侧需要做的事。LLM gateway、ElAgenteHarness、
Modal/AWS Batch/HPC worker 等外部系统的内部实现不在这里勾选；Remote Codex
只勾选它自己的 contract、client、配置注入、UI、usage import 和 smoke。

## 使用方式

每个 checkbox 都是一个可独立推进的小任务。推进时按这个顺序执行：

1. 选择一个未完成任务。
2. 阅读该任务的 `完成标准` 和 `验证方式`。
3. 实现最小可交付改动。
4. 跑验证命令、staging smoke 或记录人工 evidence。
5. 把 `[ ]` 改成 `[x]`。
6. 在 commit message、`docs/status.md` 或相关 release 文档中记录 evidence。

勾选时需要能回答：

- 改了哪些文件。
- 用什么命令、smoke、部署记录或人工证据验证。
- 是否还有 staging、AWS、provider runtime、billing 或 secret 风险未覆盖。

不要用本地 mock 勾选真实 AWS、Railway、gateway、provider runtime、
ElAgenteHarness、billing 或 production readiness 任务。真实环境任务必须有真实
环境证据。

Evidence 建议格式：

```text
Task:
- <checkbox id and text>

Evidence:
- Files: <main files changed>
- Verification: <commands, smoke output, deploy record, or docs review>
- Residual risk: <remaining unchecked risk>
```

## 任务粒度和勾选规则

这份文档是 Remote Codex 侧的主执行任务板。原则上一个 checkbox 对应一次可以
独立 review、独立验证、独立提交的产品切片。切片可以很小，但必须闭环：有代码、
配置、测试、文档或真实环境 evidence，而不是只代表意向。

每次勾选前先确认：

- 这个任务确实属于 Remote Codex 仓库，而不是 LLM gateway、ElAgenteHarness、
  Modal/AWS Batch/HPC worker 或其它外部系统内部实现。
- `完成标准` 已满足；如果发现标准不够具体，先更新标准再实现。
- `验证方式` 已执行；真实 AWS、Railway、gateway、provider runtime、
  ElAgenteHarness、billing 或 production readiness 项不能用本地 mock 代替。
- secret 没有出现在 logs、API response、browser state、smoke artifact、diff 或
  docs 中。
- 如果 release 状态、staging 状态或当前 focus 发生变化，同步更新
  `docs/status.md`、`docs/staging-release-readiness.md` 或相关 release 文档。

建议每个实现切片都在 commit/PR 描述中保留这个格式：

```text
Task:
- <checkbox id and text>

Remote Codex changes:
- <files, APIs, UI routes, worker behavior, config, or docs changed>

Evidence:
- <unit tests, typecheck, local smoke, staging smoke, deploy log, or manual review>

Still unchecked:
- <AWS/staging/provider/billing/secret risk that remains open>
```

不要提前勾选未来任务。如果一个实现自然证明多个 checkbox，可以一次勾多个，但
commit/PR 里需要分别写清每个 checkbox 的 evidence。

## 任务总览

| Phase | 主题 | Remote Codex 侧交付物 | 勾选所需证据 |
| --- | --- | --- | --- |
| A | 文档、边界和状态管理 | 当前架构、owner boundary、status、release gate、阅读入口 | docs review、`git diff --check` |
| B | Auth、Users 和 Admin | 登录/注册、JWT 校验、user bootstrap、account status、admin API/UI | API/frontend tests、staging login smoke |
| C | Projects、Workspaces 和 Sessions | durable metadata、session route token、worker checkpoint、close/resume | API/frontend/worker tests、local worker smoke |
| D | Sandbox Lifecycle 和 AWS Runtime | SandboxManager、local adapter、EKS adapter、lifecycle、idle/admin stop | adapter tests、真实 AWS/EKS staging smoke |
| E | Worker Image 和 Runtime Guardrails | 预构建 worker image、非 root runtime、启动校验、redaction、CI image smoke | image build、container smoke、worker tests |
| F | Sandbox Router 和 Worker Authorization | route token、router proxy、worker token、identity envelope、direct denial | router/worker tests、真实 staging router smoke |
| G | LLM Gateway 和 Provider Bootstrap | gateway contract/client、scoped key、Codex/Claude/OpenCode config、usage import | contract tests、真实 provider runtime smoke |
| H | ElAgenteHarness Integration | harness admin client、`INACT_X_APP_KEY`、tool surface、task/job/artifact UI | contract/worker/frontend tests、staging harness smoke |
| I | MCP 和 Tool Policy | approved MCP registry、stdio/remote policy、env/path containment、audit/UI | policy/rendering/worker/frontend tests |
| J | Workspace Persistence、Files、Diffs 和 Artifacts | snapshot、safe file/diff API、artifact storage/display、credential exclusion | DB/API/worker/frontend tests、storage smoke |
| K | Billing、Quota 和 Unified Usage | usage ledger、source mappers、idempotent import、quota、billing/admin UI | mapper/API/job/frontend tests、usage import smoke |
| L | Deployment、Operations 和 CI | Railway/AWS/ECR/S3/secrets/logging/metrics/alerts/CI | deploy logs、CI run、ops review |
| M | End-To-End Acceptance | 一个真实用户完整路径：login、sandbox、provider、harness、usage、admin | staging browser/API/provider/harness smokes |

## 单任务执行模板

开始任意 checkbox 前，可以复制下面的临时执行模板到 issue、PR 或本地 notes。
任务完成后只把主 checkbox 改成 `[x]`；模板本身不需要提交到文档里。

```markdown
- [ ] Scope: 明确本任务会改哪些 package、API、UI、worker behavior、config 或 docs。
- [ ] Contract: 如果涉及 gateway/harness/AWS/router/provider，先确认输入、输出、错误和 secret 边界。
- [ ] Implement: 完成最小可用切片，不带无关 refactor。
- [ ] Tests: 增加或更新 unit/API/frontend/worker/policy tests。
- [ ] Smoke: 跑本任务指定 smoke；真实环境任务保留 staging/deploy evidence。
- [ ] Secret review: 确认 raw key/token/JWT 不进入日志、响应、artifact、browser state 或 docs。
- [ ] Docs/status: 如影响架构、release gate 或当前状态，同步文档。
- [ ] Checklist: 更新本文件对应 checkbox。
- [ ] Commit: 提交实现、测试和 checklist/evidence 引用。
```

## 当前目标架构

```text
Browser
  -> Railway Remote Codex Web
  -> Railway Control Plane API
     - auth / users / admin
     - projects / workspaces / sessions
     - sandbox registry / lifecycle
     - route-token issuance
     - quota / billing / usage
     - gateway and harness credential mapping

Browser
  -> Sandbox Router
     - validates short-lived route token
     - resolves sandbox endpoint
     - injects worker token and identity envelope
     - proxies HTTP / SSE / WebSocket

Control Plane API
  -> AWS Sandbox Manager
     - wraps EKS/Kubernetes APIs
     - creates/deletes one worker Pod per active user sandbox
     - injects scoped runtime env
     - manages worker routes and snapshots

AWS EKS Fargate
  -> Sandbox Worker Pod
     - remote-codex supervisor API in worker mode
     - /workspace with multiple project/workspace directories
     - Codex / Claude Code / OpenCode
     - approved MCP tool surface
     - ElAgenteHarness client env/config

Worker
  -> LLM Gateway
     - scoped gateway token only
     - no provider root key in sandbox

Worker
  -> ElAgenteHarness
     - scoped INACT_X_APP_KEY
     - workflow/task/job/artifact APIs
```

## Remote Codex 交付边界

Remote Codex 需要负责：

- 产品 Web：login、project/workspace/session、chat/timeline、files/diff、
  artifacts、usage/billing、admin。
- Control Plane API：auth、users、projects、workspaces、sessions、sandbox
  registry、route tokens、quota、usage、audit、admin API。
- Sandbox lifecycle：一个 user 对应一个 active sandbox，启动、停止、观察和
  恢复 AWS worker Pod。
- Sandbox Router 集成：浏览器只通过 router 到 worker，不能直连裸 worker。
- Worker supervisor：sandbox 内的 workspace、shell、session、file/diff、
  artifact、MCP、provider runtime 和 checkpoint sync。
- Worker image bootstrap：预装并配置 Codex、Claude Code、OpenCode、MCP、
  gateway config 和 harness env。
- LLM Gateway 集成：provision scoped key、渲染 provider config、导入 usage、
  执行 quota。
- ElAgenteHarness 集成：生成并注入 scoped `INACT_X_APP_KEY`，暴露 workflow、
  task、job、artifact 能力，导入 usage。
- Deployment/ops：Railway、AWS EKS Fargate、ECR、S3/object storage、secrets、
  logs、metrics、alerts、CI smoke。

Remote Codex 不负责：

- LLM gateway 内部模型路由和 provider root key 管理。
- ElAgenteHarness workflow 执行内部逻辑。
- Modal、AWS Batch、Slurm、ORCA 或其它 heavy compute worker 内部实现。
- sandbox 外执行用户命令。
- 把 provider root key、gateway admin key 或 harness admin key 暴露给 sandbox。

## Phase A: 文档、边界和状态管理

目标：任何人能从 docs 理解项目形态、当前状态、剩余风险和任务推进规则。

- [ ] A01 清理 docs 入口和阅读顺序。
  - 完成标准：`docs/README.md` 只保留当前产品方向相关文档入口，并明确推荐阅读顺序。
  - 验证方式：docs review and `git diff --check`。

- [ ] A02 保持产品架构文档最新。
  - 完成标准：架构文档描述 Railway Web/control plane、AWS sandbox worker、
    sandbox router、LLM gateway、ElAgenteHarness、job pool 和统一 usage/billing。
  - 验证方式：docs review。

- [ ] A03 保持 Remote Codex ownership boundary 最新。
  - 完成标准：文档清楚说明哪些任务在本仓库实现，哪些只做 integration contract。
  - 验证方式：docs review。

- [ ] A04 维护当前状态 handoff。
  - 完成标准：`docs/status.md` 记录已实现能力、in progress、blocked/risk 和下一步。
  - 验证方式：每次较大阶段变更前 review。

- [ ] A05 维护 staging/release gate。
  - 完成标准：staging readiness 和 release gates 明确哪些任务必须真实环境验证。
  - 验证方式：release docs review。

## Phase B: Auth、Users 和 Admin

目标：用户身份只在 control plane 生效，worker/sandbox 永远不信任浏览器身份。

- [ ] B01 接入最终产品 auth provider。
  - 完成标准：Railway staging 配置 issuer、audience、JWKS、callback/logout URL。
  - 验证方式：staging browser login smoke。

- [ ] B02 完成 production JWT verifier。
  - 完成标准：校验 issuer、audience、expiry、not-before、issued-at、clock skew。
  - 验证方式：`pnpm smoke:production-auth`。

- [ ] B03 实现用户 bootstrap。
  - 完成标准：第一次登录幂等创建 user；重复登录映射到同一 user。
  - 验证方式：control-plane API/repository tests。

- [ ] B04 实现 account status。
  - 完成标准：active、disabled/suspended 等状态会影响登录后能力、route token、
    sandbox start 和 usage import。
  - 验证方式：API tests and frontend tests。

- [ ] B05 实现 user profile API。
  - 完成标准：`GET /api/me`、`PATCH /api/me` 返回非敏感字段。
  - 验证方式：API tests。

- [ ] B06 实现 admin user management。
  - 完成标准：admin 可以 list/update user status、quota profile；非 admin 被拒绝。
  - 验证方式：admin API tests。

- [ ] B07 实现前端 login/register/logout/auth guard。
  - 完成标准：覆盖未登录、loading、已登录、session expired、disabled account。
  - 验证方式：supervisor-web tests and staging browser smoke。

- [ ] B08 证明 product JWT 不进入 worker。
  - 完成标准：router 剥离 browser Authorization，worker 只看到 router-injected identity。
  - 验证方式：router/worker tests and staging R5 evidence。

## Phase C: Projects、Workspaces 和 Sessions

目标：control plane 管 durable metadata，worker 管 live runtime state；一个 user
一个 sandbox，sandbox 内有多个 workspace/project directory，每个 workspace
可有多个 session。

- [ ] C01 完成 project 数据模型。
  - 完成标准：project 有 owner、name、status、timestamps、archive/delete 语义。
  - 验证方式：migration/repository/API ownership tests。

- [ ] C02 完成 workspace 数据模型。
  - 完成标准：workspace 归属 project/user，支持 create/list/update/archive。
  - 验证方式：migration/repository/API ownership tests。

- [ ] C03 完成 session 数据模型。
  - 完成标准：session 归属 workspace/user，记录 worker session id、status、
    last activity 和 close/resume 状态。
  - 验证方式：session API tests。

- [ ] C04 实现 project/workspace/session API。
  - 完成标准：CRUD、分页、搜索/filter、跨用户拒绝、archive/delete 语义都覆盖。
  - 验证方式：control-plane API tests。

- [ ] C05 实现 project/workspace/session 前端。
  - 完成标准：用户能创建 project、进入 workspace、创建 session，并看到 loading、
    empty、error state。
  - 验证方式：frontend tests。

- [ ] C06 实现 open session route-token flow。
  - 完成标准：前端打开 session 时获取短期 route token，token 只存在内存中。
  - 验证方式：frontend tests and code review。

- [ ] C07 实现 worker checkpoint sync。
  - 完成标准：worker 回写 durable session status、workerSessionId、lastActivityAt。
  - 验证方式：`pnpm smoke:local-worker-checkpoint`。

- [ ] C08 明确 sandbox 内 workspace 目录规范。
  - 完成标准：文档和 worker API 明确 `/workspace/<workspace-id>` 或等价路径规范。
  - 验证方式：worker path tests and docs review。

## Phase D: Sandbox Lifecycle 和 AWS Runtime

目标：control plane 能为每个用户启动、停止、观察一个专属 sandbox；第一阶段
采用 EKS Fargate Pod，一 sandbox 一 Pod，一 Pod 一 container。

- [ ] D01 稳定 `SandboxManager` 接口。
  - 完成标准：create/start/stop/restart/delete/status/endpoint/env preparation
    都隐藏在接口后。
  - 验证方式：typecheck and adapter tests。

- [ ] D02 保留 local sandbox adapter。
  - 完成标准：本地可用 no-op 或 local worker-process adapter 进行开发。
  - 验证方式：adapter tests and local smoke。

- [ ] D03 实现 AWS/EKS adapter。
  - 完成标准：能生成 Pod spec、labels、env、resource requests、readiness、endpoint
    discovery，并映射 capacity/image-pull/readiness failure。
  - 验证方式：mocked adapter tests。

- [ ] D04 确定 AWS staging 基础配置。
  - 完成标准：account、region、cluster、namespace、Fargate profile、VPC、subnets、
    security groups、IAM roles、ECR、CloudWatch log group 都有 evidence。
  - 验证方式：`pnpm verify:aws-staging-preflight-evidence -- <evidence-json>`。

- [ ] D05 配置最小权限 Kubernetes/RBAC credentials。
  - 完成标准：control plane 只能 create/inspect/delete 自己 namespace/label 下的
    worker Pods 和必要资源。
  - 验证方式：`kubectl auth can-i` evidence and AWS preflight verifier。

- [ ] D06 从 control plane 创建真实 worker Pod。
  - 完成标准：staging API start sandbox 后，EKS Fargate 启动 immutable image tag 的
    worker Pod，`/readyz` 通过。
  - 验证方式：staging lifecycle smoke。

- [ ] D07 从 control plane 停止真实 worker Pod。
  - 完成标准：stop 后 registry 为 stopped，Pod 终止。
  - 验证方式：staging lifecycle smoke。

- [ ] D08 验证 lifecycle 幂等。
  - 完成标准：重复 start/stop/restart 不产生重复 active sandbox，不破坏 registry。
  - 验证方式：staging idempotent lifecycle smoke。

- [ ] D09 实现 lifecycle event log。
  - 完成标准：start/stop/restart/readiness/capacity/admin action 都有非敏感审计。
  - 验证方式：API tests。

- [ ] D10 实现 idle warning、idle stop 和 admin force-stop。
  - 完成标准：用户可见 idle warning；系统可按策略 stop；admin force-stop 有原因。
  - 验证方式：job/API/frontend tests。

## Phase E: Worker Image 和 Runtime Guardrails

目标：sandbox 用预构建镜像启动，不在每个 sandbox 中现场安装 agent 依赖；
worker 启动时 fail closed。

- [ ] E01 维护 canonical worker image。
  - 完成标准：`Dockerfile.worker` 能从 clean checkout 构建 worker image。
  - 验证方式：`docker build -f Dockerfile.worker -t remote-codex-worker:verify .`。

- [ ] E02 固定 runtime dependencies。
  - 完成标准：Node、pnpm、Codex、Claude Code、OpenCode、SDK、系统包版本有可审计策略。
  - 验证方式：image manifest/build logs review。

- [ ] E03 worker 以非 root 用户运行。
  - 完成标准：runtime user 是 `agent` 或等价非 root 用户；workspace 是 `/workspace`。
  - 验证方式：container smoke and image inspection。

- [ ] E04 worker 启动校验身份和 roots。
  - 完成标准：缺少 sandbox id、user id、worker token、runtime role 或 root 配置不安全时拒绝启动。
  - 验证方式：supervisor-api startup tests。

- [ ] E05 worker metadata 不泄露 secret。
  - 完成标准：metadata 可诊断 image/runtime/provider config status，但不含 token/key。
  - 验证方式：metadata/redaction tests。

- [ ] E06 CI 构建并 smoke worker image。
  - 完成标准：CI build image，启动 container，检查 `/readyz`、auth denial、auth success。
  - 验证方式：passing CI run。

- [ ] E07 发布 worker image 到 ECR。
  - 完成标准：CI/CD 使用 immutable tag push 到 staging/production ECR，并记录 digest。
  - 验证方式：ECR publish logs and image digest。

## Phase F: Sandbox Router 和 Worker Authorization

目标：浏览器不能直连裸 worker；所有 worker traffic 都通过短期 route token、
router proxy 和 router-injected worker identity。

- [ ] F01 定义 route-token schema。
  - 完成标准：token 包含 user、sandbox、project、workspace、session、scopes、
    expiry、nonce/token id、signing key id。
  - 验证方式：schema tests。

- [ ] F02 实现 route-token 签发和校验。
  - 完成标准：expiry、tampering、wrong sandbox、wrong scope、previous signing key
    都有测试。
  - 验证方式：control-plane/router tests。

- [ ] F03 token 签发前检查账号、sandbox、session 和 quota。
  - 完成标准：disabled user、stopped sandbox、archived session、wrong owner、
    over quota 都不能拿 token。
  - 验证方式：API tests。

- [ ] F04 router 支持 HTTP、SSE 和 WebSocket。
  - 完成标准：三种 traffic mode 都通过 route-token 校验后转发。
  - 验证方式：router tests and local smoke。

- [ ] F05 router 注入 worker token 和 identity envelope。
  - 完成标准：browser-supplied identity headers 被剥离，worker 收到 router 注入的
    token/envelope。
  - 验证方式：router and worker tests。

- [ ] F06 worker 校验 worker token 和 identity envelope。
  - 完成标准：shell、file、provider、artifact、session API 拒绝 missing/expired/
    wrong scope envelope。
  - 验证方式：worker scope tests。

- [ ] F07 staging 部署 sandbox-router。
  - 完成标准：staging router health 通过，router 能解析 live sandbox endpoint。
  - 验证方式：staging smoke recording `router_health`。

- [ ] F08 证明 direct worker access 被拒绝。
  - 完成标准：直连 worker public endpoint 不带 router-injected token 返回 401/403；
    如果 worker 无公网 endpoint，则有 reviewed private ingress evidence。
  - 验证方式：staging direct-worker-denial smoke。

- [ ] F09 证明 browser-to-router-to-worker 全链路可用。
  - 完成标准：真实 browser 用 route token 通过 router 访问真实 worker，且 browser
    Authorization 被剥离。
  - 验证方式：staging browser smoke。

## Phase G: LLM Gateway 和 Provider Bootstrap

目标：Codex、Claude Code、OpenCode 在 sandbox 内直接可用，但只拿 gateway-scoped
token，不拿真实 provider root key。

- [ ] G01 固化 LLM gateway contract。
  - 完成标准：base URL、admin auth、user/key provisioning、usage export、failure
    shape 都有文档和 fixtures。
  - 验证方式：contract docs and tests。

- [ ] G02 实现 gateway admin client。
  - 完成标准：control plane 可 create user/key、rotate、revoke、reconcile key status。
  - 验证方式：mocked gateway client tests。

- [ ] G03 sandbox provisioning 时创建 gateway credential。
  - 完成标准：worker start 前已有 scoped gateway credential。
  - 验证方式：provisioning tests。

- [ ] G04 安全存储 gateway key metadata。
  - 完成标准：只存 external key id、scopes、status、timestamps；raw token 只有确实
    需要恢复时才加密存储。
  - 验证方式：schema/repository/redaction tests。

- [ ] G05 渲染 Codex gateway config。
  - 完成标准：Codex 使用 gateway base URL 和 scoped token，不使用 provider root key。
  - 验证方式：provider bootstrap tests。

- [ ] G06 渲染 Claude Code gateway config。
  - 完成标准：Claude Code 使用 gateway base URL 和 scoped token。
  - 验证方式：provider bootstrap tests。

- [ ] G07 渲染 OpenCode gateway config。
  - 完成标准：OpenCode 使用 gateway base URL 和 scoped token。
  - 验证方式：provider bootstrap tests。

- [ ] G08 实现 gateway degraded API/UI state。
  - 完成标准：provisioning 或 usage import 失败返回稳定错误，前端展示非敏感降级状态。
  - 验证方式：API/frontend tests。

- [ ] G09 实现 gateway usage import。
  - 完成标准：gateway events 映射到 usage ledger/summary，重复事件不重复计费。
  - 验证方式：import/quota/frontend tests。

- [ ] G10 接入 staging LLM gateway。
  - 完成标准：staging gateway 有 admin account，control plane 能签发 scoped key 并查询 usage。
  - 验证方式：gateway staging admin smoke。

- [ ] G11 Codex staging gateway smoke。
  - 完成标准：真实 worker 内 Codex 通过 gateway 发出一次 model request；无 root key 泄露。
  - 验证方式：provider smoke plus gateway usage record。

- [ ] G12 Claude Code staging gateway smoke。
  - 完成标准：真实 worker 内 Claude Code 通过 gateway 发出一次 model request；无 root key 泄露。
  - 验证方式：provider smoke plus gateway usage record。

- [ ] G13 OpenCode staging gateway smoke。
  - 完成标准：真实 worker 内 OpenCode 通过 gateway 发出一次 model request；无 root key 泄露。
  - 验证方式：provider smoke plus gateway usage record。

## Phase H: ElAgenteHarness Integration

目标：sandbox agent 能用 scoped `INACT_X_APP_KEY` 调用 ElAgenteHarness，获取
workflow skill、更新任务状态、提交复杂计算 job，但不持有 harness admin key。

- [ ] H01 固化 harness admin contract。
  - 完成标准：base URL、admin credential、key create/rotate/revoke、workflow
    catalog、task list、artifact metadata、usage/event API 都有文档。
  - 验证方式：contract docs and fixture tests。

- [ ] H02 实现 harness admin client。
  - 完成标准：control plane 能创建、轮换、撤销 user/sandbox scoped harness key。
  - 验证方式：mocked harness client tests。

- [ ] H03 新增 harness credential schema。
  - 完成标准：记录 key id/hash、user、sandbox、scopes、status、timestamps、rotation fields。
  - 验证方式：migration/repository tests。

- [ ] H04 决定 harness key 存储模型。
  - 完成标准：明确只存 hash、加密存 raw key，还是 write-only metadata，并记录原因。
  - 验证方式：architecture decision and redaction tests。

- [ ] H05 provisioning 时生成 `INACT_X_APP_KEY`。
  - 完成标准：worker start 前已有 scoped harness key。
  - 验证方式：provisioning tests。

- [ ] H06 将 harness env 注入 worker。
  - 完成标准：worker 只收到 `ELAGENTE_HARNESS_BASE_URL` 和 scoped `INACT_X_APP_KEY`。
  - 验证方式：worker env and redaction tests。

- [ ] H07 worker mode 校验 harness env。
  - 完成标准：chemistry integration enabled 时缺少 harness env fail closed；disabled 时不阻塞。
  - 验证方式：startup config tests。

- [ ] H08 实现 harness key redaction。
  - 完成标准：`INACT_X_APP_KEY` 不出现在 logs、metadata、API responses、browser
    state、route token、identity envelope、smoke output。
  - 验证方式：redaction tests and artifact secret scan。

- [ ] H09 决定 first harness tool surface。
  - 完成标准：明确第一阶段用 MCP、shell wrapper、provider-native tool config 或组合方案。
  - 验证方式：architecture decision。

- [ ] H10 渲染 harness MCP config 或 wrapper。
  - 完成标准：approved harness tools 在 sandbox 内可用，cwd/env/path 受控。
  - 验证方式：config rendering tests。

- [ ] H11 将 harness tools 暴露给 Codex/Claude Code/OpenCode。
  - 完成标准：三种 provider runtime 能发现 approved harness tool surface。
  - 验证方式：provider bootstrap tests。

- [ ] H12 增加 workflow catalog API/proxy。
  - 完成标准：前端可安全列出 workflow，不暴露 admin credential。
  - 验证方式：API tests。

- [ ] H13 增加 task/job/artifact API。
  - 完成标准：用户能 list/inspect 自己的 task、job status、artifact metadata；跨用户拒绝。
  - 验证方式：API ownership tests。

- [ ] H14 增加 workflow/task/job/artifact UI。
  - 完成标准：用户可浏览 workflow、查看任务和 job 状态、查看 chemistry artifact metadata/preview。
  - 验证方式：frontend tests。

- [ ] H15 增加 harness usage import。
  - 完成标准：harness events 映射到 usage ledger，包括 workflow/task/job/units/cost/user/session。
  - 验证方式：webhook or polling importer tests。

- [ ] H16 跑 staging worker-to-harness smoke。
  - 完成标准：真实 worker 用 injected `INACT_X_APP_KEY` 调 staging harness 并取得 authenticated response。
  - 验证方式：staging smoke and no raw key exposure。

## Phase I: MCP 和 Tool Policy

目标：agent 可用工具都在 sandbox 内执行、可审计、不可挂载 host-local 资源，
也不能逃出 workspace。

- [ ] I01 定义 approved MCP server registry。
  - 完成标准：entry 包含 id、owner、command/remote origin、args、env、cwd、scopes、
    risk class、enabled state。
  - 验证方式：schema tests。

- [ ] I02 定义 stdio MCP launch policy。
  - 完成标准：stdio MCP 只能在 sandbox 内启动，cwd 必须在 `/workspace` 或显式允许路径下。
  - 验证方式：policy tests。

- [ ] I03 定义 remote MCP allowlist policy。
  - 完成标准：remote MCP endpoint 必须按 origin/scope allowlist。
  - 验证方式：policy tests。

- [ ] I04 定义 MCP env allowlist。
  - 完成标准：MCP server 只接收显式 env，不继承完整 worker env。
  - 验证方式：rendering tests。

- [ ] I05 阻止 MCP filesystem escape。
  - 完成标准：filesystem MCP 不能通过 path traversal 或 symlink 逃出 workspace。
  - 验证方式：path validation tests。

- [ ] I06 默认阻止 Docker/host socket/SSH agent 等资源。
  - 完成标准：MCP config 不暴露 Docker socket、host DB、host SSH agent 或 runtime socket。
  - 验证方式：policy tests。

- [ ] I07 为 Codex 渲染 MCP config。
  - 完成标准：Codex config 只引用 approved MCP servers。
  - 验证方式：provider bootstrap tests。

- [ ] I08 为 Claude Code 渲染 MCP config。
  - 完成标准：Claude config 只引用 approved MCP servers。
  - 验证方式：provider bootstrap tests。

- [ ] I09 为 OpenCode 渲染 MCP config。
  - 完成标准：OpenCode config 只引用 approved MCP servers。
  - 验证方式：provider bootstrap tests。

- [ ] I10 将 ElAgenteHarness tools 加入 registry。
  - 完成标准：harness tools 有 scoped env、allowed commands/origins 和 audit metadata。
  - 验证方式：registry tests。

- [ ] I11 增加 MCP startup 和 tool-call audit。
  - 完成标准：启动成功/失败/禁用和 tool call success/failure 都有非敏感审计记录。
  - 验证方式：audit tests。

- [ ] I12 增加 MCP status UI。
  - 完成标准：用户能看到 enabled tools 和 failure state。
  - 验证方式：frontend tests。

## Phase J: Workspace Persistence、Files、Diffs 和 Artifacts

目标：sandbox 重启不丢有价值工作；用户能安全查看文件、diff 和 chemistry artifacts。

- [ ] J01 选择 phase-one persistence backend。
  - 完成标准：EFS、S3 snapshots 或临时 MVP storage 的取舍和限制被记录。
  - 验证方式：architecture decision。

- [ ] J02 定义 workspace/artifact/file/patch size limits。
  - 完成标准：限制写入 config 并在 API/worker 执行。
  - 验证方式：config and worker tests。

- [ ] J03 增加 snapshot metadata model。
  - 完成标准：snapshot 记录 user、sandbox、workspace、object path、size、status、error、timestamps。
  - 验证方式：migration/repository tests。

- [ ] J04 worker ready 前 restore snapshot。
  - 完成标准：restore 完成或按策略失败前，workspace 不标记 ready。
  - 验证方式：lifecycle tests。

- [ ] J05 sandbox stop 前保存 snapshot。
  - 完成标准：controlled stop 时保存 workspace state。
  - 验证方式：lifecycle tests。

- [ ] J06 增加 manual snapshot 和 status UI。
  - 完成标准：用户/admin 可触发 snapshot 并查看 pending/complete/failed。
  - 验证方式：API/frontend tests。

- [ ] J07 增加 snapshot retention job。
  - 完成标准：旧 snapshot 根据策略保留或删除。
  - 验证方式：job tests。

- [ ] J08 实现 scoped file read/write API。
  - 完成标准：文件 API 不能逃出 `/workspace`，包括 traversal 和 symlink case。
  - 验证方式：worker tests。

- [ ] J09 实现 changed-files 和 diff API。
  - 完成标准：worker 返回 changed files、text diffs、binary metadata，并执行 size limits。
  - 验证方式：worker tests。

- [ ] J10 排除 generated credentials。
  - 完成标准：provider/gateway/harness/MCP credential files 不进入 diff、snapshot、
    download、UI preview，除非明确 safe。
  - 验证方式：worker tests。

- [ ] J11 增加 diff review/apply UI。
  - 完成标准：用户可查看 changed files，并把接受的变化应用回 durable project storage。
  - 验证方式：frontend/API tests。

- [ ] J12 定义 artifact ownership 和 object-storage path。
  - 完成标准：artifact ownership、S3 prefix、retention、access rules 被记录。
  - 验证方式：docs and schema tests。

- [ ] J13 实现 artifact upload/download path。
  - 完成标准：artifact 通过 signed URL 或 safe proxy path 上传/查看，并有 size limits。
  - 验证方式：API/worker tests。

- [ ] J14 增加 chemistry artifact display hooks。
  - 完成标准：前端能链接或预览支持的 chemistry artifact 类型。
  - 验证方式：frontend fixture tests。

## Phase K: Billing、Quota 和 Unified Usage

目标：Remote Codex 把 LLM、Harness、Compute、Storage、Sandbox runtime 用量归一
到一个产品 ledger，用户看到统一计费。

- [ ] K01 完成 usage ledger schema。
  - 完成标准：ledger 支持 source、dedupe key、user/sandbox/project/workspace/session、
    units、cost、currency、timestamps、metadata。
  - 验证方式：migration/repository tests。

- [ ] K02 增加 source-specific event mappers。
  - 完成标准：`llm`、`harness`、`compute`、`storage`、`sandbox_runtime` 都有归一化规则。
  - 验证方式：mapper tests。

- [ ] K03 实现 idempotent import。
  - 完成标准：gateway/harness/compute duplicate events 不重复计费。
  - 验证方式：dedupe tests。

- [ ] K04 增加 usage summary API。
  - 完成标准：用户/admin 可获取 current period totals 和 recent usage。
  - 验证方式：API tests。

- [ ] K05 增加 quota profile schema/config。
  - 完成标准：quota 环境可配置，不硬编码在 route handler。
  - 验证方式：config/repository tests。

- [ ] K06 增加统一 quota evaluation service。
  - 完成标准：LLM、harness、compute、storage、sandbox runtime 都能通过同一服务评估 quota。
  - 验证方式：unit tests。

- [ ] K07 执行 LLM quota。
  - 完成标准：over-quota 用户在 route-token issuance 或 model use 前被阻止。
  - 验证方式：API tests。

- [ ] K08 执行 harness/compute quota。
  - 完成标准：昂贵 harness/compute action 在超额前被阻止或警告。
  - 验证方式：API/harness integration tests。

- [ ] K09 增加用户 billing dashboard。
  - 完成标准：用户能看到 current-period total、remaining quota、source breakdown、recent usage。
  - 验证方式：frontend tests。

- [ ] K10 增加 admin usage inspection。
  - 完成标准：admin 能按 user/source/period/status 查看 usage。
  - 验证方式：API/frontend tests。

## Phase L: Deployment、Operations 和 CI

目标：系统能支撑几百个用户、每用户一个 active sandbox，并且有清晰部署、回滚、
监控和 secret rotation 路径。

- [ ] L01 定义 Railway frontend deployment。
  - 完成标准：build command、start command、health check、domain、env vars 可复现。
  - 验证方式：staging deploy logs。

- [ ] L02 定义 Railway control-plane deployment。
  - 完成标准：API deployment 有 build/start/health/database/auth/gateway/harness/
    route-token/AWS env 文档。
  - 验证方式：staging deploy logs。

- [ ] L03 增加 DB migration runbook。
  - 完成标准：staging/production migration command、backup、rollback expectation 被记录。
  - 验证方式：staging migration dry run or deploy log。

- [ ] L04 增加 scheduled jobs 部署 wiring。
  - 完成标准：usage import、sandbox reaper、idle stop、snapshot retention、
    reconciliation jobs 有部署方式。
  - 验证方式：staging job logs。

- [ ] L05 定义 ECR/image publishing pipeline。
  - 完成标准：worker image immutable tag、scan、push、digest record 都有流程。
  - 验证方式：CI/deploy logs。

- [ ] L06 定义 EKS Fargate deployment config。
  - 完成标准：namespace、labels、Fargate profile、service discovery、ingress/private
    routing、security groups 都记录。
  - 验证方式：staging cluster smoke。

- [ ] L07 定义 S3/object storage config。
  - 完成标准：bucket、prefix、encryption、lifecycle、access roles 被记录。
  - 验证方式：staging storage smoke if enabled。

- [ ] L08 定义 secrets management 和 rotation。
  - 完成标准：route-token keys、worker-token material、gateway admin token、
    harness admin token、DB credentials、AWS credentials 都有 storage/rotation/
    emergency revoke 流程。
  - 验证方式：runbook review and config validation。

- [ ] L09 增加 secret-safe structured logs。
  - 完成标准：control plane、router、worker 有 correlation id 和非敏感 structured logs。
  - 验证方式：tests or staging log review。

- [ ] L10 增加 metrics、dashboards 和 alerts。
  - 完成标准：sandbox lifecycle、route-token、worker connections、usage import、
    harness import、error rates 可观测；auth/gateway/AWS/image/DB/runaway usage/
    stuck sandbox 有 alert。
  - 验证方式：staging operations review。

- [ ] L11 增加 CI typecheck/test jobs。
  - 完成标准：control-plane API、sandbox-router、supervisor-api、supervisor-web、
    config、shared、DB packages 在 CI 中运行必要检查。
  - 验证方式：passing CI run。

- [ ] L12 增加 CI e2e/smoke jobs。
  - 完成标准：CI 覆盖 worker image build、`/readyz`、auth denial/success、
    route-token、gateway config rendering、harness env rendering、login-to-session、
    local browser-to-router-to-worker。
  - 验证方式：passing CI run。

## Phase M: End-To-End Acceptance

目标：一个真实用户能从登录开始，完成 sandbox session、provider request、
chemistry workflow、usage/billing 可见和 admin inspection。

- [ ] M01 用户可在 staging 注册或登录。
  - 验证方式：staging browser smoke。

- [ ] M02 用户只能获得一个 active sandbox。
  - 验证方式：control-plane state and sandbox registry。

- [ ] M03 用户可创建 project、workspace、session。
  - 验证方式：staging browser smoke。

- [ ] M04 用户可启动 sandbox。
  - 验证方式：control-plane and AWS smoke。

- [ ] M05 用户可通过 router 打开 worker session。
  - 验证方式：browser-to-router-to-worker smoke。

- [ ] M06 worker direct unauthenticated access 被拒绝。
  - 验证方式：direct-worker-denial smoke。

- [ ] M07 Codex 通过 LLM gateway 可用。
  - 验证方式：provider smoke and gateway usage event。

- [ ] M08 Claude Code 通过 LLM gateway 可用。
  - 验证方式：provider smoke and gateway usage event。

- [ ] M09 OpenCode 通过 LLM gateway 可用。
  - 验证方式：provider smoke and gateway usage event。

- [ ] M10 worker 可用 scoped `INACT_X_APP_KEY` 调 ElAgenteHarness。
  - 验证方式：worker-to-harness smoke。

- [ ] M11 harness 可提交或模拟一个 chemistry workflow task。
  - 验证方式：harness staging task smoke and Remote Codex task visibility。

- [ ] M12 LLM usage 出现在用户 billing summary。
  - 验证方式：gateway usage import smoke。

- [ ] M13 harness/compute usage 出现在用户 billing summary。
  - 验证方式：harness usage import or webhook smoke。

- [ ] M14 quota exceeded 状态能干净阻止后续 paid usage。
  - 验证方式：API/frontend staging smoke。

- [ ] M15 admin 可查看 user、sandbox、usage、audit events。
  - 验证方式：staging admin smoke。

- [ ] M16 staging smoke 中无 secret leakage。
  - 验证方式：browser storage、API response、worker metadata、logs、smoke artifacts inspection。

## 推荐验证命令

本地代码任务优先使用：

```bash
pnpm typecheck
pnpm test
pnpm --filter @remote-codex/control-plane-api typecheck
pnpm --filter @remote-codex/control-plane-api test
pnpm --filter @remote-codex/sandbox-router typecheck
pnpm --filter @remote-codex/sandbox-router test
pnpm --filter @remote-codex/supervisor-api typecheck
pnpm --filter @remote-codex/supervisor-api test
pnpm --filter @remote-codex/supervisor-web typecheck
pnpm --filter @remote-codex/supervisor-web test
pnpm smoke:local-worker-checkpoint
pnpm smoke:production-auth
docker build -f Dockerfile.worker -t remote-codex-worker:verify .
git diff --check
```

Phase 0-6 staging evidence 使用：

```bash
pnpm verify:phase-zero-six-env-ready
pnpm collect:phase-zero-six-evidence -- --output-dir ./.temp/phase-zero-six-evidence/<run-id>
pnpm verify:phase-zero-six-evidence
pnpm test:phase-zero-six-evidence
```

真实 staging/AWS/provider runtime 任务需要保留 smoke output、deploy logs 或
evidence JSON。不要把 raw token、provider key、gateway admin token、
`INACT_X_APP_KEY`、product JWT 或 worker internal token 写入这些 artifacts。

## 建议执行顺序

1. 先补齐 Phase 0-6 剩余真实 staging evidence：AWS/EKS lifecycle、router
   staging、Codex/Claude Code/OpenCode gateway smokes。
2. 再做 Phase H：ElAgenteHarness contract、credential provisioning、worker env、
   tool surface、workflow/task/artifact UI 和 harness usage import。
3. 做 Phase I：MCP registry、tool policy、provider MCP rendering、audit 和 UI。
4. 做 Phase J：workspace persistence、safe file/diff API、artifact storage/display。
5. 做 Phase K：unified usage ledger、quota、billing UI、admin usage inspection。
6. 做 Phase L：Railway/AWS deployment、secrets rotation、observability、CI。
7. 最后做 Phase M：真实 staging end-to-end acceptance。
