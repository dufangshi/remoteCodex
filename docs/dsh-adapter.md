# DSH adapter：模型发现、New Chat 与 harness 面板

分支：`feat/dsh-adapter`。共享 UI 分支：`feat/dsh-harness-panel`，配套提交 `555afc80e524a7a20a954fa58cad3e95b61e2010`。

## 修复的实际问题

- New Chat 中隐藏的 radio 使用绝对定位，但 label 没有定位上下文。点击列表底部的 DSH 会让浏览器把焦点滚动到错误的位置。外层 grid 弹窗和内层固定高度滚动表单又放大了裁剪、空白问题。现在 radio 定位在自己的选项内；弹窗用 flex 限制表单高度，紧凑 Agent 列表缩短，并使用动态视口边界。
- 旧 DSH `0.1.2-alpha.2` 的 ACP 初始化早于异步 provider 注册。实测同一进程立即创建会话只有 3 个 DeepSeek 模型，稍后创建才有 Grok、Gemma、WSL。Remote Codex 读取并缓存第一份结果，因此列表不全。单纯更新 DSH 或固定 sleep 都不是可靠的就绪协议。
- 标准 ACP 模型配置只附带**当前模型**的 reasoning 选项。此前 Remote Codex 将这些选项复制给所有模型，并优先选择 medium/第一个选项，导致 DeepSeek 默认 high 变成 off，还给 Grok Build 等模型显示错误等级。

## 实现边界

`crates/runtime/src/acp/deepseek.rs` 将随 runtime 打包的 `deepseek-plugin.mjs` 通过 DSH 官方 `--patch` 机制插入 **ACP 所属的同一个进程**。插件等待 launcher 的 `appReady`，然后读取 DSH 原生 LLM catalog、每个模型的 reasoning 能力，以及 Loader 插件清单。

Rust 在收到就绪快照后才发送 ACP initialize/session-new。消息、工具、权限、取消、恢复、模型修改仍走现有 ACP 连接，没有新增模型会话控制协议，也没有另开 DSH Web 服务。

发现通道只使用随机本地端口和一次性 token，限制响应大小、连接读取与启动时间；补丁存于临时私有目录，跟随会话释放。快照按字段白名单生成，不导出插件配置、环境或凭据。

- 模型 ID 保留 DSH 的不透明 JSON 字符串 `[providerId, modelId]`，界面名称带 provider，避免同名模型混淆。
- 每个模型分别读取 reasoning 能力和默认值。无 reasoning 的模型不显示下拉框；空字符串仍是合法的 ACP provider-default 值。
- DSH 模型设置出错向调用者返回错误，不再声称已切换到一个未被 harness 接受的模型；新会话模型设置失败会关闭临时进程。模型探测结束也显式关闭 ACP 进程，防止通知转发任务的引用导致进程累积。
- `/harness` 是共享 toolbox 的新动作，通过宿主回调打开面板。它不会被当成普通 prompt 写入聊天。其他 adapter 可使用同一个入口。
- 目前 DSH 面板可修改模型与 reasoning，读取当前 ACP 进程在启动时的插件清单。清单可搜索，明确标注只读与 profile；不提供安装、卸载、开关插件等进程级变更。

本机 DSH CLI 已从源码入口 `0.1.2-alpha.2` 更新为独立安装的官方 npm `0.1.5-rc.1`。原源码检出及未提交修改保留，原启动脚本也有备份。没有重启正在运行的原生 Web 服务或正式 Remote Codex Supervisor。此 adapter 的就绪接口以 `0.1.5-rc.1` 验证；更旧版本可能缺少必要的 launcher 服务，启动失败会给出升级提示。

## 原生运行模式和组件复用的结论

DSH 原生的标准、PTC、极简、创造模式是 **agent preset / 插件组合**，不等同于 Remote Codex 的 plan 模式。官方 ACP profile 不组装 preset roster，也未公开 session modes、commands 或插件管理 remotes。即使在原生 Web 内，preset 也只能在会话尚未产生消息或工具调用时切换。

因此这次没有伪造 mode 菜单，也隐藏了 DSH 上此前错误显示的 `/plan` 能力。要真正接入 preset，下一步应让 DSH ACP 在创建/恢复会话时组合并持久化 preset，使用标准 `configOptions` 或 session modes 广告能力，并拒绝非空会话切换；Remote Codex adapter 再映射这些已协商的配置。只在前端增加几个选项无法让这些配置生效。

原生插件清单组件是 React，注入 `list()`、翻译、preset 名称解析等依赖，技术上可以包装复用。但它依赖 DSH 的 UI primitives、slots 与原生 inventory 数据结构，不是可直接 iframe 到当前 ACP 会话的页面。本次用相同 Loader 数据实现小型只读列表，避免引入整套 DSH Web runtime。未来若 DSH 发布稳定的嵌入式组件入口，可以替换此列表，保持 adapter 数据接口不变。

依据（本地检出比对 `dsh-v0.1.5-rc.1`）：

- [DSH ACP 支持范围](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/acp/acp/README.md)
- [ACP 会话创建与 profile 组合](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/acp/acp/src/index.ts)
- [Preset 生命周期和切换限制](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/preset/agent-presets/README.md)
- [原生插件清单组件的注入接口](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx)

## 验证与复现

`cargo test --workspace`、Web typecheck、发现插件的 Node 回归和共享 toolbox 的 5 个 Vitest 用例通过。真实 DSH 的测试使用隔离 Supervisor 数据库、workspace 和 DSH_HOME，不连接正式 relay。

桌面 Chromium 的真实 E2E：New Chat 选择 DSH、自定义 Grok 4.6、xhigh；完整模型列表与各模型默认等级；弹窗边界与标题/按钮可见；`/harness` 打开原生插件清单并实际修改 reasoning；写 C 程序、编译执行；断开并恢复后读取外部新增文件、通过工具复制到新文件，验证真实恢复后的操作。

另用实际 API 验证 WSL 模型的 `xhigh → 空值 provider default` 同时反映在 ACP 配置和数据库；无效模型被拒绝，旧模型保持。真实生成测试验证的是 DSH/Grok 4.6 链路，不代表逐一调用了全部 provider。

```sh
cargo test --workspace
node --test scripts/dsh-discovery.test.mjs
pnpm typecheck
pnpm --dir remote-codex-thread-ui --filter @remote-codex/thread-ui exec vitest run src/components/composer/composerToolbox.test.ts

# 在隔离目录准备 DSH 的 settings.yaml 和凭据；不要使用正在工作的 DSH_HOME。
# 仅显式 opt-in 时调用真实模型。测试要求配置 grok-sub2api/Grok 4.6。
E2E_REAL_DSH=1 E2E_DSH_HOME=/absolute/isolated-dsh-home \
  E2E_API_PORT=18875 E2E_WEB_PORT=15179 \
  E2E_WORKSPACE_ROOT=/absolute/isolated-workspaces \
  pnpm exec playwright test e2e/dsh.spec.ts --project=desktop-chromium
```

本分支未变更 runtime 版本号。正式部署需配套主仓库和共享 UI 提交；共享 UI 由 relay 服务，不能只重启 device Supervisor。
