# Windows Device 一键安装器调研与实施方案

## 1. 结论

可以把当前 Windows Device 的绝大部分 setup 流程收敛为一个幂等的 PowerShell 脚本，并进一步包装成签名的 `setup.exe`。

可完全自动化的部分包括：

- 探测 Windows 版本和 CPU 架构；
- 探测并复用兼容的 Node.js 22；
- 在不覆盖用户现有 Node.js 的前提下安装项目私有 Node.js 22；
- 探测并安装 Codex；
- 探测并安装或升级 Remote Codex；
- 写入 Relay 配置；
- 配置当前用户登录计划任务；
- 启动 Supervisor；
- 验证本地状态和 Relay 在线心跳；
- 对已完成步骤安全跳过，并在失败后重试。

不能由普通安装器替用户无感完成的部分有两个：

1. **Codex 用户认证。** 未登录时必须由用户在浏览器完成 ChatGPT 登录、输入设备码，或明确提供 API key/access token。安装器可以探测 `codex login status`，已登录则跳过，未登录则自动发起 `codex login` 并等待。
2. **Relay Device 授权。** 当前必须先在 Relay Portal 创建设备并获得长期 `rcd_...` token。最终产品不应把这个长期 token 固化到通用 EXE、下载 URL 或命令行参数中；应增加一次性 enrollment code。

推荐分两阶段实施：

- **阶段 A：签名的 `setup-windows-device.ps1`。** 最快落地，可复用和验证所有探测、安装、配置与回滚逻辑。
- **阶段 B：签名的 `RemoteCodexSetup.exe`。** EXE 只负责可信分发、UI、提权和调用同一套安装引擎，避免维护第二套行为。

## 2. 为什么不应只用 WinGet

WinGet 支持通过精确 package id 和 version 安装应用，也支持无交互参数，但不适合作为唯一基础：

- 并非所有精简、企业管控或损坏的 Windows 环境都能正常使用 WinGet；
- “Node.js LTS”随时间会切换大版本，不能保证仍为项目验证过的 Node.js 22；
- 系统级 Node MSI 可能覆盖 PATH 或与用户现有 nvm、Volta、系统 Node 冲突；
- 有些 installer 会触发 UAC，普通用户安装体验不一致；
- Codex 已有更合适的 OpenAI 官方独立安装器。

WinGet 可以作为可选的 Git 安装途径，但 Node.js 应由 Remote Codex bootstrap 自己管理版本和完整性。

参考：[WinGet install command](https://learn.microsoft.com/en-us/windows/package-manager/winget/install)。

## 3. Node.js 安装策略

### 3.1 推荐策略：兼容版本复用，否则安装私有 Node

探测逻辑：

1. 使用 `Get-Command node.exe` 查找现有 Node。
2. 执行 `node --version` 并解析 major version、架构和退出码。
3. 如果是可正常执行的 Windows x64 Node.js 22，直接复用。
4. 如果不存在 Node，安装项目私有 Node.js 22。
5. 如果存在 Node 20、24、nvm 或 Volta 管理的其他版本，不卸载、不覆盖，也不调整其全局 PATH；在 Remote Codex 私有目录并存安装 Node.js 22。

推荐私有布局：

```text
%LOCALAPPDATA%\RemoteCodex\
  runtime\node-v22.x.x-win-x64\
  app\remote-codex-<version>\
  downloads\
  logs\setup.log
```

Bootstrap 从 [Node.js 官方 v22 发布目录](https://nodejs.org/download/release/latest-v22.x/) 下载 `win-x64.zip`，校验项目发布 manifest 中固定的 SHA-256，解压后验证：

```text
node.exe --version
npm.cmd --version
```

这种方式不需要管理员权限，不修改用户已有 Node 安装，也能让计划任务始终使用确定的 `node.exe` 绝对路径。

### 3.2 为什么不优先静默安装 MSI

Node.js 官方也提供 x64 MSI，Windows Installer 支持 `/quiet` 和 `/norestart`。但是 MSI 通常需要提权，并会改变系统安装状态和 PATH。对于已经存在其他 Node 版本的电脑，这不满足“不破坏已有环境”的目标。

MSI 仅适合作为管理员明确选择的 `-InstallSystemNode` 可选模式。参考：[Microsoft msiexec options](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msiexec)。

## 4. Codex 安装与登录策略

### 4.1 安装探测

按以下顺序探测：

```powershell
Get-Command codex.exe -ErrorAction SilentlyContinue
Get-Command codex.cmd -ErrorAction SilentlyContinue
Get-Command codex -ErrorAction SilentlyContinue
```

找到后执行 `codex --version`。命令可正常运行时默认跳过安装；只有用户传入 `-UpdateCodex` 时才调用官方安装器更新。

找不到 Codex 时，下载并执行 OpenAI 官方安装器：

```powershell
irm https://chatgpt.com/codex/install.ps1 | iex
```

截至本调研，官方 Windows 安装器自身已经包含以下能力：

- 识别 Windows x64/ARM64；
- 从 `releases.openai.com` 获取 release metadata；
- 下载独立 Codex 包；
- 校验 SHA-256；
- 原子切换 current release；
- 将 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` 加入当前用户 PATH；
- 识别 npm/bun 管理的冲突安装。

Remote Codex bootstrap 不应复制这套下载逻辑，而应调用官方安装器并在完成后重新探测 `codex.exe`。

### 4.2 登录探测

执行：

```powershell
codex login status
```

退出码和输出表明已有有效认证时跳过。未登录时：

- 有桌面的普通 Windows：运行 `codex login`，等待浏览器 OAuth 完成；
- 浏览器回调不可用：运行 `codex login --device-auth`；
- 企业自动化：只在管理员明确配置的情况下，通过 stdin 使用 API key 或 Codex access token。

OpenAI 官方文档明确要求 ChatGPT 登录通过浏览器完成，并提供 device-code beta。安装器不能模拟用户账号登录。参考：[Codex authentication](https://learn.chatgpt.com/docs/auth)。

凭据由 Codex 保存在 OS credential store 或 `%USERPROFILE%\.codex\auth.json`。Bootstrap 不读取、不复制、不记录凭据内容。

## 5. Remote Codex 安装策略

### 5.1 版本必须固定

面向用户发布的 bootstrap 不应永久使用浮动的 `remote-codex@latest`。每个 bootstrap/EXE release 应包含经过 Windows CI 验证的精确版本，例如：

```text
remote-codex@0.11.45
```

安装时可以查询 npm registry 确认版本存在，但最终安装目标必须是 manifest 固定版本。npm 支持按精确 `<name>@<version>` 安装。参考：[npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/)。

### 5.2 私有安装优先于全局 npm

建议使用选定的 Node.js 绝对路径和私有 prefix：

```powershell
& $npmCmd install --global --prefix $remoteCodexAppRoot "remote-codex@$version"
```

随后验证：

```powershell
& $nodeExe "$remoteCodexPackageRoot\bin\remote-codex.mjs" --version
```

已有全局 Remote Codex 时：

1. 探测 `remote-codex --version` 和实际 package root。
2. 如果版本等于 manifest 目标、入口完整且使用兼容 Node.js，可以复用。
3. 如果版本较旧、入口损坏或依赖另一个不兼容 Node.js，则保留原安装，同时部署私有版本。

计划任务必须保存 `node.exe` 和 `remote-codex.mjs` 的绝对路径，不能依赖登录时可能变化的 PATH。

## 6. Relay 授权设计

### 6.1 当前可落地方案

第一版 PS1 接受以下二选一输入：

```powershell
./setup-windows-device.ps1 `
  -RelayUrl 'wss://relay.example.com' `
  -DeviceToken 'rcd_...' `
  -WorkspaceRoot 'D:\dev'
```

或者在交互模式下用 `Read-Host` 提示输入 token。脚本不得把 token 输出到日志。

由于参数可能进入 PowerShell history 或进程审计，`-DeviceToken` 只应作为过渡方案。更安全的交互输入应使用 `Read-Host`，或通过 stdin 传给 Remote Codex CLI。

### 6.2 最终方案：一次性 enrollment code

Relay Portal 创建设备后，不再直接要求复制长期 token，而是：

1. Relay 创建与用户、device、平台绑定的一次性 enrollment record。
2. 返回高熵 enrollment code，服务端只保存 code hash。
3. code 有效期建议 10 分钟，只允许成功交换一次。
4. Portal 提供 **Download Windows setup** 和 **Copy PowerShell setup**。
5. Bootstrap 通过 HTTPS 用 enrollment code 换取 Relay URL 和 device token。
6. Relay 原子标记 code 已使用。
7. Bootstrap 通过 stdin 将配置交给 Remote Codex，由现有 ACL 逻辑写入配置文件。
8. 长期 device token 永远不进入 URL、安装器文件、命令行参数或安装日志。

建议新增 API：

```text
POST /relay/bootstrap-enrollments
POST /relay/bootstrap-enrollments/exchange
```

第一条需要已登录 Relay 用户，第二条只接受一次性 code，并实施短 TTL、单次消费、速率限制和审计。

## 7. 幂等 PowerShell Bootstrap 设计

建议新增：

```text
scripts/windows/setup-relay-device.ps1
scripts/windows/RemoteCodex.Setup.psm1
scripts/windows/setup-manifest.json
```

入口参数建议：

```powershell
[CmdletBinding()]
param(
  [string]$RelayUrl,
  [string]$EnrollmentCode,
  [string]$DeviceToken,
  [string]$WorkspaceRoot,
  [int]$SupervisorPort = 45680,
  [switch]$InstallGit,
  [switch]$NoAutoStart,
  [switch]$UpdateCodex,
  [switch]$ForceRepair,
  [switch]$NonInteractive
)
```

脚本应兼容 Windows 自带的 Windows PowerShell 5.1，不依赖 PowerShell 7。

### 7.1 执行顺序

1. 建立 setup lock，阻止同一用户并发安装。
2. 创建 `%LOCALAPPDATA%\RemoteCodex\logs\setup.log`，对敏感字段统一脱敏。
3. 检查 Windows 11 x64、磁盘空间、TLS、Relay/Node/OpenAI/npm 网络可达性。
4. 检查当前是否有 Relay Supervisor 运行；记录状态但不立即停止。
5. 探测 Node.js；兼容则复用，否则安装私有 Node.js 22。
6. 探测 Codex；存在且可运行则跳过，否则调用官方安装器。
7. 运行 `codex login status`；未登录则启动用户登录流程。
8. 探测 Remote Codex；版本和入口正确则跳过，否则安装或修复私有版本。
9. 检查 `WORKSPACE_ROOT` 是否存在、是否为本地绝对路径、是否可读写。
10. 检查默认端口；被占用时给出占用进程并允许选择其他端口，不能静默杀进程。
11. 交换 enrollment code，或读取用户输入的 device token。
12. 通过 Remote Codex CLI 写入配置和 ACL。
13. 以绝对 Node/entry 路径创建或更新登录计划任务。
14. 启动 Supervisor。
15. 验证 `relay-supervisor status`、本地 health 和 Relay device heartbeat。
16. 输出不含秘密的安装摘要和日志路径。

### 7.2 每一步的 skip/repair 规则

| 项目         | 已满足                             | 部分满足或冲突                        | 缺失                   |
| ------------ | ---------------------------------- | ------------------------------------- | ---------------------- |
| Node.js      | 可执行的 x64 v22：复用             | 其他版本：保留并安装私有 v22          | 安装私有 v22           |
| Codex        | `--version` 成功：跳过             | 命令存在但损坏：官方 installer repair | 官方 installer install |
| Codex 登录   | `login status` 成功：跳过          | 凭据失效：重新登录                    | 启动登录               |
| Remote Codex | 目标版本且入口完整：复用           | 旧版或损坏：私有安装/更新             | 私有安装               |
| Relay 配置   | URL、device、root、port 一致：跳过 | 用户确认后更新并重启                  | 创建配置               |
| 计划任务     | action/trigger/path 一致：跳过     | 原子替换任务定义                      | 创建任务               |
| Supervisor   | 正在运行且配置一致：跳过           | 配置改变：优雅重启                    | 启动                   |

脚本重复执行必须得到同样的最终状态，不能重复创建设备、重复追加 PATH 或产生多个计划任务。

## 8. 当前代码需要补充的接口

为了让 bootstrap 不复制内部逻辑，建议先补齐以下 CLI 能力：

### 8.1 非交互配置入口

新增：

```text
remote-codex relay-supervisor configure --stdin
```

stdin 接受 JSON，CLI 负责：

- 校验 Relay URL、token、端口和 workspace root；
- 生成本地 admin/session secrets；
- 使用现有 `writePrivateJsonFile()` 和 Windows ACL 逻辑写配置；
- 不在 stdout、stderr 或异常中回显 token。

### 8.2 机器可读状态

新增：

```text
remote-codex relay-supervisor status --json
remote-codex relay-supervisor doctor --json
```

Bootstrap 不应解析面向人的英文日志文本。

### 8.3 计划任务脚本参数化

当前 `install-relay-supervisor-task.ps1` 使用 `Get-Command node.exe`。需要新增：

```text
-NodePath
-EntryPath
-ConfigPath
```

计划任务始终使用绝对路径，以支持私有 Node 和私有 Remote Codex 安装。

## 9. setup.exe 技术选型

| 方案                    | 优点                                                                   | 局限                                                                | 建议               |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------ |
| 签名 PS1                | 开发快、逻辑透明、容易迭代、适合 Portal 一键复制                       | 受 Execution Policy、AppLocker/WDAC 和企业策略影响；UI 较弱         | P0 首选            |
| WiX Burn EXE            | 原生 Windows bootstrapper，可链式处理 EXE/MSI、repair/uninstall 和 UAC | 标准 UI 不足以完成 enrollment、Codex 登录和在线验证，需要 custom BA | P1 可选            |
| 自包含 .NET/Go/Rust EXE | 可做完整 UI、下载、校验、重试和深链；不依赖已安装 Node                 | 工程和签名成本更高，需要维护安装生命周期                            | P1 推荐产品形态    |
| PS1-to-EXE 包装器       | 上手快                                                                 | 通常只是把脚本嵌入 EXE，不自动提高安全性、可信度或可维护性          | 不建议作为正式方案 |

[WiX Burn](https://docs.firegiant.com/wix/tools/burn/) 可以把 MSI 和 EXE prerequisites 串成单一安装体验。但 Remote Codex 的核心难点是动态环境探测、Codex OAuth、Relay enrollment 和在线验证，不只是串行执行几个 MSI，因此最终仍需要 custom bootstrapper application。

推荐的正式 EXE 是一个薄的、签名的自包含 bootstrapper：

- UI 收集 workspace root 和自动启动选项；
- 接受一次性 enrollment code；
- 显示每个步骤的 `Detected / Installed / Skipped / Needs action / Failed` 状态；
- 调用与 PS1 相同的 manifest 和 CLI 接口；
- 必要时启动 Codex 浏览器登录；
- 安装结束后显示 Relay Online 结果；
- 提供 Repair、Update 和 Uninstall。

## 10. 签名、完整性和秘密保护

### 10.1 代码签名

正式发布的 PS1 应使用受信任 CA 的 Authenticode certificate 签名；EXE 应使用稳定的 publisher identity 签名。自签名证书只适合内部测试。

Windows SmartScreen 会同时考虑 publisher reputation 和文件 hash reputation。未签名文件每个新版本都需要从零积累信誉；签名可以显示发布者并延续 publisher identity，但新证书或新文件仍可能短期出现提示。参考：[PowerShell script signing](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_signing) 和 [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

### 10.2 下载完整性

- Node.js URL、版本、SHA-256 写入每个 Remote Codex release 的签名 manifest；
- Codex 交给 OpenAI 官方 installer 下载并校验；
- Remote Codex 使用精确 npm version，并校验 npm package integrity；
- 所有下载只允许 HTTPS；
- 临时文件先写 `.partial`，校验后原子 rename；
- 失败或取消时删除不完整 staging，不删除用户已有工具。

### 10.3 秘密处理

- 不在 URL query、命令行参数、计划任务 action、setup 日志或错误文本中写长期 device token；
- enrollment code 短时、单次、服务端仅存 hash；
- token 通过 HTTPS response 保存在进程内存，并通过 stdin 交给 CLI；
- 配置落盘沿用 `%USERPROFILE%\.remote-codex` ACL 收紧逻辑；
- 日志层统一对 `TOKEN|PASSWORD|SECRET|AUTHORIZATION|controlToken` 脱敏。

## 11. Execution Policy 的现实边界

`Set-ExecutionPolicy -Scope Process ...` 只影响当前 PowerShell 进程，窗口关闭后失效，适合当前手工 setup。Microsoft 文档也明确说明 Process scope 只保存在当前进程环境中。

但是企业 Group Policy 的 `MachinePolicy`/`UserPolicy` 优先级更高，脚本不能靠 `-ExecutionPolicy Bypass` 绕过企业策略。正式方案应：

- 对 PS1 做 Authenticode 签名；
- 检测有效 Execution Policy 和 AppLocker/WDAC 拒绝；
- 给出 EXE installer 作为企业环境 fallback；
- 不永久修改 `CurrentUser` 或 `LocalMachine` Execution Policy。

参考：[PowerShell execution policies](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies)。

## 12. 回滚与卸载

安装失败时：

- 不卸载或修改探测到的用户 Node、Codex、Git；
- 停止本次新启动的 Supervisor；
- 删除未完成的私有 staging 目录；
- 恢复旧计划任务和旧 Relay 配置；
- 保留脱敏 setup log；
- 如果 enrollment code 已交换但最终失败，撤销新 device token 或允许有限时间内 repair 重试。

正常卸载分两级：

- **Remove runtime**：停止 Supervisor，删除计划任务和私有 Node/Remote Codex，保留 workspace、Codex 登录、Relay 配置和数据库。
- **Purge device data**：在用户二次确认后额外删除 `%USERPROFILE%\.remote-codex`，并通过 Relay API 撤销 device token。

## 13. 测试矩阵

### 13.1 PowerShell 单元测试

使用 Pester 覆盖：

- 命令不存在、命令损坏和路径带空格；
- Node 22 已存在；
- Node 20/24 已存在但不应被覆盖；
- Codex 已存在、缺失、登录失效；
- Remote Codex 目标版本、旧版本、损坏安装；
- token、URL、workspace root 和端口校验；
- 计划任务存在、过期、路径改变；
- 下载重试、hash 不匹配、磁盘不足和网络中断；
- 日志中不存在任何 secret。

### 13.2 Windows CI

在 `windows-2022` runner 上增加 bootstrap smoke：

- 使用隔离 PATH 和临时 `%LOCALAPPDATA%` 模拟无环境安装；
- 预置 Node 22 后重跑并断言 skip；
- 预置另一个 Node major 后断言并存私有 Node 22；
- 使用 fake Codex 验证登录探测；
- 重复执行两次并断言没有额外 task、PATH 或配置变化；
- 执行 install、status、stop、start、uninstall、repair 全生命周期。

### 13.3 Windows 11 实机

发布前至少验证：

- Windows 11 x64 干净 VM；
- Defender、SmartScreen 和默认防火墙开启；
- 普通用户、无管理员 PowerShell；
- 真实 Codex browser login 和 device-code login；
- Relay enrollment、创建 thread、重载 transcript 和 follow-up；
- 重启并登录后设备自动 Online；
- 安装中断后的 repair；
- 已有 Node/npm/Codex/Remote Codex 的升级兼容。

## 14. 分阶段实施清单

### P0：脚本 MVP

- [ ] 新增 `setup-windows-device.ps1`、模块和签名 manifest。
- [ ] 实现 Node/Codex/Remote Codex/登录/任务的探测与 skip。
- [ ] 使用私有 Node.js 22 和私有 npm prefix。
- [ ] 为现有任务脚本增加绝对路径参数。
- [ ] 新增 `configure --stdin`、`status --json` 和 `doctor --json`。
- [ ] 增加 Pester 和 Windows CI 幂等 smoke。
- [ ] Portal 的 **Copy setup > Windows** 改为下载并执行稳定 bootstrap。

### P1：安全 enrollment

- [ ] Relay 数据库和 API 增加短时、单次 enrollment code。
- [ ] Portal 增加 **Download Windows setup**。
- [ ] Bootstrap exchange code，不再接收长期 token 参数。
- [ ] 增加撤销、速率限制、审计和失败 repair 语义。

### P2：正式 Windows Device Manager EXE

- [x] 选择自包含 .NET 8 WinForms 托盘应用。
- [x] 复用现有 Relay Supervisor CLI、配置 ACL 和生命周期状态模型。
- [x] 实现环境探测、私有 Runtime 安装、Codex 登录、Device 配置、托盘常驻、换 Token、自动重连和当前用户开机启动。
- [x] 增加 Windows CI 单文件构建、自检、SHA-256 artifact 和可选 Authenticode 签名。
- [ ] 在 Windows 11 x64 实机验证 SmartScreen、Defender、真实 Codex 登录、Relay Online、重启恢复和部分环境兼容矩阵。
- [ ] 增加一次性 enrollment、应用内 update 和独立 uninstall UI。

实现和实机测试步骤见 [Remote Codex Windows Device Manager](windows-device-manager.zh.md)。

## 15. 验收标准

一键安装功能只有满足以下条件才可标记完成：

- 全新 Windows 11 x64 从一个入口完成依赖安装、Codex 登录引导、Relay enrollment、后台启动和 Online 验证；
- Node.js 22 已存在时不重复安装；
- 其他 Node.js 大版本存在时不卸载、不覆盖、不改变其默认 PATH；
- Codex 和 Remote Codex 已存在且健康时明确显示 `Skipped`；
- 脚本连续运行两次不会重复创建设备、计划任务或配置；
- device token、Codex credential 和 session secret 不出现在 URL、进程参数、任务定义和日志；
- 任一步失败均有可重试状态和明确日志，不留下半安装服务；
- Windows 重启并由同一用户登录后，设备自动恢复 Online；
- 安装、修复、升级和卸载均有 Windows CI 与 Windows 11 实机证据。

## 参考资料

- [Remote Codex Windows Device 从零安装指南](windows-device-setup.zh.md)
- [OpenAI Codex CLI](https://learn.chatgpt.com/docs/codex/cli)
- [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Node.js 22 release files](https://nodejs.org/download/release/latest-v22.x/)
- [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/)
- [WinGet install command](https://learn.microsoft.com/en-us/windows/package-manager/winget/install)
- [PowerShell execution policies](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies)
- [PowerShell script signing](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_signing)
- [Windows Installer command line](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msiexec)
- [Task Scheduler logon trigger](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasktrigger)
- [WiX Burn bundles](https://docs.firegiant.com/wix/tools/burn/)
- [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
