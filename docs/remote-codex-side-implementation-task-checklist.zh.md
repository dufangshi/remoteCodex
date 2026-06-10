# Remote Codex 侧实施任务详细 Checklist

这份文档是 Remote Codex 仓库内后续工程实施的细粒度任务板。它只跟踪
Remote Codex 侧需要落地的代码、配置、部署 wiring、测试、smoke 和文档。

它不跟踪 LLM gateway、ElAgenteHarness、Modal/AWS Batch/HPC worker、ORCA
worker 等外部系统的内部实现。外部系统只在 Remote Codex 需要接 contract、
client、credential provisioning、env injection、UI、usage importer、smoke 或
release gate 时出现在这里。

## 使用规则

- 每个 checkbox 都应该可以独立完成、验证、勾选和提交。
- 如果实际做某项时发现仍然太大，先在本文件里拆成更小 checkbox，再开始写代码。
- 只有满足 `完成标准` 且跑过 `验证方式` 后，才能把 `[ ]` 改成 `[x]`。
- 涉及 AWS、Railway、gateway、ElAgenteHarness、provider runtime、billing 或
  production readiness 的 checkbox，必须用真实环境证据，不能用本地 mock 或
  synthetic JSON 勾选。
- Phase 0-6 的英文自动 evidence 清单仍然是
  `docs/remote-codex-side-detailed-checklist.md`。如果本文件任务对应英文清单，
  还要等 verifier 报告 ready 后再勾英文清单。
- 不要把 raw provider key、gateway admin token、gateway scoped token、
  `INACT_X_APP_KEY`、product JWT、worker internal token 写入 git、日志、API
  response、browser storage、smoke artifact 或 route token。

每次完成一个 checkbox，建议提交信息包含：

```text
Task:
- <checkbox id and title>

Evidence:
- Files: <changed files>
- Verify: <commands, CI run, staging smoke, deploy log, or manual review>
- Risk: <remaining unchecked risk>
```

## 当前优先级

先按这个顺序推进，不要从后面的长期任务随机挑：

- [ ] `RC-PRIO-01` 补齐 Phase 0-6 剩余真实 staging evidence。
  - 完成标准：AWS/EKS lifecycle、sandbox-router staging、direct-worker denial、
    browser-to-router-to-worker、Codex/Claude Code/OpenCode gateway runtime smoke
    都有真实证据。
  - 验证方式：`pnpm phase-zero-six:audit:report` 不再列出 Phase 0-6 missing
    item，且相关 artifact 不含 secret。

- [ ] `RC-PRIO-02` 做 ElAgenteHarness 最小可用集成。
  - 完成标准：control plane 能生成 scoped `INACT_X_APP_KEY`，worker 能带这个 key
    调 harness，前端能看 workflow/task/artifact 基础状态。
  - 验证方式：本地 contract tests、worker config tests、staging
    worker-to-harness smoke。

- [ ] `RC-PRIO-03` 做 MCP 和 tool policy。
  - 完成标准：Codex、Claude Code、OpenCode 只能加载 approved MCP/tool，stdio MCP
    只能在 sandbox 内启动，路径不能逃出 `/workspace`。
  - 验证方式：policy tests、provider bootstrap tests、worker path escape tests。

- [ ] `RC-PRIO-04` 做 workspace persistence、file/diff/artifact 安全路径。
  - 完成标准：sandbox 重启不丢关键 workspace state，文件和 diff API 不能读写
    workspace 外内容，credential files 被排除。
  - 验证方式：worker tests、snapshot lifecycle tests、artifact UI/API tests。

- [ ] `RC-PRIO-05` 做 unified usage、quota 和 billing/admin UI。
  - 完成标准：LLM、harness、compute、storage、sandbox runtime 进入统一 ledger，
    quota 能阻止 route token、agent request 或 job launch。
  - 验证方式：importer tests、quota tests、frontend/admin tests。

## A. Control Plane 基础能力

目标：Railway 上的 Control Plane API 负责用户、项目、sandbox registry、route
token、credential provisioning、usage、quota 和 audit。它不执行用户命令，也不
运行 agent runtime。

- [ ] `RC-CP-001` 明确 control plane runtime mode。
  - 完成标准：配置项能区分 local dev、staging、production；每种 mode 的 auth、
    sandbox adapter、gateway、harness、DB、secret source 都有默认策略。
  - 验证方式：config tests，`docs/status.md` 或 architecture docs review。

- [ ] `RC-CP-002` 固化 user model。
  - 完成标准：user 记录包含 id、email/provider subject、display name、status、
    role、quota profile、created/updated timestamps。
  - 验证方式：migration/repository tests。

- [ ] `RC-CP-003` 固化 account status 行为。
  - 完成标准：disabled/suspended/over-quota 用户不能启动 sandbox、拿 route token、
    创建 provider request 或提交 harness job。
  - 验证方式：API tests for denial paths。

- [ ] `RC-CP-004` 固化 admin 权限边界。
  - 完成标准：admin API 和普通用户 API 分开；非 admin token 访问 admin route
    返回 403；admin actions 进入 audit log。
  - 验证方式：admin API tests、audit tests。

- [ ] `RC-CP-005` 接入真实产品 auth provider。
  - 完成标准：staging Railway 配置 issuer、audience、JWKS、clock skew；浏览器登录
    后 control plane 接受 JWT。
  - 验证方式：staging browser login smoke。

- [ ] `RC-CP-006` 实现 project API。
  - 完成标准：用户能 create/list/read/update/archive project；跨用户访问被拒绝。
  - 验证方式：API ownership tests。

- [ ] `RC-CP-007` 实现 workspace API。
  - 完成标准：workspace 归属 project/user；记录 sandbox 内 workspace path；
    archive/delete 有明确语义。
  - 验证方式：repository/API tests。

- [ ] `RC-CP-008` 实现 session API。
  - 完成标准：session 归属 workspace/user；记录 provider、worker session id、
    status、last activity、checkpoint state。
  - 验证方式：session API tests。

- [ ] `RC-CP-009` 实现 sandbox registry。
  - 完成标准：每个 user 固定最多一个 active sandbox；registry 记录 sandbox id、
    user id、state、image tag、resource profile、endpoint、worker token hash、
    created/started/stopped timestamps。
  - 验证方式：repository tests、lifecycle API tests。

- [ ] `RC-CP-010` 实现 audit event 模型。
  - 完成标准：auth、admin、sandbox lifecycle、route-token、gateway provisioning、
    harness provisioning、usage import、quota denial 都能写非敏感 audit。
  - 验证方式：audit repository/API tests。

## B. Sandbox Lifecycle 和 AWS EKS Fargate

目标：第一阶段一个 user 绑定一个 sandbox；一个 active sandbox 是一个 EKS
Fargate Pod；Pod 内单容器运行 remote-codex worker/supervisor。

- [ ] `RC-SB-001` 固化 `SandboxManager` 接口。
  - 完成标准：start、stop、restart、status、delete、endpoint discovery、
    env preparation 都在接口后面。
  - 验证方式：typecheck、adapter contract tests。

- [ ] `RC-SB-002` 保留 local sandbox adapter。
  - 完成标准：本地开发可不依赖 AWS 启动 control plane/router/worker smoke。
  - 验证方式：local control-plane-worker smoke。

- [ ] `RC-SB-003` 实现 AWS adapter Pod spec rendering。
  - 完成标准：生成 namespace、labels、annotations、service account、image tag、
    resources、ports、env、readiness/liveness probes。
  - 验证方式：snapshot/unit tests。

- [ ] `RC-SB-004` 配置 AWS staging 基础资源。
  - 完成标准：account、region、EKS cluster、namespace、Fargate profile、VPC、
    subnets、security groups、IAM roles、ECR、CloudWatch log group 有真实记录。
  - 验证方式：`pnpm verify:aws-staging-preflight-evidence -- <evidence-json>`。

- [ ] `RC-SB-005` 配置最小权限 Kubernetes/RBAC credentials。
  - 完成标准：control plane 只能操作 Remote Codex 管理的 namespace/resources；
    不能读写其它 namespace。
  - 验证方式：`kubectl auth can-i` evidence、AWS preflight verifier。

- [ ] `RC-SB-006` 创建真实 worker Pod。
  - 完成标准：staging API `start sandbox` 创建真实 EKS Fargate Pod，Pod 使用
    immutable worker image tag，worker `/readyz` 通过。
  - 验证方式：staging lifecycle smoke。

- [ ] `RC-SB-007` 停止真实 worker Pod。
  - 完成标准：staging API `stop sandbox` 后 registry 进入 stopped，Pod 被删除或
    终止，endpoint 不再可用。
  - 验证方式：staging lifecycle smoke。

- [ ] `RC-SB-008` 验证 lifecycle 幂等。
  - 完成标准：重复 start/stop/restart 不产生多个 active sandbox，不破坏 registry
    状态，不泄露 worker token。
  - 验证方式：staging idempotent lifecycle smoke。

- [ ] `RC-SB-009` 映射 AWS/runtime failure。
  - 完成标准：image pull、capacity、permission、readiness、timeout、crash loop
    映射为稳定 API error code 和用户可理解状态。
  - 验证方式：adapter tests、frontend error-state tests。

- [ ] `RC-SB-010` 实现 idle stop。
  - 完成标准：sandbox 无活动超过策略后自动停止；用户和 admin 都能看到原因；
    force-stop 有 audit。
  - 验证方式：job/API/frontend tests。

## C. Worker Image 和 Supervisor Runtime

目标：sandbox 用预构建镜像启动，不在每个 sandbox 内临时安装基础依赖。worker
启动后只管理 `/workspace`、agent runtime、MCP、shell、file/diff/artifact 和
provider state。

- [ ] `RC-WK-001` 固化 worker image 构建入口。
  - 完成标准：`Dockerfile.worker` 能从 clean checkout 构建 worker image。
  - 验证方式：`docker build -f Dockerfile.worker -t remote-codex-worker:verify .`。

- [ ] `RC-WK-002` 固定 runtime dependency 版本策略。
  - 完成标准：Node、pnpm、Codex、Claude Code、OpenCode、system packages、
    SDK 版本可审计；升级路径明确。
  - 验证方式：image manifest/build logs review。

- [ ] `RC-WK-003` worker 使用非 root 用户。
  - 完成标准：runtime user 是 `agent` 或等价非 root 用户；`HOME` 在 `/home/agent`；
    workspace root 是 `/workspace`。
  - 验证方式：container smoke、image inspection。

- [ ] `RC-WK-004` worker mode fail closed。
  - 完成标准：缺少 sandbox id、user id、worker auth token、workspace root、runtime
    role 或关键 credential 时，worker 拒绝进入 ready。
  - 验证方式：startup config tests。

- [ ] `RC-WK-005` worker metadata redaction。
  - 完成标准：metadata API 只返回 image tag、runtime mode、provider config status、
    workspace status 等非敏感信息。
  - 验证方式：metadata/redaction tests。

- [ ] `RC-WK-006` worker 支持多 workspace 目录。
  - 完成标准：每个 workspace 有 sandbox 内固定目录；session API 只能在对应
    workspace root 下操作。
  - 验证方式：path validation tests。

- [ ] `RC-WK-007` worker 支持多 session。
  - 完成标准：同一 workspace 下可有多个 session；session state、provider thread、
    shell/tmux state 不互相覆盖。
  - 验证方式：worker session tests。

- [ ] `RC-WK-008` worker checkpoint sync 到 control plane。
  - 完成标准：session status、worker session id、last activity、error state 可回写
    durable metadata。
  - 验证方式：local worker checkpoint smoke。

- [ ] `RC-WK-009` worker 日志和 timeline redaction。
  - 完成标准：provider token、gateway token、harness key、worker token、JWT 都会被
    redaction。
  - 验证方式：redaction tests、artifact secret scan。

- [ ] `RC-WK-010` worker image 发布到 ECR。
  - 完成标准：CI/CD 用 immutable tag push 到 staging/production ECR，并记录 digest。
  - 验证方式：ECR publish logs、image digest evidence。

## D. Sandbox Router 和 Route Token

目标：浏览器不直连裸 worker。所有 worker traffic 经 route token 到 router，
router 再注入 internal worker token 和 identity envelope。

- [ ] `RC-RT-001` 固化 route-token payload。
  - 完成标准：payload 包含 user、sandbox、project、workspace、session、scopes、
    expiry、nonce/token id、signing key id。
  - 验证方式：schema tests。

- [ ] `RC-RT-002` 实现 route-token signing 和 rotation。
  - 完成标准：expiry、tampering、wrong sandbox、wrong scope、old signing key 都有
    测试。
  - 验证方式：control-plane/router tests。

- [ ] `RC-RT-003` route-token 签发前做 policy check。
  - 完成标准：disabled user、stopped sandbox、archived workspace/session、wrong
    owner、over quota 均不能拿 token。
  - 验证方式：API denial tests。

- [ ] `RC-RT-004` router 支持 HTTP proxy。
  - 完成标准：通过 route token 后，HTTP 请求被转发到对应 worker；browser-supplied
    identity headers 被剥离。
  - 验证方式：router tests。

- [ ] `RC-RT-005` router 支持 SSE proxy。
  - 完成标准：provider/session event stream 可经 router 转发，断线和 expiry 行为
    稳定。
  - 验证方式：router SSE tests。

- [ ] `RC-RT-006` router 支持 WebSocket proxy。
  - 完成标准：shell/session WebSocket 经 router 可用，身份和 scope 被校验。
  - 验证方式：router WebSocket tests。

- [ ] `RC-RT-007` worker 校验 router-injected token。
  - 完成标准：非 health API 缺少或错误 worker token 返回 401/403。
  - 验证方式：worker auth tests。

- [ ] `RC-RT-008` worker 校验 signed identity envelope。
  - 完成标准：worker 对 user/sandbox/workspace/session/scope 做二次检查，不信任
    browser headers。
  - 验证方式：worker scope tests。

- [ ] `RC-RT-009` staging 部署 sandbox-router。
  - 完成标准：staging router health 可访问，router 能解析 live sandbox endpoint。
  - 验证方式：staging smoke `router_health`。

- [ ] `RC-RT-010` 证明 direct worker access 被拒绝。
  - 完成标准：直连 worker public endpoint 不带 router-injected token 返回 401/403。
  - 验证方式：staging direct-worker-denial smoke。

- [ ] `RC-RT-011` 证明 browser-to-router-to-worker 全链路。
  - 完成标准：真实 browser 用 control-plane route token 经 router 访问 worker，
    browser Authorization 不会传给 worker。
  - 验证方式：staging browser smoke。

## E. LLM Gateway 和 Provider Bootstrap

目标：Codex、Claude Code、OpenCode 在 sandbox 内开箱可用，但只拿 gateway-scoped
token，不拿真实 OpenAI/Anthropic/provider root key。

- [ ] `RC-GW-001` 固化 gateway contract。
  - 完成标准：base URL、admin auth、user/key provisioning、rotate/revoke、usage
    export、failure response 都有文档和 fixtures。
  - 验证方式：contract docs、fixture tests。

- [ ] `RC-GW-002` 实现 gateway admin client。
  - 完成标准：control plane 可 create user/key、rotate、revoke、query usage、reconcile
    key status。
  - 验证方式：mocked gateway client tests。

- [ ] `RC-GW-003` user/sandbox provisioning 时创建 gateway credential。
  - 完成标准：worker start 前已有 scoped gateway credential；失败时 sandbox 不进入
    ready 或进入 degraded state。
  - 验证方式：provisioning tests。

- [ ] `RC-GW-004` 安全存储 gateway credential metadata。
  - 完成标准：默认只存 external key id、scope、status、timestamps；如需 raw token，
    必须加密存储且不出现在 API。
  - 验证方式：repository/redaction tests。

- [ ] `RC-GW-005` 渲染 Codex gateway config。
  - 完成标准：Codex 使用 gateway base URL 和 scoped token。
  - 验证方式：provider bootstrap tests。

- [ ] `RC-GW-006` 渲染 Claude Code gateway config。
  - 完成标准：Claude Code 使用 gateway base URL 和 scoped token。
  - 验证方式：provider bootstrap tests。

- [ ] `RC-GW-007` 渲染 OpenCode gateway config。
  - 完成标准：OpenCode 使用 gateway base URL 和 scoped token。
  - 验证方式：provider bootstrap tests。

- [ ] `RC-GW-008` provider config 不暴露 secret。
  - 完成标准：metadata、logs、timeline、file API、diff、snapshot、download 都不返回
    provider/gateway credential 文件。
  - 验证方式：redaction/file exclusion tests。

- [ ] `RC-GW-009` 实现 gateway usage import。
  - 完成标准：gateway usage event 映射到 user/sandbox/project/workspace/session、
    provider、model、tokens、cost、external id。
  - 验证方式：importer tests。

- [ ] `RC-GW-010` 实现 LLM quota preflight。
  - 完成标准：over-quota 用户不能拿 route token 或不能发起 provider request；
    前端显示清晰状态。
  - 验证方式：quota/API/frontend tests。

- [ ] `RC-GW-011` 接入 staging gateway。
  - 完成标准：staging gateway 有 admin account，control plane 能签发 scoped key，
    能查询 usage。
  - 验证方式：gateway staging admin smoke。

- [ ] `RC-GW-012` Codex gateway runtime smoke。
  - 完成标准：真实 worker 内 Codex 通过 gateway 完成一次 model request，无 root key
    暴露。
  - 验证方式：provider smoke、gateway usage record、secret scan。

- [ ] `RC-GW-013` Claude Code gateway runtime smoke。
  - 完成标准：真实 worker 内 Claude Code 通过 gateway 完成一次 model request，无
    root key 暴露。
  - 验证方式：provider smoke、gateway usage record、secret scan。

- [ ] `RC-GW-014` OpenCode gateway runtime smoke。
  - 完成标准：真实 worker 内 OpenCode 通过 gateway 完成一次 model request，无
    root key 暴露。
  - 验证方式：provider smoke、gateway usage record、secret scan。

## F. ElAgenteHarness Integration

目标：sandbox agent 能用 scoped `INACT_X_APP_KEY` 调 ElAgenteHarness，获取
workflow skill、创建 task、提交复杂计算 job、读取 artifact metadata，但不持有
harness admin key。

- [ ] `RC-HN-001` 固化 harness admin contract。
  - 完成标准：base URL、admin credential、key create/rotate/revoke、workflow
    catalog、task/job/artifact、usage API 都有文档和 fixtures。
  - 验证方式：contract docs、fixture tests。

- [ ] `RC-HN-002` 实现 harness admin client。
  - 完成标准：control plane 可创建、轮换、撤销 user/sandbox scoped harness key。
  - 验证方式：mocked harness client tests。

- [ ] `RC-HN-003` 新增 harness credential 数据模型。
  - 完成标准：记录 user、sandbox、key id/hash、scopes、status、created/rotated/
    revoked timestamps。
  - 验证方式：migration/repository tests。

- [ ] `RC-HN-004` 决定 harness raw key 存储策略。
  - 完成标准：明确只存 hash、加密存 raw key、还是 write-only metadata，并记录
    rotation/recovery 方案。
  - 验证方式：architecture decision、redaction tests。

- [ ] `RC-HN-005` provisioning 时生成 `INACT_X_APP_KEY`。
  - 完成标准：sandbox start 前已有 scoped key；失败时 worker 不拿 admin key 兜底。
  - 验证方式：provisioning tests。

- [ ] `RC-HN-006` 注入 worker harness env。
  - 完成标准：worker 只收到 `ELAGENTE_HARNESS_BASE_URL` 和 scoped
    `INACT_X_APP_KEY`。
  - 验证方式：worker env tests、metadata redaction tests。

- [ ] `RC-HN-007` worker 校验 harness env。
  - 完成标准：chemistry integration enabled 时缺少 harness env 会 fail closed；
    disabled 时不阻塞 worker。
  - 验证方式：startup config tests。

- [ ] `RC-HN-008` 实现 `INACT_X_APP_KEY` redaction。
  - 完成标准：该 key 不出现在 logs、metadata、API responses、browser state、
    route token、identity envelope、smoke output。
  - 验证方式：redaction tests、artifact secret scan。

- [ ] `RC-HN-009` 选择 first harness tool surface。
  - 完成标准：明确第一阶段用 MCP、shell wrapper、provider-native tool config，或
    组合方案。
  - 验证方式：architecture decision。

- [ ] `RC-HN-010` 渲染 harness MCP config 或 tool wrapper。
  - 完成标准：approved harness tools 在 sandbox 内可用，cwd/env/path 受控。
  - 验证方式：config rendering tests。

- [ ] `RC-HN-011` 给 Codex 暴露 harness tools。
  - 完成标准：Codex 能发现并调用 approved harness tools。
  - 验证方式：provider bootstrap/tool tests。

- [ ] `RC-HN-012` 给 Claude Code 暴露 harness tools。
  - 完成标准：Claude Code 能发现并调用 approved harness tools。
  - 验证方式：provider bootstrap/tool tests。

- [ ] `RC-HN-013` 给 OpenCode 暴露 harness tools。
  - 完成标准：OpenCode 能发现并调用 approved harness tools。
  - 验证方式：provider bootstrap/tool tests。

- [ ] `RC-HN-014` 实现 workflow catalog API。
  - 完成标准：前端通过 Remote Codex API 获取 workflow list；不暴露 harness admin
    credential。
  - 验证方式：API success/unavailable/auth-denial tests。

- [ ] `RC-HN-015` 实现 task/job/artifact API。
  - 完成标准：用户只能 list/inspect 自己的 task、job、artifact metadata；跨用户
    访问被拒绝。
  - 验证方式：ownership API tests。

- [ ] `RC-HN-016` 实现 harness usage import。
  - 完成标准：harness usage event 映射到 usage ledger，支持 dedupe。
  - 验证方式：webhook/polling importer tests。

- [ ] `RC-HN-017` staging worker-to-harness smoke。
  - 完成标准：真实 worker 用 injected `INACT_X_APP_KEY` 调 staging harness，得到
    authenticated response，并产生可计费用量或任务记录。
  - 验证方式：staging smoke、secret scan。

## G. MCP 和 Tool Policy

目标：agent 可用工具都在 sandbox 内执行、可审计、不能挂载 host-local 资源，也
不能逃出 workspace。

- [ ] `RC-MCP-001` 定义 approved MCP registry schema。
  - 完成标准：registry entry 包含 id、owner、type、command/origin、args、env、
    cwd、scopes、risk class、enabled state。
  - 验证方式：schema tests。

- [ ] `RC-MCP-002` 定义 stdio MCP launch policy。
  - 完成标准：stdio MCP 只能在 sandbox 内启动，cwd 必须在 `/workspace` 或明确
    allowlisted sandbox path。
  - 验证方式：policy tests。

- [ ] `RC-MCP-003` 定义 remote MCP allowlist。
  - 完成标准：remote MCP endpoint 必须匹配 origin/scope allowlist。
  - 验证方式：policy tests。

- [ ] `RC-MCP-004` 定义 MCP env allowlist。
  - 完成标准：MCP server 只收到显式 env，不继承完整 worker env。
  - 验证方式：config rendering tests。

- [ ] `RC-MCP-005` 阻止 filesystem escape。
  - 完成标准：path traversal、symlink、absolute path 不能让 MCP/file API 逃出
    workspace。
  - 验证方式：path validation tests。

- [ ] `RC-MCP-006` 默认阻止 host socket。
  - 完成标准：Docker socket、SSH agent、host DB socket、cloud metadata credential
    等默认不可传给 MCP。
  - 验证方式：policy tests。

- [ ] `RC-MCP-007` 渲染 Codex MCP config。
  - 完成标准：Codex 只加载 approved MCP servers。
  - 验证方式：provider bootstrap tests。

- [ ] `RC-MCP-008` 渲染 Claude Code MCP config。
  - 完成标准：Claude Code 只加载 approved MCP servers。
  - 验证方式：provider bootstrap tests。

- [ ] `RC-MCP-009` 渲染 OpenCode MCP config。
  - 完成标准：OpenCode 只加载 approved MCP servers。
  - 验证方式：provider bootstrap tests。

- [ ] `RC-MCP-010` 把 ElAgenteHarness tools 加入 registry。
  - 完成标准：harness tools 有 scoped env、allowed command/origin、audit metadata。
  - 验证方式：registry/config tests。

- [ ] `RC-MCP-011` 记录 MCP startup audit。
  - 完成标准：启动成功、失败、禁用、policy denial 都写非敏感 audit。
  - 验证方式：audit tests。

- [ ] `RC-MCP-012` 记录 MCP tool-call audit。
  - 完成标准：tool call success/failure、duration、tool id、session id 有审计记录；
    arguments/result 按策略 redaction。
  - 验证方式：audit/redaction tests。

## H. Workspace Persistence、Files、Diffs、Artifacts

目标：sandbox 重启不丢有价值工作；用户可以安全查看文件、diff、artifact；任何
文件操作都不能逃出 workspace，也不能暴露 credential files。

- [ ] `RC-FS-001` 选择 phase-one persistence backend。
  - 完成标准：EFS、S3 snapshots、ephemeral MVP storage 的取舍和限制有架构记录。
  - 验证方式：architecture decision。

- [ ] `RC-FS-002` 定义 file/diff/artifact size limits。
  - 完成标准：限制写入 config，并在 worker/API/UI 层执行。
  - 验证方式：config tests、worker limit tests。

- [ ] `RC-FS-003` 新增 snapshot metadata model。
  - 完成标准：snapshot 记录 user、sandbox、workspace、object path、size、status、
    error、timestamps。
  - 验证方式：migration/repository tests。

- [ ] `RC-FS-004` worker ready 前 restore snapshot。
  - 完成标准：restore 成功或按策略失败前，workspace 不标记 ready。
  - 验证方式：lifecycle tests。

- [ ] `RC-FS-005` sandbox stop 前保存 snapshot。
  - 完成标准：controlled stop 会保存 workspace state，并记录 snapshot status。
  - 验证方式：lifecycle tests。

- [ ] `RC-FS-006` 实现 manual snapshot API/UI。
  - 完成标准：用户/admin 可触发 snapshot，能看到 pending/complete/failed。
  - 验证方式：API/frontend tests。

- [ ] `RC-FS-007` 实现 snapshot retention job。
  - 完成标准：旧 snapshot 按策略保留或删除，失败可重试和审计。
  - 验证方式：job tests。

- [ ] `RC-FS-008` 实现 scoped file read API。
  - 完成标准：只能读 workspace 内文件；binary/large file 返回稳定 metadata 或
    limited preview。
  - 验证方式：worker path/limit tests。

- [ ] `RC-FS-009` 实现 scoped file write API。
  - 完成标准：只能写 workspace 内允许路径；不能覆盖 generated credential files。
  - 验证方式：worker path/credential exclusion tests。

- [ ] `RC-FS-010` 实现 changed-files API。
  - 完成标准：返回 changed files、status、size、binary marker，并隐藏 excluded
    paths。
  - 验证方式：worker tests。

- [ ] `RC-FS-011` 实现 diff API。
  - 完成标准：文本 diff 受 size limit；binary diff 返回 metadata；credential files
    被排除。
  - 验证方式：worker tests。

- [ ] `RC-FS-012` 实现 artifact metadata model。
  - 完成标准：artifact 有 owner、workspace/session/task/job、storage path、type、
    size、retention、created timestamps。
  - 验证方式：migration/repository tests。

- [ ] `RC-FS-013` 实现 artifact API。
  - 完成标准：用户只能访问自己的 artifact metadata/download URL；跨用户拒绝。
  - 验证方式：API ownership tests。

- [ ] `RC-FS-014` 实现 chemistry artifact preview UI。
  - 完成标准：至少支持 text/log/table/image-like metadata 的安全展示；unsupported
    artifact 有 fallback。
  - 验证方式：frontend tests。

## I. Usage、Quota、Billing 和 Admin

目标：Remote Codex 统一计量 LLM、Harness、Compute、Storage、Sandbox runtime，
为用户展示统一用量和未来计费基础。

- [ ] `RC-BL-001` 定义 usage ledger schema。
  - 完成标准：ledger 支持 source、external id/dedupe key、user、sandbox、project、
    workspace、session、units、cost、currency、metadata、timestamps。
  - 验证方式：migration/repository tests。

- [ ] `RC-BL-002` 实现 LLM usage mapper。
  - 完成标准：gateway usage event 能映射 tokens、model、provider、cost 和 owner。
  - 验证方式：mapper/importer tests。

- [ ] `RC-BL-003` 实现 harness usage mapper。
  - 完成标准：workflow/task/job usage 能映射 units、cost、owner 和 dedupe key。
  - 验证方式：mapper/importer tests。

- [ ] `RC-BL-004` 实现 compute usage mapper。
  - 完成标准：Modal/AWS Batch/HPC job usage 能以外部 event 进入 ledger。
  - 验证方式：fixture importer tests。

- [ ] `RC-BL-005` 实现 storage usage mapper。
  - 完成标准：snapshot/artifact storage usage 可进入 ledger 或 periodic summary。
  - 验证方式：storage usage job tests。

- [ ] `RC-BL-006` 实现 sandbox runtime usage。
  - 完成标准：sandbox running duration、resource profile、start/stop timestamps 可计量。
  - 验证方式：runtime usage job tests。

- [ ] `RC-BL-007` 实现 idempotent import。
  - 完成标准：重复 gateway/harness/compute events 不会重复计费。
  - 验证方式：dedupe tests。

- [ ] `RC-BL-008` 实现 quota evaluation service。
  - 完成标准：route-token、sandbox start、provider request、harness task/job launch
    都能调用同一 quota service。
  - 验证方式：quota service tests。

- [ ] `RC-BL-009` 实现 user usage UI。
  - 完成标准：用户能看到按 source/model/workflow/time 分组的用量和 quota 状态。
  - 验证方式：frontend tests。

- [ ] `RC-BL-010` 实现 admin usage UI。
  - 完成标准：admin 能按 user/sandbox/source/time 查询 usage、quota denial 和异常。
  - 验证方式：admin frontend/API tests。

## J. Frontend 产品体验

目标：用户通过简单界面完成登录、进入 project/workspace/session、启动 sandbox、
使用 agent、查看 workflow/task/artifact、查看 usage/quota。前端不持有 root
credentials，不持久保存 route token。

- [ ] `RC-FE-001` 实现 login/register/logout/auth guard。
  - 完成标准：未登录、loading、已登录、expired session、disabled account 都有
    稳定 UI。
  - 验证方式：frontend tests。

- [ ] `RC-FE-002` 实现 project list/detail UI。
  - 完成标准：用户能创建、选择、归档 project；空状态和错误状态完整。
  - 验证方式：frontend tests。

- [ ] `RC-FE-003` 实现 workspace UI。
  - 完成标准：用户能在 project 内创建和进入 workspace，看到 sandbox/workspace
    状态。
  - 验证方式：frontend tests。

- [ ] `RC-FE-004` 实现 session UI。
  - 完成标准：用户能创建、打开、关闭、恢复 session；route token 只保存在内存。
  - 验证方式：frontend tests、storage review。

- [ ] `RC-FE-005` 实现 sandbox state UI。
  - 完成标准：starting/running/stopping/stopped/failed/idle-warning/degraded 都有清晰
    UI。
  - 验证方式：frontend tests。

- [ ] `RC-FE-006` 实现 router/worker connection state UI。
  - 完成标准：连接中、已连接、断线、token expired、worker unavailable 都有稳定 UI。
  - 验证方式：frontend tests、local router smoke。

- [ ] `RC-FE-007` 实现 file tree 和 file preview UI。
  - 完成标准：只通过 scoped file API 展示 workspace 文件；large/binary/denied 文件
    有 fallback。
  - 验证方式：frontend/API tests。

- [ ] `RC-FE-008` 实现 diff review UI。
  - 完成标准：用户能查看 changed files 和 diff，并触发 accept/export/apply 流程。
  - 验证方式：frontend tests。

- [ ] `RC-FE-009` 实现 workflow catalog UI。
  - 完成标准：用户能看到 harness workflow/skill 列表和可用状态。
  - 验证方式：frontend tests。

- [ ] `RC-FE-010` 实现 task/job/artifact UI。
  - 完成标准：用户能查看 task 状态、job 状态、artifact metadata/preview。
  - 验证方式：frontend tests。

- [ ] `RC-FE-011` 实现 MCP status UI。
  - 完成标准：用户能看到 enabled tools、disabled tools、startup failure 和 policy
    denial。
  - 验证方式：frontend tests。

- [ ] `RC-FE-012` 实现 usage/quota UI。
  - 完成标准：用户能看到 LLM、harness、compute、storage、sandbox runtime 用量和
    quota。
  - 验证方式：frontend tests。

- [ ] `RC-FE-013` 实现 admin dashboard。
  - 完成标准：admin 能查看 user、sandbox、runtime state、usage、quota denial、audit
    events。
  - 验证方式：admin frontend/API tests。

## K. Deployment、Secrets、Observability、CI

目标：Railway 承载 frontend/control-plane；AWS 承载 EKS Fargate sandbox runtime
和 sandbox-router；ECR/S3/Secrets Manager/CloudWatch 等资源有可复现部署路径。

- [ ] `RC-OPS-001` 定义 Railway frontend deployment。
  - 完成标准：build/start/health/env vars/domain 配置清晰；staging/prod 分离。
  - 验证方式：Railway deploy log、health check。

- [ ] `RC-OPS-002` 定义 Railway control-plane deployment。
  - 完成标准：DB、auth、gateway、harness、router、AWS credentials、secrets 都有
    staging/prod 配置策略。
  - 验证方式：Railway deploy log、API health check。

- [ ] `RC-OPS-003` 配置 DB migration 流程。
  - 完成标准：migration 可在 staging/prod 可控执行，失败可回滚或停止 release。
  - 验证方式：migration CI/deploy record。

- [ ] `RC-OPS-004` 配置 ECR worker image pipeline。
  - 完成标准：CI 构建、扫描、push immutable tag，control plane 使用 digest/tag。
  - 验证方式：CI run、ECR digest。

- [ ] `RC-OPS-005` 配置 AWS sandbox namespace。
  - 完成标准：EKS namespace、RBAC、service account、network policy/security group
    策略有 IaC 或清晰 runbook。
  - 验证方式：AWS preflight evidence。

- [ ] `RC-OPS-006` 配置 sandbox-router deployment。
  - 完成标准：router 有 health、logs、metrics、route-token signing key、worker
    endpoint discovery。
  - 验证方式：router staging smoke。

- [ ] `RC-OPS-007` 配置 S3/object storage。
  - 完成标准：snapshot、artifact、logs 或 export 的 bucket/prefix/encryption/
    lifecycle policy 有记录。
  - 验证方式：AWS preflight/object-storage smoke。

- [ ] `RC-OPS-008` 配置 secret storage 和 rotation。
  - 完成标准：route-token keys、worker-token material、gateway admin token、harness
    admin token、AWS credentials 都有 owner、location、rotation path。
  - 验证方式：secret inventory review、rotation smoke where possible。

- [ ] `RC-OPS-009` 配置 structured logs。
  - 完成标准：control plane、router、worker 都有 correlation id、user/sandbox id、
    non-secret event fields。
  - 验证方式：log review、redaction tests。

- [ ] `RC-OPS-010` 配置 metrics。
  - 完成标准：sandbox lifecycle、route token、worker connection、gateway import、
    harness import、quota denial、error rates 有 metrics。
  - 验证方式：metrics smoke/dashboard review。

- [ ] `RC-OPS-011` 配置 alerts。
  - 完成标准：auth failure spike、gateway failure、AWS capacity/image failure、
    worker crash loop、usage import stuck、runaway usage、secret scan failure 有 alert。
  - 验证方式：alert rule review、test alert where safe。

- [ ] `RC-OPS-012` 配置 CI smoke matrix。
  - 完成标准：control-plane API、router、worker image、provider bootstrap、gateway
    config、harness config、MCP policy、file path、usage importer 都在 CI 中覆盖。
  - 验证方式：passing CI run。

## L. End-to-End Acceptance

目标：一个真实 staging 用户能从登录开始，完成 sandbox session、provider request、
harness workflow、artifact review、usage/quota 和 admin inspection。

- [ ] `RC-E2E-001` staging 用户可以登录。
  - 完成标准：真实 auth provider 登录，control plane 创建/识别 user。
  - 验证方式：browser login smoke。

- [ ] `RC-E2E-002` 用户只能拥有一个 active sandbox。
  - 完成标准：重复启动不产生第二个 active sandbox。
  - 验证方式：staging lifecycle smoke、registry inspection。

- [ ] `RC-E2E-003` 用户可以创建 project/workspace/session。
  - 完成标准：metadata durable，刷新页面后仍可见。
  - 验证方式：browser/API smoke。

- [ ] `RC-E2E-004` 用户可以启动 sandbox。
  - 完成标准：control plane 创建 EKS Fargate Pod，worker ready。
  - 验证方式：staging lifecycle smoke。

- [ ] `RC-E2E-005` 浏览器通过 router 连接 worker。
  - 完成标准：route token 有效时可连，过期/错误 token 被拒绝。
  - 验证方式：browser-to-router-to-worker smoke。

- [ ] `RC-E2E-006` direct worker access 被拒绝。
  - 完成标准：绕过 router 的请求不能访问 worker API。
  - 验证方式：direct-worker-denial smoke。

- [ ] `RC-E2E-007` Codex 通过 gateway 可用。
  - 完成标准：真实 worker 内 Codex 发起一次 gateway model request。
  - 验证方式：provider smoke、usage record。

- [ ] `RC-E2E-008` Claude Code 通过 gateway 可用。
  - 完成标准：真实 worker 内 Claude Code 发起一次 gateway model request。
  - 验证方式：provider smoke、usage record。

- [ ] `RC-E2E-009` OpenCode 通过 gateway 可用。
  - 完成标准：真实 worker 内 OpenCode 发起一次 gateway model request。
  - 验证方式：provider smoke、usage record。

- [ ] `RC-E2E-010` worker 可以调用 ElAgenteHarness。
  - 完成标准：worker 用 injected `INACT_X_APP_KEY` 读取 workflow 或创建 task。
  - 验证方式：worker-to-harness staging smoke。

- [ ] `RC-E2E-011` 用户可以查看 workflow/task/job/artifact。
  - 完成标准：前端能展示 harness workflow、task status、job status、artifact
    metadata。
  - 验证方式：browser smoke。

- [ ] `RC-E2E-012` usage ledger 收到 LLM usage。
  - 完成标准：gateway usage import 后用户 usage UI 可见。
  - 验证方式：gateway usage import smoke。

- [ ] `RC-E2E-013` usage ledger 收到 harness/compute usage。
  - 完成标准：harness 或 compute usage import 后用户 usage UI 可见。
  - 验证方式：harness/compute usage smoke。

- [ ] `RC-E2E-014` quota denial 生效。
  - 完成标准：测试 quota profile 下，over-quota 用户不能继续启动高成本动作。
  - 验证方式：quota staging smoke。

- [ ] `RC-E2E-015` admin 可以检查 user/sandbox/usage/audit。
  - 完成标准：admin dashboard 显示对应 user、sandbox state、usage、audit events。
  - 验证方式：admin browser smoke。

- [ ] `RC-E2E-016` secret leakage review 通过。
  - 完成标准：staging smoke artifacts、logs、metadata、browser storage、API
    responses、snapshots、diffs 中没有 raw provider key、gateway token、
    `INACT_X_APP_KEY`、JWT、worker token。
  - 验证方式：artifact secret scan、manual review。

## 勾选前最终确认

每次把任意 `[ ]` 改成 `[x]` 前，逐项确认：

- [ ] 该项对应代码、配置、文档或部署 wiring 已经在当前 branch 落地。
- [ ] `完成标准` 已全部满足。
- [ ] `验证方式` 已执行，结果可追溯到命令输出、CI run、staging artifact、
  deploy log、docs/status 或 commit message。
- [ ] 如果是真实环境任务，证据来自 AWS/Railway/gateway/ElAgenteHarness/provider
  runtime/billing staging，而不是本地 mock。
- [ ] 没有 secret 被写入 git、日志、API response、browser storage、route token、
  smoke artifact、snapshot、diff 或下载文件。
- [ ] 如果该项也对应英文 Phase 0-6 evidence checklist，英文清单只在 verifier
  报告 ready 后再勾。
