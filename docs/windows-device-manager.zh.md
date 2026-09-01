# Remote Codex Windows Device Manager

`RemoteCodex.DeviceManager.exe` 是原生 Windows 11 x64 托盘应用。它把一台 Windows 电脑配置为 Remote Codex Relay Device，并在当前用户登录期间维持设备连接。

## 用户侧安装

目标电脑不需要预装 .NET、Node.js、npm、Remote Codex 或 Codex。准备以下内容即可：

- Windows 11 x64；
- 一个可以完成 Codex 浏览器登录的 Windows 用户；
- Relay Portal 创建 Device 后只显示一次的 `rcd_...` token；
- 可访问 `nodejs.org`、`chatgpt.com`、OpenAI release 域名、npm registry 和 Relay 域名的网络。

运行 EXE 后会将自身复制到：

```text
%LOCALAPPDATA%\RemoteCodex\DeviceManager\RemoteCodex.DeviceManager.exe
```

随后首次配置窗口会要求：

1. 确认 Relay URL；
2. 输入 Device token；
3. 选择 Workspace root；
4. 确认本地端口，默认 `45680`；
5. 选择是否随当前 Windows 用户登录启动；
6. 点击 **Connect device**。

第一次连接时，应用会依次：

- 探测可用的 Windows x64 Node.js 22；
- 缺少兼容 Node 时下载私有 Node.js `22.23.2` 并校验 SHA-256；
- 探测 Codex，缺少时调用 OpenAI 官方 Windows installer；
- 检查 `codex login status`，未登录时打开临时终端完成用户登录；
- 在 `%LOCALAPPDATA%\RemoteCodex\app` 安装固定版本的私有 Remote Codex；
- 通过现有 CLI 写 Relay 配置并收紧 `%USERPROFILE%\.remote-codex` ACL；
- 将 Windows Device Manager 标记为受管启动源，并确保 Codex 与 ACP provider 均已启用；
- 启动后台 Relay Supervisor 并验证生命周期状态。

托盘的 **Supervisor running** 表示本机 Supervisor 已经通过身份校验并保持 Relay 自动重连。Relay 服务端是否已接受当前 token，仍以 Relay Portal 的 **Online** 状态为最终依据；失效或已撤销的 token 不会被本地进程状态误称为 Online。

已有的健康 Node.js 22 和 Codex 会直接复用。已有的其他 Node.js 大版本不会被卸载、覆盖或写入 PATH；应用会并存安装自己的 Node.js 22。私有 Remote Codex 第二次运行时会验证并跳过重复安装。

Device Manager 与 Remote Codex runtime 使用独立版本。EXE 只承载设备配置、进程管理和 runtime 更新能力；ACP、provider 与 Supervisor 业务修复应优先通过 npm runtime 发布，并由 EXE 内的 **Check for updates** / **Install update** 完成升级。只有安装器、运行时管理协议或 Windows 原生集成发生不兼容变化时，才需要重新发布 EXE。

## 托盘行为

主窗口关闭或最小化后，应用只隐藏到通知区域，Device 继续运行。托盘菜单提供：

- **Open**：打开配置和状态窗口；
- **Connect / Disconnect**：连接或主动下线；
- **Change device token...**：输入新 token，优雅重启并应用；
- **Open Relay portal**；
- **Open logs**；
- **Start with Windows**：切换当前用户登录启动；
- **Exit and take device offline**：停止 Supervisor 后退出托盘应用。

应用每 10 秒检查一次 Supervisor。只要用户没有点 **Disconnect** 或退出应用，进程异常停止后会自动拉起。开机启动使用当前用户的 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，不要求管理员权限，也不会把 Device token 写进启动参数。

升级自早期只启用 Codex 的 Device Manager 时，新版 Remote Codex runtime 会识别默认安装位置并把旧 provider 配置迁移为 `codex,acp`。手工启动且使用自定义配置路径的 Supervisor 不会应用这项兼容迁移。

## 敏感数据与文件位置

Device Manager 自身的 `settings.json` 不保存 Device token。Token 只交给 Remote Codex CLI，并由现有私有配置逻辑保存：

```text
%USERPROFILE%\.remote-codex\relay-supervisor.json
```

其他文件：

```text
%LOCALAPPDATA%\RemoteCodex\DeviceManager\settings.json
%LOCALAPPDATA%\RemoteCodex\DeviceManager\runtime-state.json
%LOCALAPPDATA%\RemoteCodex\runtime\
%LOCALAPPDATA%\RemoteCodex\app\
%LOCALAPPDATA%\RemoteCodex\logs\device-manager.log
%USERPROFILE%\.remote-codex\logs\relay-supervisor.log
```

日志层会脱敏 `rcd_...`、token、password、secret、Authorization 和 `controlToken`。Codex 登录凭据仍由 Codex 自己管理；Device Manager 不读取或复制凭据内容。

## 从源码构建

开发机需要 .NET 8 SDK。Windows PowerShell 中运行：

```powershell
git switch codex/windows-device-manager
./scripts/windows/build-device-manager.ps1
```

输出位于：

```text
artifacts\windows-device-manager\win-x64\RemoteCodex.DeviceManager.exe
artifacts\windows-device-manager\win-x64\RemoteCodex.DeviceManager.exe.sha256
```

也可以直接执行：

```powershell
dotnet publish apps/windows-device-manager/RemoteCodex.DeviceManager.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -o artifacts/windows-device-manager/win-x64
```

自包含单文件约 150 MB，目标电脑不需要 .NET runtime。GitHub Actions 的 **Windows device manager** workflow 会在 `windows-2022` 构建、执行 EXE 自检、生成 SHA-256 并上传 `remote-codex-device-manager-win-x64` artifact。

正式公开分发前应配置仓库 secrets：

```text
WINDOWS_SIGNING_CERTIFICATE_BASE64
WINDOWS_SIGNING_CERTIFICATE_PASSWORD
```

CI 检测到证书后会进行 Authenticode SHA-256 签名、可信时间戳和签名验证。没有证书时仍会生成供开发测试的未签名 artifact，Windows 可能显示 SmartScreen 提示。

## Windows 实机验收

建议在 Windows Codex App 拉取分支后至少完成以下验证：

1. 在没有 Node、Codex 和 .NET 的 Windows 11 x64 用户中运行 EXE；
2. 输入真实 token，完成 Codex 登录，确认 Portal Device 变为 Online；
3. 关闭主窗口，确认托盘图标仍存在且 Device 继续 Online；
4. 在任务管理器结束 Relay Supervisor，确认托盘应用自动恢复；
5. 从托盘更换 token，确认旧连接停止、新 Device Online；
6. 退出托盘应用，确认 `relay-supervisor status` 为 stopped/offline；
7. 重新运行两次，确认 Node、Codex 和 Remote Codex 均走复用/跳过路径；
8. 启用 **Start with Windows** 后注销并登录，确认托盘和 Device 自动恢复；
9. 在已有 Node 20 或 24 的电脑上运行，确认原 Node 和 PATH 没有被修改；
10. 检查日志，确认没有完整 token、密码或 session secret。

## 当前边界

- 首版目标是 Windows 11 x64，不包含 ARM64；
- Codex 账号登录必须由用户交互完成，应用不能代替用户认证；
- Relay Device token 仍由用户从 Portal 输入，后续可升级为短时一次性 enrollment code；
- 本地构建默认未签名，正式公开下载必须使用稳定发布者证书签名；
- 卸载当前通过托盘退出后删除 `%LOCALAPPDATA%\RemoteCodex` 完成；`%USERPROFILE%\.remote-codex` 和 Codex 登录数据默认保留，避免误删 workspace、数据库或凭据。

## 相关文档

- [Windows Device 从零手工安装指南](windows-device-setup.zh.md)
- [Windows 一键安装器调研](windows-one-click-installer-research.zh.md)
- [Remote Codex 原生 Windows 支持](windows.md)
