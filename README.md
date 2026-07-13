# Remote Codex

[![English](https://img.shields.io/badge/English-0f172a?style=for-the-badge)](#english)
[![中文](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-0f172a?style=for-the-badge)](#中文)

## English

Remote Codex is a web, Android, and iOS supervisor for Codex workspaces and
threads. It can run locally, over Tailscale/LAN, or through a public relay so a
private machine can connect outward without opening inbound ports.

### Downloads

- Android APK: [remote-codex-android.apk](https://github.com/dufangshi/remoteCodex/releases/latest/download/remote-codex-android.apk)
- iOS IPA: [RemoteCodex.ipa](https://github.com/dufangshi/remoteCodex/releases/latest/download/RemoteCodex.ipa)
- npm CLI: `npm install -g remote-codex`

### Features

- Relay mode for web/mobile access to private workspaces.
- Device-scoped routes, shared sessions, and per-device workspace/thread lists.
- Codex thread chat with streaming steps, attachments, exports, and workspace explorer.
- Workspace file browsing, preview, upload/download, edit, and image preview.
- Android, iOS, web, Docker, and npm CLI entrypoints.

### Run A Relay Server

Docker from GHCR:

```bash
docker volume create remote-codex-relay-data

docker run -d \
  --name remote-codex-relay \
  --restart unless-stopped \
  -p 8798:8788 \
  -v remote-codex-relay-data:/var/lib/remote-codex-relay \
  -e REMOTE_CODEX_RELAY_HOST=0.0.0.0 \
  -e REMOTE_CODEX_RELAY_PORT=8788 \
  -e REMOTE_CODEX_RELAY_DATA_DIR=/var/lib/remote-codex-relay \
  -e REMOTE_CODEX_RELAY_REGISTRATION_ENABLED=true \
  -e REMOTE_CODEX_ADMIN_USERNAME=admin \
  -e REMOTE_CODEX_ADMIN_PASSWORD='change-this-password' \
  -e REMOTE_CODEX_RELAY_SESSION_SECRET='change-this-session-secret' \
  ghcr.io/dufangshi/remotecodex-relay:latest
```

Build the Docker image yourself:

```bash
git clone https://github.com/dufangshi/remoteCodex.git
cd remoteCodex
docker build -f Dockerfile.relay -t remote-codex-relay .
docker run -d --name remote-codex-relay --restart unless-stopped \
  -p 8798:8788 \
  -v remote-codex-relay-data:/var/lib/remote-codex-relay \
  -e REMOTE_CODEX_RELAY_HOST=0.0.0.0 \
  -e REMOTE_CODEX_RELAY_PORT=8788 \
  -e REMOTE_CODEX_RELAY_DATA_DIR=/var/lib/remote-codex-relay \
  -e REMOTE_CODEX_RELAY_REGISTRATION_ENABLED=true \
  -e REMOTE_CODEX_ADMIN_USERNAME=admin \
  -e REMOTE_CODEX_ADMIN_PASSWORD='change-this-password' \
  -e REMOTE_CODEX_RELAY_SESSION_SECRET='change-this-session-secret' \
  remote-codex-relay
```

Direct script mode:

```bash
git clone https://github.com/dufangshi/remoteCodex.git
cd remoteCodex
./start.sh
```

`start.sh` defaults to relay mode on `0.0.0.0:8798`, creates
`.local/relay.env` on first run, and prints the initial admin password. Override
the port with:

```bash
REMOTE_CODEX_RELAY_PORT=18088 ./start.sh
```

Open `http://SERVER_HOST:8798/relay-portal`, sign in, create a device, and copy
the setup command.

### Connect A Private Machine

Install the CLI on the machine that owns the workspace:

```bash
npm install -g remote-codex
```

Then run the copied command from the relay portal. It has this shape:

```bash
REMOTE_CODEX_RELAY_SERVER_URL=ws://SERVER_HOST:8798 \
REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_device_token \
REMOTE_CODEX_RELAY_SUPERVISOR_PORT=45679 \
remote-codex relay-supervisor
```

`45679` is used by default in copied setup commands to avoid common local
`8787` port conflicts. You can change it if needed.

By default, `remote-codex relay-supervisor` starts itself inside a detached
`tmux` session so closing the terminal does not take the device offline. Manage
it with:

```bash
remote-codex relay-supervisor status
remote-codex relay-supervisor stop
```

If `tmux` is not installed it runs in the foreground. Use
`remote-codex relay-supervisor run` for explicit foreground/debug mode.

### Local Mode

```bash
npm install -g remote-codex
remote-codex start
remote-codex status
remote-codex stop
```

Default npm CLI ports:

- Web: `http://127.0.0.1:45673` locally, or `http://<host-lan-ip>:45673`
- API: `http://127.0.0.1:45674` locally, or `http://<host-lan-ip>:45674`

Both listeners bind to `0.0.0.0` by default. Local mode is unauthenticated, so
use it only on a trusted LAN/VPN. Set `SERVICE_HOST=127.0.0.1` and
`SERVICE_API_HOST=127.0.0.1` to make the service host-only.

Override with `SERVICE_PORT` and `SERVICE_API_PORT`.

### Development

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Common checks:

```bash
pnpm build
pnpm typecheck
pnpm test
```

### Publish Mobile Apps

After building an APK and IPA locally:

```bash
pnpm release:mobile -- --tag v0.11.23 \
  --apk apps/android/app/build/outputs/apk/release/app-release.apk \
  --ipa apps/ios/build/RemoteCodex.ipa
```

The uploaded asset names stay stable:

- `remote-codex-android.apk`
- `RemoteCodex.ipa`

## 中文

Remote Codex 是 Codex workspace 和 thread 的 Web、Android、iOS 控制台。它可以
本地运行，也可以通过 Tailscale/LAN 访问；relay 模式下，私有机器只需要主动连到
公网 relay，不需要开放入站端口。

### 下载

- Android APK: [remote-codex-android.apk](https://github.com/dufangshi/remoteCodex/releases/latest/download/remote-codex-android.apk)
- iOS IPA: [RemoteCodex.ipa](https://github.com/dufangshi/remoteCodex/releases/latest/download/RemoteCodex.ipa)
- npm CLI: `npm install -g remote-codex`

### 功能

- Relay 模式：网页和移动端访问私有 workspace。
- 按设备隔离 URL、workspace、thread，并支持 session 分享。
- Codex thread 聊天、流式步骤、图片/附件、导出和 workspace explorer。
- 文件浏览、预览、上传/下载、编辑和图片预览。
- Web、Android、iOS、Docker、npm CLI 多入口。

### 启动 Relay 服务器

使用 GHCR 镜像：

```bash
docker volume create remote-codex-relay-data

docker run -d \
  --name remote-codex-relay \
  --restart unless-stopped \
  -p 8798:8788 \
  -v remote-codex-relay-data:/var/lib/remote-codex-relay \
  -e REMOTE_CODEX_RELAY_HOST=0.0.0.0 \
  -e REMOTE_CODEX_RELAY_PORT=8788 \
  -e REMOTE_CODEX_RELAY_DATA_DIR=/var/lib/remote-codex-relay \
  -e REMOTE_CODEX_RELAY_REGISTRATION_ENABLED=true \
  -e REMOTE_CODEX_ADMIN_USERNAME=admin \
  -e REMOTE_CODEX_ADMIN_PASSWORD='change-this-password' \
  -e REMOTE_CODEX_RELAY_SESSION_SECRET='change-this-session-secret' \
  ghcr.io/dufangshi/remotecodex-relay:latest
```

自己构建 Docker 镜像：

```bash
git clone https://github.com/dufangshi/remoteCodex.git
cd remoteCodex
docker build -f Dockerfile.relay -t remote-codex-relay .
docker run -d --name remote-codex-relay --restart unless-stopped \
  -p 8798:8788 \
  -v remote-codex-relay-data:/var/lib/remote-codex-relay \
  -e REMOTE_CODEX_RELAY_HOST=0.0.0.0 \
  -e REMOTE_CODEX_RELAY_PORT=8788 \
  -e REMOTE_CODEX_RELAY_DATA_DIR=/var/lib/remote-codex-relay \
  -e REMOTE_CODEX_RELAY_REGISTRATION_ENABLED=true \
  -e REMOTE_CODEX_ADMIN_USERNAME=admin \
  -e REMOTE_CODEX_ADMIN_PASSWORD='change-this-password' \
  -e REMOTE_CODEX_RELAY_SESSION_SECRET='change-this-session-secret' \
  remote-codex-relay
```

直接脚本启动：

```bash
git clone https://github.com/dufangshi/remoteCodex.git
cd remoteCodex
./start.sh
```

`start.sh` 默认以 relay 模式监听 `0.0.0.0:8798`，首次运行会创建
`.local/relay.env` 并打印初始 admin 密码。改端口：

```bash
REMOTE_CODEX_RELAY_PORT=18088 ./start.sh
```

打开 `http://SERVER_HOST:8798/relay-portal`，登录后创建设备并复制 setup command。

### 连接私有机器

在真正拥有 workspace 的机器上安装 CLI：

```bash
npm install -g remote-codex
```

然后运行 relay portal 复制出来的命令，形如：

```bash
REMOTE_CODEX_RELAY_SERVER_URL=ws://SERVER_HOST:8798 \
REMOTE_CODEX_RELAY_AGENT_TOKEN=rcd_device_token \
REMOTE_CODEX_RELAY_SUPERVISOR_PORT=45679 \
remote-codex relay-supervisor
```

复制命令默认使用 `45679`，用于避开本机常见的 `8787` 端口冲突；需要时可以手动换。

默认情况下，`remote-codex relay-supervisor` 会尝试启动到 detached `tmux`
session 里，这样关闭终端窗口不会让设备下线。可以用下面命令管理：

```bash
remote-codex relay-supervisor status
remote-codex relay-supervisor stop
```

如果设备没有安装 `tmux`，它会自动退回前台运行。需要显式前台调试时使用
`remote-codex relay-supervisor run`。

### 本地模式

```bash
npm install -g remote-codex
remote-codex start
remote-codex status
remote-codex stop
```

npm CLI 默认端口：

- Web：本机使用 `http://127.0.0.1:45673`，内网设备使用 `http://<宿主机内网IP>:45673`
- API：本机使用 `http://127.0.0.1:45674`，内网设备使用 `http://<宿主机内网IP>:45674`

两个服务默认监听 `0.0.0.0`。local 模式没有登录鉴权，只应在可信 LAN/VPN
中使用。如需限制为仅本机访问，请同时设置 `SERVICE_HOST=127.0.0.1` 和
`SERVICE_API_HOST=127.0.0.1`。

可用 `SERVICE_PORT` 和 `SERVICE_API_PORT` 覆盖。

### 开发

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

常用检查：

```bash
pnpm build
pnpm typecheck
pnpm test
```

### 发布移动端安装包

本地构建好 APK 和 IPA 后：

```bash
pnpm release:mobile -- --tag v0.11.23 \
  --apk apps/android/app/build/outputs/apk/release/app-release.apk \
  --ipa apps/ios/build/RemoteCodex.ipa
```

上传后的文件名保持固定：

- `remote-codex-android.apk`
- `RemoteCodex.ipa`
