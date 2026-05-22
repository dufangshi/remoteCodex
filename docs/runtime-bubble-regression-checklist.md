# Runtime Bubble Regression Checklist

本文件跟踪 3 个当前必须修复的运行时展示问题。每个 checkpoint 只有在代码、测试和当前行为证据都满足后才能打钩；如果后续 e2e 或回归测试发现问题，必须去掉对应勾选并继续修复。

## 1. Codex Subagent 气泡识别

- [x] 确认 Codex app-server 暴露的 subagent/collab agent item 类型和字段。
- [x] 将 Codex `collabAgentToolCall` 映射为专用 `agentToolCall` 历史项，而不是普通 `toolCall`。
- [x] 确保 subagent live item 在运行中和完成后都能显示专用气泡。
- [x] 确保 subagent 详情仍支持延迟加载，避免大 payload 直接撑爆 timeline。
- [x] 为 Codex subagent 历史项映射补充单元测试。
- [x] 为 timeline 渲染补充或复用覆盖专用 agent tool call 气泡的测试。

## 2. Codex 最终文本消失后卡在运行中

- [x] 复核 Codex streaming delta、liveItems、terminal event、detail refresh 的状态合并链路。
- [x] 找到最终文本先出现、后被 stale live/detail 状态覆盖成 `...` 的原因。
- [x] 修复前端状态合并，禁止较旧或内容更短的 running live agent item 覆盖较新的最终文本。
- [x] 修复 terminal event 后清理 live state 的时机，避免刷新前短暂或永久丢失最终文本。
- [x] 补充回归测试，覆盖“先收到最终文本，再收到 stale running detail/liveItems”的情况。

## 3. Claude Plan Mode 提问组件不可见

- [x] 复核 Claude `AskUserQuestion` 到 `requestUserInput` pending request 的 API 映射。
- [x] 确保 plan mode 提问不会被 suppress 掉后缺少可见 pending request 卡片。
- [x] 确保 pending request 有稳定 turn 锚点；无法锚定时也要作为 unanchored 卡片显示。
- [x] 补充 API 或前端测试，覆盖 Claude plan mode 提问可见且可回答。

## 4. 验证

- [x] 运行 Codex history item 相关测试。
- [x] 运行 Claude runtime/request 相关测试。
- [x] 运行 supervisor web timeline/detail 相关测试。
- [x] 做 e2e 验证，确认三个问题都在真实页面行为中修复。
- [x] e2e 如发现任何回归，继续修复并重新验证到通过。
