# Windows 11 实机验证记录

验证日期：2026-08-05（America/Toronto）

## 结论

本次在原生 Windows 11 x64 和 Node.js 22 x64 环境完成了 Relay Supervisor 的源码、生产包、fake Relay、真实 Codex、前台生命周期、Windows 后台生命周期和 Task Scheduler 门禁。验证过程中发现的 Windows 路径、SQLite 句柄、平台相关测试和外部 thread-ui 声明产物问题已直接修复并增加或修正回归覆盖。

以下本机门禁通过：

- `pnpm build`；
- `pnpm typecheck`；
- backend/platform tests；
- `pnpm verify:package`；
- `pnpm verify:relay`；
- 原生 `codex.exe` 和 npm `codex.cmd` 的真实 app-server 主链路；
- thread 创建、prompt、WebSocket 流状态、transcript reload、follow-up；
- Relay 中断、重启和 Supervisor 自动重连；
- 前台 Supervisor 认证控制通道优雅退出且端口、子进程无残留；
- Windows 后台 `start/status/stop`；
- 当前用户 Task Scheduler 安装、任务动作启动、身份验证、停止和卸载。

Microsoft Defender 实时防护在本机验证前已经关闭，无法声明“Defender 默认开启”门禁通过。连续 Windows CI、required-check 仓库设置和人工键盘 `Ctrl+C` 控制台事件不属于本次本机自动验证结果，详见“未解决门禁”。

## 测试环境

| 项目           | 结果                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| 操作系统       | Microsoft Windows 11 专业版 25H2                                                                 |
| 内核/Build     | `10.0.26200.0` / Build `26200`                                                                   |
| 架构           | x64 operating system，x64 process                                                                |
| 机器           | Micro-Star International `MS-7D69`                                                               |
| Node.js        | `v22.23.2`，`process.arch=x64`                                                                   |
| npm            | `10.9.8`                                                                                         |
| pnpm           | `10.11.1`                                                                                        |
| Codex CLI      | `codex-cli 0.146.0`                                                                              |
| Git            | `2.53.0.windows.1`                                                                               |
| Shell          | 原生 Windows PowerShell                                                                          |
| 主仓库         | `remoteCodex`，`codex/windows-relay-supervisor`，基线 `d2d533f0200fa72daf4ae5391346bd86798bb3fb` |
| thread-ui 仓库 | `remote-codex-thread-ui`，`main`，基线 `4ed18407fccff87bc3eaeba32fe9312d7397186c`                |

没有使用 WSL、Git Bash、tmux、Terminal、PTY 或 ConPTY 作为运行或验证依赖。

本机原有 nvm-for-windows 在执行 `nvm install 22` 时下载了 ia32 Node，并在切换符号链接的提权步骤阻塞。为避免用错误 ABI 验证，最终使用 Node 官方 `node-v22.23.2-win-x64.zip` 解压到 `C:\dev\.tools\node-v22.23.2-win-x64`，所有门禁均显式将该目录置于 `PATH` 首位。随后安装固定的 `pnpm@10.11.1` 和 `@openai/codex`。

依赖安装命令：

```powershell
pnpm install --frozen-lockfile
pnpm --dir ..\remote-codex-thread-ui install --frozen-lockfile
pnpm --dir ..\remote-codex-thread-ui --filter @remote-codex/thread-ui build
```

`better-sqlite3@12.10.0` 使用 Node 22 Windows x64 预编译产物安装成功，不需要 Visual Studio C++ Build Tools。PTY 是 optional dependency；生产包 smoke 会删除它并验证 Supervisor 仍可启动。

## 自动门禁结果

| 顺序 | 命令                                                                 | 结果                                                                                               |
| ---- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1    | `pnpm build`                                                         | 通过；全部 workspace 构建成功                                                                      |
| 2    | `pnpm typecheck`                                                     | 通过；全部 workspace 无类型错误                                                                    |
| 3    | `pnpm -r --filter '!@remote-codex/supervisor-web' --if-present test` | 通过                                                                                               |
| 4    | `pnpm verify:package`                                                | 通过；输出 `Package smoke passed for remote-codex 0.11.42 on win32.`                               |
| 5    | `pnpm verify:relay`                                                  | 通过；最终复跑 device `b49ca1f7-c483-47f6-88cb-419223749d21`，thread `a7328dad-087b-432e-890c-c8654ce89990` |

backend/platform tests 的主要结果：

- Relay Server：6 files，83 tests 通过；
- Supervisor API：15 files 通过、1 file 为平台 skip；203 tests 通过、3 tests skip；
- Codex：9 files，55 tests 通过；
- Claude：41 tests 通过；
- OpenCode：27 tests 通过；
- incus-host-agent：34 tests 通过；
- config：9 tests 通过；
- process-runtime：9 tests 通过；
- workspace：15 tests 通过；
- Android WebThread：12 tests 通过；
- iOS WebThread：45 tests 通过。

Windows 上跳过的是 POSIX Unix-socket lifecycle 测试和两个 Terminal 正向测试。Windows named-pipe lifecycle、Terminal unavailable、无法重新启用 Terminal 的行为分别由真实前后台 E2E 和 Windows capability/API tests 覆盖。

## 真实 Codex E2E

可复跑脚本：

```powershell
$env:REMOTE_CODEX_REAL_CODEX_EXE = '<native codex.exe absolute path>'
$env:REMOTE_CODEX_REAL_CODEX_CMD = '<npm codex.cmd absolute path>'
node scripts\windows\validate-real-codex.mjs
```

脚本使用临时 Relay 数据、Supervisor 数据库、状态文件、日志、命名管道和包含空格的 workspace。凭证只从当前用户已有的 Codex 登录读取，脚本不输出 token 或 API key。

### `codex.exe` 前台主链路

- `codex.exe --version` 通过；
- 通过 `remote-codex relay-supervisor run` 启动真实 Codex app-server；
- 创建 workspace 和 Codex thread；
- 第一轮 marker：`WINDOWS_REAL_CODEX_EXE_OK`；
- Relay WebSocket 收到该 thread 的 `thread.updated` / `running` 流状态；
- GET reload 后 transcript 保留第一轮内容；
- 强制停止并重启 Relay Server，Supervisor 在原端口自动重连；
- 重连后发送 follow-up marker：`WINDOWS_REAL_CODEX_EXE_FOLLOWUP_OK`；
- 最终 transcript 有 2 个 completed turns，第一轮内容仍存在；
- 通过 authenticated named pipe 请求 shutdown，前台 CLI 正常退出，HTTP 端口关闭；
- device `ba9a30f6-8be4-4e77-b69d-456004e19dc8`；
- thread `b42a863c-87d2-4095-8a22-abaccb670f24`。

### `codex.cmd` 后台主链路

- `codex.cmd --version` 通过；
- `remote-codex relay-supervisor start` 成功并写入隔离状态；
- `remote-codex relay-supervisor status` 返回 `State: running` 和正确实例身份；
- 通过该后台实例创建真实 Codex thread 并得到 marker `WINDOWS_REAL_CODEX_CMD_OK`；
- `remote-codex relay-supervisor stop` 通过认证命名管道优雅关闭；
- 端口、Supervisor 和 Codex app-server 进程无残留；
- thread `df52a44e-29d5-49f5-b9c4-4e1302c6e5fd`。

## Task Scheduler

使用临时任务名 `Remote Codex Relay Supervisor Validation` 执行：

1. `install-relay-supervisor-task.ps1` 注册任务并立即启动 Supervisor；
2. 验证任务 action 为 Node 22 x64 + `bin\remote-codex.mjs relay-supervisor start`；
3. 验证 principal 为当前用户、`Interactive`、`Limited`；
4. `status` 验证实例身份后执行 `stop`；
5. 调用 `Start-ScheduledTask`，任务动作再次启动 Supervisor；
6. 轮询 `status` 直到 `State: running`，随后再次 `stop`；
7. 卸载任务并使用 `-PurgeData` 删除本次测试前不存在、由测试新建的 `%USERPROFILE%\.remote-codex`。

最终确认任务不存在、数据目录不存在，并且没有匹配 `relay-supervisor` 或 `app-server` 的残留 Node/Codex 进程。删除的数据只属于本次临时验证，使用 `-PurgeData` 后不可恢复。

## 发现并修复的问题

1. Codex 图片输入 tests 硬编码 `/tmp` 路径。改为 `path.resolve`/`path.join`，覆盖 Windows 绝对路径。
2. RelayStore 没有公开关闭 SQLite，Relay Server 关闭钩子也未关闭 store。新增 `RelayStore.close()`，生产 `onClose` 调用它，相关测试 fixture 在删除临时目录前关闭句柄。
3. Supervisor relay tunnel 和管理员认证配置原本在创建数据库后才完成校验，配置失败会在 Windows 遗留打开的 SQLite。将两类纯配置校验都提前到 migration/database 创建之前，并增加无效配置不创建数据库文件的回归断言。
4. Supervisor tests 在 Windows 执行 Terminal 正向用例。POSIX Terminal 用例改为 Windows skip，已有 Windows unavailable/API 用例继续执行。
5. Git repo name 推断没有按反斜杠分割，Windows 本地 bare repo clone 被错误拒绝。分隔规则增加 `\\`，集成 clone test 在 Windows 通过。
6. 一个 Claude import test 替换 Fastify app 前未关闭旧 app。先 `app.close()`，消除 SQLite 句柄泄漏。
7. config development defaults test 隐式依赖宿主平台。POSIX defaults 用例显式传入 `linux`，Windows defaults 保持独立覆盖。
8. workspace symlink test 需要 Windows 管理员 symlink 权限。Windows 改用普通用户可创建的 directory junction，并验证越界被 `path_outside_root` 拒绝。
9. OpenCode 工作区内相对路径在 Windows 输出反斜杠。仅对成功相对化的路径统一为 `/`，工作区外绝对路径保持原样。
10. `remote-codex-thread-ui` 已提交的 `index.d.ts` 引用一个被 `dist/` ignore 规则漏掉的声明分块。允许跟踪 `packages/thread-ui/dist/**` 并补入 `workspace-panel-B3jiJM-z.d.ts`，干净 checkout 的主仓库 typecheck 不再退化为隐式 `any`。

## 未解决门禁

| 门禁                          | 状态         | 原因/下一步                                                                                                                                                                                  |
| ----------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Defender 默认开启重复关键流程 | 未完成       | `Get-MpComputerStatus` 显示 AM、Antivirus、RealTimeProtection、BehaviorMonitor、IOAV、NIS 全部为 `False`。需要在 Defender 默认开启的干净 Windows 11 VM 重跑 package smoke 和真实 Codex E2E。 |
| 人工键盘 `Ctrl+C`             | 未单独完成   | 本次前台进程通过同一 production shutdown path 的 authenticated named pipe 优雅退出并验证无残留；仍建议在交互式 PowerShell 手工按一次 `Ctrl+C`。                                              |
| Windows CI 连续 10 次         | 本机不可完成 | 需要触发并观察 GitHub Actions `platform-compatibility.yml` Windows job。                                                                                                                     |
| Windows required check        | 本机不可完成 | 需要仓库管理员在 GitHub branch protection 中配置。                                                                                                                                           |
| Windows 11 干净 VM            | 部分完成     | 当前是 Windows 11 实机，但不是新建干净 VM；生产 tarball 的全新目录安装已通过。                                                                                                               |

除上述外部/环境门禁外，本次请求中的原生 Windows 实机功能链路均已通过。
