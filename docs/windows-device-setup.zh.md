# Windows Device 从零安装指南

本文说明如何把一台没有开发环境的 Windows 电脑配置成 Remote Codex Relay Device。完成后，该电脑上的 Relay Supervisor 会主动连接公网 Relay，并允许已授权的 Web 或移动端访问这台电脑上的工作区和 Codex 会话。

正式图形化入口已经实现，优先使用 [Remote Codex Windows Device Manager](windows-device-manager.zh.md)。它是自包含单文件 EXE，能够探测并补齐 Node.js、Codex 和 Remote Codex，提供托盘常驻、换 Token、自动重连和当前用户开机启动。本文保留手工 PowerShell 流程，供排障、审计和受管环境使用。

## 1. 当前支持范围

当前原生 Windows 首版支持范围为：

- Windows 11 x64；
- Node.js 22 LTS；
- 原生 Codex provider，支持 `codex.exe` 和 npm 产生的 `codex.cmd`；
- 当前用户主目录或其他本地磁盘上的工作区；
- Relay WebSocket 模式；
- 当前用户登录后通过 Windows Task Scheduler 自动启动。

不需要安装 WSL、tmux、Git Bash、ConPTY 或 Visual Studio C++ Build Tools。原生 Windows 暂不提供网页 Terminal，也不承诺 Claude Code、OpenCode、UNC 工作区、Windows ARM64 或未登录用户的系统服务模式。

## 2. 安装 Node.js 22

打开 [Node.js 22 官方发布目录](https://nodejs.org/download/release/latest-v22.x/)，下载文件名以 `x64.msi` 结尾的 Windows 安装包并完成安装。

不要仅根据“Latest LTS”按钮安装其他 Node.js 大版本。Remote Codex 当前 Windows 验证基线是 Node.js 22。

安装完成后关闭并重新打开 PowerShell，然后执行：

```powershell
node --version
npm --version
```

`node --version` 应输出 `v22.x.x`。

Git 不是启动 Relay Supervisor 的硬性依赖，但管理代码仓库通常需要 Git。可选安装命令：

```powershell
winget install --id Git.Git -e --source winget
```

## 3. 安装并登录 Codex

打开当前 Windows 用户的普通 PowerShell，不需要以管理员身份运行。先只对当前 PowerShell 进程放行脚本：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
```

该设置会在 PowerShell 窗口关闭后失效，不会永久修改当前用户或整台电脑的执行策略。

运行 Codex 官方 Windows 安装器：

```powershell
irm https://chatgpt.com/codex/install.ps1 | iex
```

检查安装结果：

```powershell
codex --version
```

检查登录状态：

```powershell
codex login status
```

如果尚未登录，运行：

```powershell
codex login
```

命令会打开浏览器，由用户完成 ChatGPT 或其他可用方式的登录。无法使用本机浏览器回调时，可以改用设备码：

```powershell
codex login --device-auth
```

Codex 会缓存登录状态，Relay Supervisor 后续启动 Codex app-server 时会复用同一 Windows 用户的凭据。不要复制或共享 `%USERPROFILE%\.codex\auth.json`。

## 4. 安装 Remote Codex

在已执行进程级 Execution Policy Bypass 的 PowerShell 中运行：

```powershell
npm install -g remote-codex@latest
remote-codex --version
```

检查所有命令入口：

```powershell
Get-Command node,npm,codex,remote-codex | Format-List Name,Source,Version
```

如果 PowerShell 优先匹配到 npm 生成的 `.ps1` shim，并报告脚本被禁用，可以重新执行进程级 Bypass，或者临时显式调用 `npm.cmd`、`codex.cmd`、`remote-codex.cmd`。

## 5. 在 Relay Portal 创建设备

1. 打开 Relay Portal，例如 `https://remote-codex.lnz-study.com/relay-portal`。
2. 登录 Relay 账号。
3. 进入 **Devices**。
4. 点击 **Add**，填写这台 Windows 电脑的设备名称。
5. 创建设备并保存页面只显示一次的 `rcd_...` device token。
6. 点击设备行上的 **Copy setup**。
7. 在二级菜单中选择 **Windows (PowerShell)**。

早期创建且没有保存 token 的设备不能重新显示完整 token。此时需要创建一个新设备。

## 6. 启动 Windows Relay Supervisor

Portal 复制出来的 Windows 命令形如：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
$env:REMOTE_CODEX_RELAY_SERVER_URL='wss://remote-codex.lnz-study.com'
$env:REMOTE_CODEX_RELAY_AGENT_TOKEN='rcd_替换为当前设备Token'
$env:REMOTE_CODEX_RELAY_SUPERVISOR_PORT='45680'
remote-codex relay-supervisor
```

Windows 默认端口是 `45680`，macOS/Linux 默认端口是 `45679`。两者不同，允许同一台电脑上的原生 Windows 和 WSL 同时运行 Supervisor。

在 Windows 上，不带子命令的 `remote-codex relay-supervisor` 等价于后台 `start`。命令会：

- 生成本地 Supervisor 的认证信息和 session secret；
- 将有效配置保存到 `%USERPROFILE%\.remote-codex\relay-supervisor.json`；
- 收紧配置目录和文件的 Windows ACL；
- 启动 detached Supervisor 进程；
- 通过出站 WebSocket 连接 Relay。

关闭 PowerShell 不会停止已经启动的 Supervisor。

### 使用其他工作区根目录

默认工作区根目录是 `%USERPROFILE%`。如果项目统一位于 `D:\dev`，在首次启动命令中额外加入：

```powershell
$env:WORKSPACE_ROOT='D:\dev'
```

该值会与 Relay 配置一起持久化。不要把根目录设置为整个系统盘，应该使用专门的代码目录。

## 7. 验证设备在线

检查后台进程：

```powershell
remote-codex relay-supervisor status
```

查看最近日志：

```powershell
Get-Content "$env:USERPROFILE\.remote-codex\logs\relay-supervisor.log" -Tail 100
```

回到 Relay Portal 刷新设备列表。设备应显示为 **Online**，然后可以点击 **Connect**，添加工作区并创建 Codex thread。

Relay Supervisor 默认只监听 `127.0.0.1:45680`，并主动建立出站连接，不需要在 Windows 防火墙中开放公网入站端口。

## 8. 配置登录后自动启动

后台 `start` 只能保证关闭终端后继续运行，Windows 重启后仍需重新启动。建议为当前用户安装登录计划任务：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$packageRoot = Join-Path (npm root -g) 'remote-codex'

& (Join-Path $packageRoot 'scripts\windows\install-relay-supervisor-task.ps1') `
  -PackageRoot $packageRoot
```

计划任务使用当前用户的 interactive token，以 Limited 权限运行，不使用 `LocalSystem`，也不会把 device token 写入计划任务参数。Windows 重启后必须由该用户登录，任务才会启动。

## 9. 日常维护

```powershell
# 查看状态
remote-codex relay-supervisor status

# 停止
remote-codex relay-supervisor stop

# 重新启动
remote-codex relay-supervisor start

# 删除保存的 Relay 配置，数据库和 Codex 登录不受影响
remote-codex relay-supervisor reset

# 更新 Remote Codex
npm install -g remote-codex@latest
remote-codex relay-supervisor stop
remote-codex relay-supervisor start
```

删除登录计划任务，但保留配置和数据库：

```powershell
$packageRoot = Join-Path (npm root -g) 'remote-codex'

& (Join-Path $packageRoot 'scripts\windows\uninstall-relay-supervisor-task.ps1') `
  -PackageRoot $packageRoot
```

只有明确需要永久删除 `%USERPROFILE%\.remote-codex` 下的数据时，才向卸载脚本传入 `-PurgeData`。

## 10. 常见问题

### `remote-codex.ps1 cannot be loaded`

当前 PowerShell 没有允许 npm PowerShell shim。运行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
```

也可以绕过 PowerShell shim：

```powershell
remote-codex.cmd relay-supervisor status
```

### 找不到新安装的命令

关闭并重新打开 PowerShell，然后检查：

```powershell
Get-Command node,npm,codex,remote-codex | Format-List Name,Source
```

### 设备持续 Offline

依次检查：

```powershell
codex login status
remote-codex relay-supervisor status
Get-Content "$env:USERPROFILE\.remote-codex\logs\relay-supervisor.log" -Tail 100
```

常见原因包括 device token 错误或已撤销、Relay URL 错误、公司网络阻止出站 WSS、端口被占用，或者当前用户没有 Codex 登录状态。

## 11. 敏感数据位置

以下文件可能包含 token、session secret 或登录凭据：

- `%USERPROFILE%\.remote-codex\relay-supervisor.json`
- `%USERPROFILE%\.remote-codex\relay-supervisor-state.json`
- `%USERPROFILE%\.codex\auth.json`

不要把这些文件提交到代码仓库、上传到 issue 或原样附在诊断报告中。分享日志前应删除 token、密码、session secret、Authorization header 和 `controlToken`。

## 参考资料

- [Remote Codex 原生 Windows 支持](windows.md)
- [OpenAI Codex CLI](https://learn.chatgpt.com/docs/codex/cli)
- [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Node.js 22 Windows 发布文件](https://nodejs.org/download/release/latest-v22.x/)
- [PowerShell execution policies](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies)
