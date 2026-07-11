# AWS Hosted Supervisor Provider 接入计划

## 当前审计状态

计划编写时，`/home/u/el-agente-cloud-infrastructure` 在本机、`cardverify-prod`、`feiji` 均不存在，当前 GitHub 账号下也没有同名仓库。因此以下方案先基于 remoteCodex 现有 Incus provider 边界设计；拿到参考仓库后，必须补做“源码映射审计”，确认它实际使用的是 EKS/Kubernetes Operator、EC2 API、Terraform、Pulumi、CDK，还是组合方案。

## 结论

AWS 不应改变 relay 协议。AWS VM 仍运行一个主动拨出 `/supervisor/tunnel` 的 `remote-codex relay-supervisor run`，relay 只把它视为普通在线 device。差异应收敛在 Hosted Sandbox provider：Incus provider 管理本机 VM，AWS provider 管理 EC2、EBS、AMI、IAM 与网络。

首个版本优先直接使用 EC2 API，而不是为“一台 VM 对应一个 supervisor”额外引入 EKS。只有参考项目已经提供成熟的 Kubernetes CRD/operator，并能证明其生命周期、成本和故障恢复优于 EC2 provider 时，才选择 EKS 路径。

## 目标形态

- relay-admin 创建 Hosted VM 时选择 `Local Incus` 或 `AWS EC2`。
- 两种 provider 共用成员、device、权限、空闲停止、turn-aware lifecycle 和 backend 文件模型。
- AWS VM 使用预构建 AMI，包含 Node.js、remote-codex、Codex CLI、systemd unit、workspace 目录和启动校验。
- VM 不开放 supervisor 入站端口；只允许主动访问 relay、模型 API、Git/npm 等白名单目标。
- 停机保留 EBS 根盘和 workspace 数据；重新启动后继续使用原 device token、supervisor DB、Codex 配置和项目文件。

## Phase 0：参考项目源码映射审计

- 确认 IaC 技术栈、AWS SDK 版本、region/account 配置入口和 credential chain。
- 找到创建、启动、停止、销毁、镜像选择、磁盘、security group、IAM role、tagging 和状态回写代码。
- 如果使用 Kubernetes，确认是 EKS 创建 Pod、KubeVirt VM，还是 operator 最终创建 EC2。
- 确认是否已有 AMI/Packer pipeline、cloud-init/user-data、SSM 和 instance profile。
- 记录可直接复用模块、需要抽象的 AWS 资源命名以及不能复用的业务耦合。

## Phase 1：通用 Provider 契约

把当前 `HostedSandboxProvider` 从 Incus 语义提升为通用接口：

- `capability / inventory`
- `create / status / start / stop / snapshot / delete`
- `provision`
- `createBackendCredential / deleteCredential`
- `readBackendFiles / writeBackendFiles`

数据库把 provider 从固定 `incus` 扩展为 `incus | aws-ec2`，增加 `provider_account_ref`、`region`、`availability_zone`、`image_id`、`volume_id`、`instance_profile` 和 provider metadata JSON。现有 Incus 记录无迁移行为变化。

## Phase 2：AWS Control Plane

新增可选 package `packages/aws-hosted-sandbox-provider`。只有配置 AWS provider 时才加载，缺少 AWS 权限时 relay 与 Incus 功能必须继续正常工作。

推荐权限采用专用 IAM role，最小权限覆盖：

- 指定 tag/name 范围内的 EC2 create/start/stop/terminate/describe。
- 指定 AMI、subnet、security group、instance profile 和 KMS key。
- 指定 tag 范围内的 EBS volume/snapshot。
- 读取或创建指定前缀的 Secrets Manager secret。
- 可选 SSM Session Manager，禁止通用 SSH 入站。

所有资源强制 tag：`remote-codex-managed=true`、sandbox UUID、relay environment、creator、cost center。Inventory reconciliation 只能处理带这些 tag 的资源。

## Phase 3：AMI 与启动链路

使用 Packer 或参考项目现有 image pipeline 构建 x86_64 Ubuntu 24.04 AMI：

- Node.js 22、remote-codex 固定版本、Codex CLI 固定版本。
- `remote-codex-relay-supervisor.service` 默认 disabled。
- `/home/remote-codex/workspaces`、`.remote-codex`、`.codex` 权限预置。
- cloud-init 只接收短期 bootstrap reference，不直接携带模型密钥或 device token。
- instance role 从 Secrets Manager/KMS 读取一次性 provisioning bundle，写入 device token、backend files 和 supervisor env 后删除或禁用 bootstrap secret。
- 启动后通过 relay tunnel 上报 ready，control plane 不依赖公网 SSH。

AMI 发布需要 manifest：AMI ID、remote-codex 版本、Codex 版本、架构、region copy 状态、构建 commit 和兼容 schema version。

## Phase 4：网络与持久化

- 默认 private subnet + NAT 或 egress proxy；没有任何入站 security-group rule。
- 根盘使用加密 gp3 EBS，删除 VM 时是否保留由明确的 admin 操作决定。
- `stop` 保留 EBS，`start` 使用同一 instance；workspace、SQLite 和 backend 文件不会丢失。
- snapshot 对应 EBS snapshot，并在 relay DB 记录 snapshot ID 和 image/schema version。
- deny-by-default egress 至少允许 relay host、OpenAI/Anthropic、自定义模型 base URL、GitHub 和必要 registry。

## Phase 5：Relay API 与 Admin UI

- 创建表单增加 provider、region、instance type、disk size、subnet/profile preset。
- backend 文件上传逻辑与 Incus 完全共用，支持一次选择多个 backend；首期仅 Codex。
- capability 分 provider 展示，例如 AWS 权限缺失、AMI 不存在、region capacity 不足、预算限制。
- Managed VM 行展示 provider/region/instance type/EBS，并沿用成员搜索、启动进度、空闲停止和 backend 文件编辑。
- AWS provider 不可用时只禁用 AWS 创建入口，Incus 与 relay 其他功能不受影响。

## Phase 6：Lifecycle 与成本控制

- active turn 时禁止停止。
- turn 完成且 10 分钟无访问后调用 EC2 StopInstances。
- 用户访问 stopped device 时调用 StartInstances，页面自动轮询，tunnel 恢复后继续原请求。
- 增加每用户/团队最大实例数、最大运行数、允许 instance type、月预算告警和强制 TTL。
- Spot 只作为后续可选模式；首期使用 On-Demand，避免中断破坏交互式 turn。

## Phase 7：E2E 与上线门槛

1. 使用专用测试 AWS account/role 创建 VM。
2. 验证无入站端口、仅允许规定 egress。
3. 上传 Codex config/auth，VM 主动接入 relay 并显示 online。
4. 两个 relay 用户访问同一 VM，创建短名 workspace 和 thread。
5. active turn 中 stop 被拒绝；完成后 10 分钟自动 stop。
6. 再次访问自动 start，workspace、supervisor SQLite、Codex 文件和 thread transcript 保留。
7. EBS snapshot/restore 后再次连接。
8. 删除流程清理 instance、volume、secret、临时 network attachment；reconciliation 无 orphan。
9. AWS provider 权限撤销时，relay、Incus VM 和普通 device 功能保持健康。

## 实施顺序建议

先完成参考仓库审计和 Provider 契约，不直接复制其 Kubernetes 层。然后用一个固定 subnet/security-group/AMI 做单实例 EC2 PoC；PoC 跑通 relay tunnel、backend 文件、停止恢复后，再接 admin UI、reconciliation、预算与多 region。这样能最大限度复用当前 Incus 已验证的产品与权限模型，同时把 AWS 特有风险限制在 provider package 内。
