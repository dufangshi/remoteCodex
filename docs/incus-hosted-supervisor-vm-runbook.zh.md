# Incus Hosted Supervisor VM 运维手册

> 适用范围：自托管 Ubuntu x86_64 宿主上的 `remote-codex-hosted` Incus project、`remote-codex-incus-host-agent` systemd service，以及可选启用 Incus provider 的 relay 容器。

## 1. 不可破坏的边界

- Incus provider 是 optional capability。host-agent/Incus 不可用时，不得停止、回滚或阻塞 relay；普通 device、登录、share/grant 和 tunnel 必须继续工作。
- host-agent 只监听 relay 专用 Docker bridge 地址，不开放公网端口；VM 只主动出站连接 relay。
- 不输出 `/etc/remote-codex/incus-host-agent.env`、credential blob、device token、admin/session secret 或 guest `auth.json` 内容。
- 不直接删除 `relay_hosted_sandboxes` 数据库行来“修复”状态；生命周期操作必须经 admin API/host-agent，避免遗留 VM 或 credential。
- 初始容量固定为最多 4 台 managed VM、最多 1 台 Running VM。扩大前必须重新做 RAM、磁盘和并发 turn 压测。

## 2. 日常健康检查

以下命令只输出状态和容量，不输出 token：

```bash
systemctl is-active incus
systemctl is-active remote-codex-incus-host-agent
docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' remote-codex-relay
curl -fsS http://127.0.0.1:8798/healthz
incus list --project remote-codex-hosted
df -h /
free -h
```

认证后的 `/v1/capability` 应检查：

- `available=true`
- `imageVersion=ubuntu-24.04-v4`
- `capacity.runningInstances <= limits.maxRunningInstances`
- `capacity.totalInstances <= limits.maxInstances`
- `metrics.memoryAvailableMiB`、`metrics.diskAvailableGiB`、`metrics.loadPerCpu` 未触发 `alerts`

Relay admin 的 Hosted VMs capability card 显示相同的 running/total usage。capability unavailable 只影响 Hosted 操作，不代表 relay 故障。

## 3. 部署与回滚

### Host-agent

- 使用独立 `incus-host-agent-deploy.yml`；它不得重启 relay。
- 新 artifact 安装前保留上一份 `index.cjs`。
- restart 后用 bearer-authenticated `/readyz` 验证；失败则恢复旧 artifact。
- guest helper 和 systemd unit 必须与 artifact 一起发布。

### Relay

- relay workflow 在 host-agent ready 且 Hosted relay URL 已配置时注入 provider env；否则以 provider disabled 启动。
- 仓库必须配置 `REMOTE_CODEX_HOSTED_RELAY_SERVER_URL`；缺失时 workflow 会按 optional-capability 规则成功发布普通 relay，但 Hosted 管理面显示 Disabled。
- provider capability unavailable 不得让 relay deploy 失败。
- 回滚只替换 relay image/container，保留 `remote-codex-relay-data` volume 和 Hosted SQLite 表。
- 回滚 relay/host-agent 不得自动删除或停止已有 VM。

## 4. 事件处理

### host-agent down

1. 确认 relay `/healthz` 和普通 device API 正常。
2. Admin UI 应仅显示 Hosted unavailable。
3. 检查 `systemctl status` 和脱敏后的 journal。
4. 修复或回滚 host-agent；不要重启 relay 作为第一反应。
5. `/readyz` 恢复后确认 capability 自动回到 available。

### Incus daemon down

1. 确认 relay 仍健康。
2. 检查 `systemctl status incus`、磁盘空间和 `/dev/kvm`。
3. 恢复 Incus 后先只读 `incus list --project remote-codex-hosted`。
4. 对 relay 中非 terminal operation 做 reconciliation/retry，不直接新建重复 VM。

### VM boot / guest-agent failed

1. 通过 admin detail 记录 sandbox ID、operation ID 和脱敏 error code。
2. 检查 `incus info --project remote-codex-hosted rcd-<sandbox-id> --show-log`。
3. 确认 image alias、资源上限、guest agent 和网络 DHCP。
4. 修复后使用同一 sandbox 的 Retry；idempotency key 会避免重复 create。

### Credential expired / invalid

1. 不读取或复制旧 `auth.json`。
2. 由用户/admin 提供新的专用 Platform API key。
3. 使用 Rotate credential；relay 只保存 opaque credential ref。
4. reprovision 成功后旧 encrypted blob 才被删除。
5. 用 `codex login status` 和一个最小真实 turn 验收，不在日志打印 key。

### Disk full

1. 先确认 relay volume、Incus pool、image、snapshot 和 stopped VM 各自占用。
2. 停止新的 Hosted create/start，但保持 relay 正常。
3. 删除已确认无主的临时 builder、过期测试 VM/image 和按策略可删 snapshot。
4. 不对运行中 VM 的 root disk 做宿主级手工截断。
5. `dir` driver 仅为 PoC；容量扩大前迁移到 LVM-thin 或 ZFS。

## 5. Orphan audit

至少每日对比三份清单：

1. Relay `relay_hosted_sandboxes` / admin list。
2. Incus project 中符合 `rcd-<uuid>` 的实例。
3. host-agent encrypted credential store 和 operation store。

分类处理：

- Relay 有记录、VM 无：标记 error，保留 credential，人工 Retry 或 Delete。
- VM 有、Relay 无：先停止并隔离，确认不是 rollback 中的旧记录后再删除。
- Credential 有、Relay/operation 均无：记录审计后删除。
- pending/running operation 超时：用相同 idempotency key 查询/重试，不能盲目复制资源。

当前实现默认每 5 分钟执行一次跨存储审计，Admin 也可手工 Run inventory audit：

- audit 不自动删除任何资源。
- orphan VM/credential 只能由 admin 显式删除。
- 删除前会重新读取完整 inventory；若资源已不再是 orphan，返回 409。
- inventory 不可用时报告 `unavailable`，不得影响 relay health、普通 device 或 tunnel。
- 清理后再次 audit，必须回到 `healthy` 且 orphan/missing 计数为 0。

## 6. Backup / restore

- VM snapshot 用于短期一致性 checkpoint，不等于异机备份。
- snapshot 前优先 graceful stop；恢复要求 VM 为 Stopped。
- 定期导出 Incus instance/image 到宿主外存储，并备份 relay SQLite volume 与 host-agent master key/credential blobs；三者必须同一恢复批次。
- 恢复演练顺序：恢复 relay DB → host-agent secret store/master key → Incus VM → 启动 relay/agent → wake device → 验证 workspace、thread、`.codex` 和 marker。
- 已完成一次 off-host round-trip drill：备份批次先下载到本机 Mac 并校验 SHA-256/SQLite/credential decrypt，再回传并导入无 NIC 的独立 Incus project；guest 内 workspace marker、Codex state/config/auth 和 supervisor SQLite 均通过验证。
- 该演练的恢复计算仍位于同一物理宿主，因此只能证明“宿主外副本可恢复”，不能据此宣称完整跨宿主 DR ready。

### 当前上线 gate

以下项目未明确前，保持最多 1 台 Running VM，且不得标记 DR ready：

1. off-host 目标（S3-compatible bucket 或独立备份主机）及网络/账号边界；
2. relay SQLite、Incus export、credential blobs 与 master key 的独立加密和 key escrow；
3. 保留周期、RPO/RTO、容量告警与删除保护；
4. 与生产宿主隔离的 x86_64 Ubuntu restore host；
5. 在独立 x86_64 restore host 再做一次完整演练：恢复同一批次数据、wake device、校验 workspace/thread/`.codex` marker，随后销毁演练环境。

### 2026-07-10 drill evidence

- bundle：Incus instance export + relay SQLite online backup + encrypted credential blob + master-key metadata；约 1.19 GB。
- SHA-256：`31cfb9b5305c0faa839de0a032fef33de5072d80905d6a626afae78e6e8b58b3`，宿主 → Mac → 宿主三端一致。
- restore project：`remote-codex-restore-drill`；恢复 VM 不配置 NIC，避免连接生产 relay。
- guest evidence：ordered marker、long-turn terminal marker、`auth.json` mode 0600、`gpt-5.6-sol`/自定义 Responses base URL、167936-byte supervisor SQLite 均通过。
- cleanup：恢复 VM 与 project 已删除；生产 Hosted sandbox/Incus instance/credential 均清零，inventory audit 回到 healthy。

## 7. 安全删除

1. 从 Relay Admin 发起 Hosted delete。
2. 等 operation succeeded 或 detail 404。
3. 确认 `rcd-<sandbox-id>` 不存在。
4. 确认 credential ref 已删除、device 不再出现在目标用户 portal。
5. 删除/禁用不再使用的测试用户。
6. 做 secret scan，只报告匹配数量，不打印匹配内容。

## 8. 整机维护窗口 reboot 验收

生产宿主同时运行其他 Docker 服务；没有明确维护窗口时不得为 Hosted VM 验收单独重启整机。获批后按以下顺序执行：

1. 确认 Hosted sandbox/active turn 均为 0，inventory audit 为 healthy，并记录 relay、host-agent、Incus 和既有 Docker container 基线。
2. 确认 `/dev/kvm`、`remote-codex-ubuntu-24.04-v4` alias、`remote-codex-relay-data` volume 和 host-agent credential/master-key 文件存在。
3. 执行宿主 reboot；等待 SSH、Docker、Incus、`remote-codex-incus-network` 和 host-agent systemd unit 恢复。
4. 验证 relay `/healthz=200`、Hosted capability available、inventory healthy、`rcdbr0` egress rules 存在，普通 device create/delete 回归为 200。
5. 用 v4 临时 Hosted VM 做 create → online → stop/start → 真实 prompt → delete，并确认最终 VM/credential/orphan 均为 0。
6. 若 host-agent 未恢复，只回滚 host-agent artifact/env；relay 必须保持运行，不得以重启或回滚 relay 作为首个修复动作。

### 2026-07-11 reboot evidence

- 用户明确批准维护窗口后执行；boot ID 从 `1b1d78c9-fa4b-4403-ac11-237acd45c090` 变为 `56dec932-6280-465a-bf53-0e6d419f45a3`。
- 重启前后 23 个 `unless-stopped` container 全部 running，名称集合 SHA-256 均为 `bc6bfe018603aa35ad676ee60b7b9bec35d736eba5f0d815d76894a58a1bfab6`。
- Docker、Incus、network unit、host-agent active；relay/agent 200，Hosted capability available、inventory healthy、v4 image、relay volume、KVM、`rcdbr0` rules 均保留。
- 普通 device create/delete 为 200；临时 v4 VM 完成 online、stop/start 和真实模型 sentinel `POST_REBOOT_V4_E2E_OK` 后清理。
- 最终另建并保留归属 `alwyn` 的 `Hosted Codex v4 Ready`，供 portal 直接创建 workspace/thread 测试；10 分钟无活动后正常 auto-stop，后续访问会 wake。
