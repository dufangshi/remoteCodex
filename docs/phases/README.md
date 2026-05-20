# 分阶段开发计划

本目录基于原始总方案文档 [docs/plan.md](../plan.md) 拆分为可执行的阶段文档，适用于当前这个从零开始的新项目。

使用规则：

1. 先通过当前阶段，再进入下一阶段。
2. 每个阶段都必须同时满足：
   - 开发范围全部完成
   - 验收标准全部满足
   - 检查步骤全部执行并留痕
   - 阶段 checklist 全部打钩
3. 任一 checklist 项未勾选，该阶段都视为未通过。
4. 如某阶段需要调整范围，先更新对应阶段文档，再开始开发。

## 阶段索引

| Phase | 文档 | 主题 | 通过后得到什么 |
| --- | --- | --- | --- |
| 1 | [phase-1-foundation.md](./phase-1-foundation.md) | 基础 supervisor 与工程底座 | 一个可运行、可开发、可测试的基础系统骨架 |
| 2 | [phase-2-codex-control-plane.md](./phase-2-codex-control-plane.md) | Codex 主控制面接入 | 可以启动、恢复、读取、打断 Codex thread |
| 3 | [phase-3-durable-shell.md](./phase-3-durable-shell.md) | 独立 shell 与 tmux 持久化 | 每个 thread 拥有独立、可恢复的 shell |
| 4 | [phase-4-admin-governance.md](./phase-4-admin-governance.md) | 管理界面与资源治理 | 可以查看、限制、清理 thread / shell 资源 |
| 5 | [phase-5-interaction-notifications.md](./phase-5-interaction-notifications.md) | 交互补全与通知体系 | 可以处理 plan mode 问题并获得完整状态提醒 |

## 后续架构重构

完成 Codex 主链路后，后续如需兼容 Claude，不应直接把 Claude 接进现有 `ThreadService`。应先执行 [Agent Runtime Provider Abstraction](../agent-runtime-provider-abstraction.md)：

- 先建立 provider-neutral `AgentRuntime` 抽象。
- 先让 Codex 通过 `CodexRuntimeAdapter` 接入该抽象，并保持现有 Codex 行为不变。
- 确认 Codex 创建、恢复、发送、停止、streaming、goal、fast、skills、MCP、hooks trust 等能力未回归。
- 之后再接 Claude adapter。

这一步的目标是把当前系统从 `CodexAppServerManager -> ThreadService -> DTO/UI` 的直接耦合，迁移为 `AgentRuntime -> Codex adapter -> CodexAppServerManager`。Claude 兼容应在这个边界稳定后再启动。

## 推荐交付节奏

1. Phase 1 完成后，先冻结基础目录结构、脚本约定、数据库迁移方式。
2. Phase 2 完成后，先验证 Codex 控制链路稳定，再进入 shell 能力开发。
3. Phase 3 完成后，先做断线恢复专项测试，再进入治理与管理页面。
4. Phase 4 完成后，先压测 thread / shell 生命周期，再做最后一层交互补全。
5. Phase 5 完成后，进行一次端到端发布前验收。

## 文档模板约定

每个阶段文档都包含以下固定部分：

- 本阶段需要开发什么
- 本阶段交付物
- 验收标准
- 如何检查
- 必须全部打钩的 checklist

## 总体里程碑出口条件

所有 Phase 全部通过后，项目应满足以下总目标：

- 手机网页可以通过 Tailscale 访问 supervisor。
- 可以管理 workspace、Codex thread、独立 shell。
- 弱网断线不导致 Codex thread 或 shell 丢失。
- 可以在网页内完成 turn 中断、plan mode 问答和基础通知查看。
- 管理界面可以限制资源、执行清理、查看运行状态。
