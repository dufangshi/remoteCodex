# AWS Kubernetes 托管 Supervisor 集成复审

> 复审基线：`aspuru-guzik-group/el-agente-cloud-infrastructure` 的 `dev` 分支，commit `c87844d`（2026-07-11 拉取）。该仓库的 `main` 当前不包含实际实现，不能以 `main` 作为集成依据。

## 1. 修正后的结论

`el-agente-cloud-infrastructure` 已实现的不是 EC2 VM 编排，而是一套面向现有 Kubernetes 集群的 sandbox runtime：

```text
一个 sandbox = 一个 Pod + 一个 ClusterIP Service + 可选的 EFS /workspace
```

在 AWS 上，它的目标运行环境是已有的 EKS，计算节点可以是 Fargate。停止 sandbox 会删除 Pod 和 Service，EFS 中的 workspace 子目录继续保留；再次启动同一 sandbox id 时会重新挂载原目录。

因此 Remote Codex 不应重复实现一套“创建 AWS VM”的控制面。推荐新增一个可选的 `kubernetes` hosted provider，把 Remote Codex supervisor 作为 Pod 主进程运行，并继续由 supervisor 主动拨入 relay 的 `/supervisor/tunnel`。Incus provider 保留，二者并列：

```text
HostedSandboxProvider
├── disabled      relay 完全正常，托管 runtime 功能不可用
├── incus         本机/自管宿主上的完整 VM
└── kubernetes    EKS/Fargate 或其他兼容 Kubernetes 集群上的 Pod sandbox
```

如果未来确实需要 systemd、嵌套容器、独立内核或 VM snapshot，再单独设计 EC2/Firecracker provider；这些能力不在当前外部项目中，不应假装已经复用。

## 2. 外部项目已经提供、应直接复用的部分

### 2.1 Kubernetes 生命周期管理

`src/sandbox-manager.ts` 的 `KubernetesSandboxManager` 已实现：

- `startSandbox`：清理旧 Pod/Service，重新 apply Service 和 Pod；
- `stopSandbox`：删除 Pod 和相关 Service；
- `restartSandbox`；
- `deleteSandbox`；
- `getSandboxStatus` 和 endpoint 解析；
- 创建、删除每个 sandbox 的 Kubernetes Secret；
- 枚举 runtime 资源和清理孤儿资源。

这些逻辑应抽成可版本化的共享 package，或以明确 commit 的源码依赖引入。不要在 relay-server 内重写 `kubectl apply/delete/get`。

### 2.2 Pod、Service、Secret manifest 生成

`src/manifests.ts` 已支持：

- image、command、args、env、Secret 引用；
- CPU、内存、ephemeral storage request/limit；
- readiness、liveness、startup probes；
- init container；
- sidecar；
- workspace PVC 和 sandbox 专属 subPath；
- ClusterIP Service 与额外 endpoint。

Remote Codex 只需提供 supervisor 镜像及其运行参数，不需要再造 Kubernetes manifest builder。

### 2.3 workspace 持久化

外部项目已经采用 EFS + 静态 PV/PVC：

```text
EFS access point
└── <environment>/<sandbox-id>
    └── 挂载为 Pod 内的 /workspace
```

Pod 停止或 Fargate task 消失后，`/workspace` 数据仍存在。重新启动同一 sandbox id 后自动挂回。

Remote Codex 应把以下持久状态全部放在 `/workspace` 下：

- supervisor SQLite：`/workspace/.remote-codex/supervisor.sqlite`；
- workspace 项目目录：`/workspace/workspaces/*`；
- Codex home：建议 `/workspace/.codex`，或令 `CODEX_HOME=/workspace/.codex`；
- 其他 backend 的持久配置目录。

这样不需要为 `.codex` 和 supervisor 数据库另造 snapshot/restore 流程。Kubernetes provider 的 `snapshot` 能力不能照搬 Incus snapshot；第一阶段应在 UI/API 中明确标记为不支持。若需要备份，应设计 EFS Backup/AWS Backup，而不是伪装成 VM snapshot。

### 2.4 空闲回收和孤儿清理

`src/sandbox-reaper.ts` 已处理：

- starting/stopping 超时后的状态对账；
- running/degraded 的 idle timeout；
- failed runtime TTL；
- 数据库不存在但集群仍存在的孤儿 Pod。

Remote Codex 已有 turn-aware idle 规则和 provider inventory reconciler。这里不能同时运行两套拥有最终决定权的回收器：

- relay 继续负责产品语义：turn 是否结束、最后用户访问、10 分钟 idle；
- Kubernetes manager 负责执行 start/stop/status 和资源枚举；
- 外部 `SandboxReaper` 的状态对账/孤儿清理算法可以复用，但 idle 判定必须读取 relay 的活动状态，不能再使用另一份独立数据库时间戳。

### 2.5 AWS Terraform

`infra/terraform/aws-eks-fargate` 已提供：

- 可选 ECR repository；
- EFS、access point、mount target 和安全组；
- EFS CSI IAM role/addon；
- namespace；
- sandbox app/manager ServiceAccount；
- namespace-scoped RBAC；
- 静态 EFS PV/PVC。

它明确假设 EKS、VPC、private subnet 和 Pod security group 已存在。Remote Codex 不应重复写这些资源，但需补一个部署层，把现有集群参数传入并输出 relay 所需配置。

## 3. 不应复用或不需要的部分

- 外部项目的 Supabase 用户、`agent_containers`、sub2api key 数据模型：relay 已有 device、grant、hosted sandbox 和成员模型。
- `apps/sandbox-router` 的入站 HTTP/WebSocket 代理：Remote Codex supervisor 主动连接 relay，不需要暴露 supervisor Service 到公网。Service 甚至可以在第一阶段省略；若现有 manager 强制创建，可保留内部 ClusterIP。
- iframe/embed URL、public host label、route cookie：不是 relay tunnel 所需能力。
- Seguro/Solido 专用镜像和环境变量：只复用通用 runtime 基础设施。
- 外部项目的 idle 数据源：产品活动真相必须仍在 relay。

## 4. Remote Codex 需要新增的适配层

### 4.1 Provider 配置和可选性

将当前单值 `provider: disabled | incus` 扩展为 `disabled | incus | kubernetes`。所有 Kubernetes 配置均为可选；缺失或集群不可达时：

- relay 启动、登录、普通 device、grant/share、thread、Incus provider 均不受影响；
- admin capability 显示 Kubernetes provider 未配置或不可达；
- 只有创建 Kubernetes hosted runtime 的入口禁用。

建议配置：

```text
RELAY_HOSTED_SANDBOX_PROVIDER=kubernetes
RELAY_HOSTED_K8S_NAMESPACE=remote-codex-sandboxes
RELAY_HOSTED_K8S_SERVICE_ACCOUNT=remote-codex-supervisor
RELAY_HOSTED_K8S_IMAGE=<ecr>/remote-codex-supervisor:<immutable-tag>
RELAY_HOSTED_K8S_WORKSPACE_PVC=remote-codex-workspaces
RELAY_HOSTED_K8S_WORKSPACE_SUBPATH_PREFIX=production
RELAY_HOSTED_K8S_KUBECTL_PATH=kubectl
```

生产上更理想的是 relay/control-plane 运行在集群内并使用 ServiceAccount；若 relay 在 Railway 等集群外环境，则应部署一个最小 Kubernetes host-agent 到集群内，relay 通过鉴权 API 调用它，避免把长期 kubeconfig 放进 relay 容器。

### 4.2 Provider 方法映射

| Remote Codex 方法 | Kubernetes 实现 |
|---|---|
| `capability` | namespace/RBAC/PVC/image pull prerequisites 检查 |
| `inventory` | 按 environment label 枚举 Pod 和 Secret |
| `createCredential` / `createCodexCredential` | 创建 per-sandbox Secret，或保存加密 credential 后在 start 时生成 Secret |
| `create` | 建立逻辑记录；可立即创建 Pod，也可保持 stopped |
| `provision` | 写入 relay token、Codex 文件及 supervisor 配置 Secret |
| `start` | `KubernetesSandboxManager.startSandbox` |
| `status` | `getSandboxStatus` |
| `stop` | 删除 Pod/Service，保留 EFS 子目录和必要 Secret |
| `delete` | 删除 Pod/Service/Secret，并按产品策略删除或保留 EFS 子目录 |
| `snapshot` | 第一阶段返回 capability unsupported；后续接 AWS Backup |
| `read/writeCodexFiles` | 通过 Secret 更新并重启 Pod，或由受控 helper Job 写入 EFS |

外部 manager 当前用 Pod 名表示 runtime；Remote Codex DB 里的 hosted sandbox id 应直接作为稳定 sandbox id。成员授权仍由现有 device grant/share 完成，与 Pod 数量无关。

### 4.3 Supervisor 镜像和启动契约

新增一个不可变、非特权镜像，预装 Node、Remote Codex CLI 和 Codex CLI。Pod 主进程运行：

```text
remote-codex relay-supervisor run
```

至少注入：

```text
REMOTE_CODEX_MODE=relay
REMOTE_CODEX_RELAY_SERVER_URL=wss://<relay-host>
REMOTE_CODEX_RELAY_AGENT_TOKEN=<per-device-token>
WORKSPACE_ROOT=/workspace/workspaces
DATABASE_URL=sqlite:///workspace/.remote-codex/supervisor.sqlite
CODEX_HOME=/workspace/.codex
```

`config.toml` 和 `auth.json` 不应作为普通 env 展开。建议 Kubernetes Secret 保存文件内容，由 init container 写入持久目录，权限设为 `0600`。管理员在 relay-admin 更新文件后：更新 Secret，再滚动重建 Pod；EFS 中保留最终文件，使停启无痛恢复。

### 4.4 Readiness 与启动 UI

readiness 不能只看 Pod phase。`running` 至少同时满足：

1. Pod Ready；
2. supervisor 已用 device token 接入 relay tunnel；
3. relay 已把对应 device 标为 online。

启动期间沿用现有自动轮询 UI，显示 pulling image、starting container、waiting for supervisor tunnel 等阶段。用户不需要刷新。

## 5. 分阶段实施计划

### Phase 0：确定复用边界和许可证

- 固定外部源码基线 `dev@c87844d`。
- 确认外部仓库许可证；当前审阅到的根目录未见明确 LICENSE，未确认前不要直接复制大段源码。
- 优先让外部项目发布/拆出 `@sandbox-control-plane/runtime` 非 private package；次选 git subtree/vendor，并保留来源与同步说明。
- 为通用 manager 补齐不创建 Service 的选项，以适配纯 outbound relay tunnel。

验收：Remote Codex 中没有第二套 manifest、kubectl client 或 reaper 核心算法。

### Phase 1：本地 Kubernetes provider contract

- 扩展 provider enum、capability DTO 和 feature flags。
- 实现 `KubernetesHostedSandboxProvider`，先使用 fake Kubernetes client。
- 映射 start/stop/status/inventory/credential/provision。
- snapshot 返回显式 unsupported capability，而不是运行时报模糊错误。
- 覆盖 disabled/incus/kubernetes 三种配置的隔离测试。

验收：不配置 Kubernetes 时所有既有测试通过；fake client 下完整 create/start/online/stop/delete saga 通过。

### Phase 2：Supervisor runtime 镜像

- 构建并推送 immutable ECR image。
- 预装 Remote Codex supervisor 和 Codex CLI。
- 将 `/workspace`、SQLite、`CODEX_HOME` 路径统一到 EFS mount。
- Secret/init container 安装 `config.toml`、`auth.json` 和 relay token。
- 添加非特权 UID、只读 root filesystem（除 `/tmp` 和 `/workspace`）、资源限制和 graceful shutdown。

验收：删除并重建 Pod 后 workspace、thread 数据库、Codex 登录和历史状态仍可读取。

### Phase 3：AWS 基础设施复用

- 直接复用外部 `aws-eks-fargate` Terraform module。
- 输入已有 EKS/VPC/subnet/security groups；不重新创建集群。
- 新建 Remote Codex 专用 namespace、ServiceAccount、RBAC、EFS subpath prefix 和 ECR repository。
- 将 manager Secret 权限限制到该 namespace，并按 label 约束运维审计。
- 若 relay 在集群外，部署轻量 Kubernetes host-agent，复用 Incus host-agent 的 bearer auth、idempotency、capability/inventory 形态。

验收：Terraform plan 不修改外部项目现有 sandbox 资源；Remote Codex namespace 可独立销毁。

### Phase 4：relay-admin UI

- “Create hosted runtime” 增加 provider 选择：Incus VM / AWS Kubernetes。
- Kubernetes 资源规格映射到 small/standard/large profiles。
- backend 文件编辑继续使用现有 Codex config/auth UI。
- snapshot 按 provider capability 隐藏或禁用，并解释 EFS persistence/backup。
- Managed runtime 卡片显示 Pod readiness、relay online、最近活动和 EFS workspace 标识。

验收：同一 VM/Pod 对多个 relay 账号的授权仍通过成员/grant UI 管理；provider 不改变授权模型。

### Phase 5：turn-aware idle 与恢复

- relay 保持活动真相：turn 未结束绝不 stop。
- turn 结束且 10 分钟无访问时调用 Kubernetes stop，删除 Pod/Service。
- 新访问触发 start；UI 自动等待 Pod Ready + device online。
- 复用 reaper 的 stale/orphan reconciliation，但禁用其独立 idle clock。

验收：长 turn 超过 10 分钟不会被停止；结束后 idle 10 分钟停止；再次访问自动恢复且文件/数据库不丢失。

### Phase 6：真实 AWS E2E 与故障测试

- 创建 hosted runtime，检查 Pod、Secret、PVC subPath 和 relay device。
- 创建 workspace/thread，运行真实 Codex turn。
- turn 中观察不会停止；结束后等待 idle stop。
- 再次访问自动拉起，验证 workspace、SQLite、Codex auth。
- 测试 image pull failure、EFS mount failure、Pod eviction、relay 重启、孤儿 Pod、孤儿 Secret。
- 验证普通 relay device 和 Incus provider 在 Kubernetes 故障时不受影响。

验收：完整 E2E 可重复执行，并有清理脚本/审计报告，不遗留 Pod、Secret 或无主 EFS 数据。

## 6. 关键决策

1. 产品文案使用“Hosted runtime”或“Kubernetes sandbox”，不要称为 AWS VM。
2. Incus 是完整 VM provider；EKS/Fargate 是 Pod provider，两者满足不同隔离和运行语义。
3. EFS 是工作目录的持久化层，不等同于 VM filesystem snapshot。
4. relay 是授权、用户活动和 turn 生命周期的唯一事实来源。
5. Kubernetes manager 是执行器，不再引入第二套用户、grant 或 thread 数据模型。
6. 第一阶段无需公网 router，因为 supervisor 只做 outbound relay tunnel。

## 7. 暂不做的事项

- 不创建新的 EKS 集群或 VPC；
- 不实现 EC2 VM lifecycle；
- 不复用 Supabase/agent/sub2api 业务模型；
- 不公开 supervisor 的入站端口；
- 不把 EFS persistence 宣称为 snapshot；
- 不在 Kubernetes provider 不可用时影响 relay 其他功能。
