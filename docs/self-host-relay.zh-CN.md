# 自己部署 Relay

[English](self-host-relay.md)

Relay 就是你登录的那个网站。它把浏览器和你的设备连起来，并提供设备的安装命令。Relay 只负责转发：对话、文件和终端内容在浏览器与设备之间端到端加密。

需要准备：

- 一台能从公网访问的 Linux 服务器（x64 或 ARM64，glibc 2.28 及以上）；
- 一个指向它的域名，例如 `relay.example.com`；
- 在 Relay 前面加一层 HTTPS。登录 Cookie 带 `Secure` 属性，浏览器只在 HTTPS（或 `localhost`）下接受。

## 1. 下载 Relay

Relay 和设备端是同一个 `pockymoe` 可执行文件，放在一个目录里就能运行：

```sh
mkdir -p ~/pockymoe-relay && cd ~/pockymoe-relay
repo=https://github.com/dufangshi/pockymoe/releases
version=$(curl -fsSL $repo/latest/download/runtime-version.txt)
asset=remote-codex-linux-x64-gnu   # ARM 服务器用 remote-codex-linux-arm64-gnu
curl -fLO $repo/download/v$version/$asset
curl -fLO $repo/download/v$version/remote-codex-web.zip
curl -fLO $repo/download/v$version/SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
install -m 0755 $asset pockymoe
rm -rf web && mkdir web && (cd web && unzip -q ../remote-codex-web.zip)
```

## 2. 配置

新建 `~/pockymoe-relay/relay.env`，并设为仅自己可读（`chmod 600 relay.env`）：

```sh
# 管理员账号，首次启动时创建。
POCKYMOE_ADMIN_USERNAME=admin
POCKYMOE_ADMIN_PASSWORD=choose-a-long-password
POCKYMOE_ADMIN_EMAIL=you@example.com

# 这个 Relay 实际对外的 HTTPS 地址。
POCKYMOE_PUBLIC_BASE_URL=https://relay.example.com

POCKYMOE_RELAY_HOST=127.0.0.1
POCKYMOE_RELAY_PORT=8788
POCKYMOE_RELAY_DATA_DIR=/home/you/pockymoe-relay/data
POCKYMOE_RELAY_WEB_DIST_DIR=/home/you/pockymoe-relay/web
```

可选配置：

| 变量 | 作用 |
| --- | --- |
| `POCKYMOE_GOOGLE_OAUTH_CLIENT_ID`、`POCKYMOE_GOOGLE_OAUTH_CLIENT_SECRET` | 显示「使用 Google 继续」。在 Google Cloud 创建 OAuth 客户端，回调地址填 `https://relay.example.com/relay/auth/oauth/google/callback`。 |
| `POCKYMOE_GITHUB_OAUTH_CLIENT_ID`、`POCKYMOE_GITHUB_OAUTH_CLIENT_SECRET` | 使用 GitHub 登录，回调地址 `…/relay/auth/oauth/github/callback`。 |
| `POCKYMOE_RELAY_REGISTRATION_ENABLED=false` | 关闭公开注册。默认开放注册。 |
| `POCKYMOE_RELAY_REGISTRATION_PASSWORD` | 注册时需要填写邀请码。 |

注册、审核和登录方式之后也可以由管理员在 `https://relay.example.com/relay-admin` 修改。

## 3. 作为服务运行

```ini
# ~/.config/systemd/user/pockymoe-relay.service
[Unit]
Description=Pockymoe relay
After=network-online.target

[Service]
WorkingDirectory=%h/pockymoe-relay
EnvironmentFile=%h/pockymoe-relay/relay.env
ExecStart=%h/pockymoe-relay/pockymoe relay
Restart=always

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now pockymoe-relay
loginctl enable-linger "$USER"   # 退出登录后继续运行
curl -fsS http://127.0.0.1:8788/healthz
```

## 4. 加上 HTTPS

任何支持 WebSocket 的反向代理都可以。用会自动申请证书的 [Caddy](https://caddyserver.com)：

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:8788
}
```

打开 `https://relay.example.com`，注册账号，然后按[快速上手](../README.zh-CN.md#快速上手)继续。

## Docker

在本仓库的 checkout 里，`Dockerfile.relay` 会从源码构建 Relay 和网页：

```sh
docker build -f Dockerfile.relay -t pockymoe-relay .
docker run -d --name pockymoe-relay --restart unless-stopped \
  -p 127.0.0.1:8788:8788 -v pockymoe-relay:/var/lib/remote-codex-relay \
  --env-file relay.env pockymoe-relay
```

容器里不需要 `POCKYMOE_RELAY_HOST`、`POCKYMOE_RELAY_DATA_DIR` 和 `POCKYMOE_RELAY_WEB_DIST_DIR`，镜像已经设置好。

## 更新

用新版本重复第 1 步，然后重启服务。设备在网页的设置里自行更新；Relay 提供的是与它自身版本一致的安装命令。

## 备份

备份整个数据目录，里面有 `relay-store.sqlite` 和 `session-secret`。这个 secret 还用来加密已保存的二步验证和设备凭据，丢失或替换后这些数据就无法解密。SQLite 请用一致性备份，不要直接复制正在写入的数据库。更多说明见 [Relay 安全运维](relay-security-operations.zh.md)。
