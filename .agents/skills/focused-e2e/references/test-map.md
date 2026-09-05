# 测试选择地图

以下是当前项目的入口，不是要求每次执行的清单。先找最接近改动的行，再查看源码和 skip 条件；标题变化时用 `rg -n 'test\(|test\.describe|test\.skip' e2e/目标文件.spec.ts` 查找。

## 按风险找用例

| 风险 | Spec | `--grep` 标题片段 / 设备选择 |
| --- | --- | --- |
| activity 展开状态 | `e2e/runtime-bubble-regressions.spec.ts` | `keeps expanded activity and command groups` |
| 刷新后的文字、续流、旧快照 | 同上 | `preserves refreshed assistant text` |
| 运行中/完成后的模型、effort、token、费用 | 同上 | `turn usage summary regressions` |
| composer 运行中菜单点击和边界 | `e2e/composer-menus.spec.ts` | `composer menus stay in bounds`；按涉及的桌面/触摸行为选设备 |
| 模型列表在窄屏、矮视口中可用 | 同上 | `an expanded model list` |
| workspace → thread → 第一条回复接线 | `e2e/phase2.spec.ts` | `receive a hello response` |
| UI 停止运行中的 turn | 同上 | `can interrupt a running turn` |
| 手机 thread 导航 | 同上 | `collapsible top sidebar`；仅 mobile 有效 |
| 文件操作 | `e2e/files-browser.spec.ts` | `lists, previews, writes, and moves files` |
| API interrupt | 同上 | `interrupts a long fake turn via API`；只选一个 project |
| 插件、composer 权限、导出 | `e2e/product-ui-regressions.spec.ts` | 按需选 `terminal plugin` / `prompt toolbar` / `Full access` / `thread exports`；这些用例只跑 desktop |
| workspace / thread / import 表单 | 同上 | 按需选 `workspace rows` / `new workspace` / `new thread` / `import supports` / `import blocks` |
| 全站响应式布局 | 同上 | `core product routes reflow`；desktop 内已覆盖多宽度、多路由，勿再复制整套 mobile 矩阵 |
| relay 页面、登录返回路径、菜单、错误恢复 | `e2e/relay-product-ui-regressions.spec.ts` | 按需选 `Portal restores` / `Portal rejects` / `logout fails` / `controlled retry` / `compatibility state` / `Devices keeps`；API mock，不需要真实 relay |
| relay 响应式布局 | 同上 | `relay product routes reflow`；desktop 内已覆盖多宽度、多路由 |
| relay 实际转发边界 | `e2e/relay-mode.spec.ts` | 一个 API 场景，只选 desktop；独立服务，先检查下方 fixture 条件 |

分组、文字合并、计费等组合问题，先定位这些便宜层级：

- 主 Web：`apps/supervisor-web/src/pages/threadDetailModel.test.ts`。
- 共享 UI 独立仓库：`remote-codex-thread-ui/packages/thread-ui/src/components/ThreadTimeline.test.tsx`、`components/timeline/`、`components/composer/` 内对应测试。
- Rust：`crates/runtime/tests/live_history.rs`、`usage.rs`、`acp_turn.rs`、`crates/supervisor/tests/http_e2e.rs`。保留 `AGENTS.md` 要求的 workspace 测试，但不用因此补全量浏览器测试。

## 可以直接缩小范围的命令

从主仓库根目录执行。先确认 binary 和依赖就绪；例子里的端口不是项目固定端口，冲突时换成空闲端口。

```bash
# 只列出一个相关测试；不启动浏览器/服务，不代表测试通过
pnpm test:e2e e2e/runtime-bubble-regressions.spec.ts --grep 'turn usage summary regressions' --project=desktop-chromium --list

# 一条费用 UI 回归，桌面；没有响应式改动时无需再跑 mobile
E2E_API_PORT=18887 E2E_WEB_PORT=15173 REMOTE_CODEX_E2E_FAKE_RUNTIME=1 \
  pnpm test:e2e e2e/runtime-bubble-regressions.spec.ts \
  --grep 'turn usage summary regressions' --project=desktop-chromium

# 移动端模型菜单问题：直接验证问题设备和相关测试
E2E_API_PORT=18887 E2E_WEB_PORT=15173 REMOTE_CODEX_E2E_FAKE_RUNTIME=1 \
  pnpm test:e2e e2e/composer-menus.spec.ts \
  --grep 'an expanded model list' --project=mobile-chromium

# 仅数据合并逻辑：先用单元测试，无需启动 Web E2E
pnpm --filter @remote-codex/supervisor-web test src/pages/threadDetailModel.test.ts
```

运行同一份测试在桌面和手机上确有必要时，显式加两个 `--project`；多场景共享同一 setup 时可一次指定多个相关文件和精确的 `--grep`，减少重复启动。多文件搭配 grep 时检查它没有意外排除应跑场景。

## 特殊套件和启动陷阱

- **真实 ACP**：`harness-acp.spec.ts` 没有 opt-in gate，自启 supervisor 并强制 `REMOTE_CODEX_E2E_FAKE_RUNTIME=0`。包含 codex/claude/grok/deepseek 的真实短轮和中断场景，单测试 timeout 可达 10 分钟。CLI 存在不等于账号可用。只在该 harness 边界需要真实验证时选具体 harness/动作和一个 project；普通 UI 不进入此文件。
- **独立 relay**：`relay-mode.spec.ts` 自启 relay + supervisor，使用 `E2E_RELAY_PORT` / `E2E_RELAY_SUPERVISOR_PORT`（默认 18788/18789），不同于通用 Web 端口。读当前 fixture 的密码、token 和数据目录配置；审计时固定 `admin/admin` 已不满足 relay 密码规则。若尚未修复该 fixture，先解决或报告，不反复等待 healthz，更不为通过测试放宽产品密码校验。
- **真实/定制环境开关**：通用 Playwright webServer 启动命令硬编码 fake=1。仅给测试加 REAL/ACP 开关不代表服务已切换到它需要的环境；需按该 spec 准备专用服务，不修改本机生产服务来凑环境。

## 跳过的测试不算覆盖

| 文件/分组 | 当前条件 |
| --- | --- |
| `composer-caret.spec.ts` | 整组无条件 skip；caret 优先在共享 thread-ui 包测试 |
| `relay-shared-actions.spec.ts` | 整组无条件 skip，旧 TS bootstrap mock |
| `runtime-bubble-regressions.spec.ts` 的 `runtime bubble regressions` | 仅这个旧 describe 无条件 skip；后面的 usage / live activity 两组可运行 |
| `phase4-running-turn-queued-continuation.spec.ts`、`phase5-slash-command-parity.spec.ts` | 需 `REMOTE_CODEX_REAL_BACKEND_E2E=1` 及相应真实 backend |
| `acp-codex-parity.spec.ts` | 需 `REMOTE_CODEX_REAL_ACP_E2E=1`；真实多轮流程，10 分钟 timeout |
| `acp-core-capability.spec.ts` | 需 `REMOTE_CODEX_ACP_CORE_E2E=1` 和匹配 `fixture-fast` / `FAKE_ACP_PARTIAL_1` 的 custom ACP fixture，不能用普通 fake runtime 冒充 |
| `runtime-install-availability.spec.ts` | 需 `REMOTE_CODEX_RUNTIME_INSTALL_E2E=1`、CLI/npm shims 和 state file；不用于普通 UI 回归 |

发现地图与源码不一致时，以源码为准并只更新受影响的条目。
