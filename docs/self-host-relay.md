# Self-hosting a relay

[简体中文](self-host-relay.zh-CN.md)

A relay is the website you sign in to. It connects your browser to your devices
and serves the device setup commands. It only forwards traffic: conversations,
files and terminals are end-to-end encrypted between your browser and each
device.

You need:

- a Linux server (x64 or ARM64, glibc 2.28 or newer) reachable from the internet;
- a domain name pointing at it, for example `relay.example.com`;
- HTTPS in front of the relay. Sign-in cookies are `Secure`, so browsers only
  accept them over HTTPS (or on `localhost`).

## 1. Download the relay

The relay is the same `pockymoe` executable as the device runtime. It runs from
a single directory:

```sh
mkdir -p ~/pockymoe-relay && cd ~/pockymoe-relay
repo=https://github.com/dufangshi/pockymoe/releases
version=$(curl -fsSL $repo/latest/download/runtime-version.txt)
asset=remote-codex-linux-x64-gnu   # or remote-codex-linux-arm64-gnu
curl -fLO $repo/download/v$version/$asset
curl -fLO $repo/download/v$version/remote-codex-web.zip
curl -fLO $repo/download/v$version/SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
install -m 0755 $asset pockymoe
rm -rf web && mkdir web && (cd web && unzip -q ../remote-codex-web.zip)
```

## 2. Configure

Create `~/pockymoe-relay/relay.env` and keep it private (`chmod 600 relay.env`):

```sh
# The administrator account, created on first start.
POCKYMOE_ADMIN_USERNAME=admin
POCKYMOE_ADMIN_PASSWORD=choose-a-long-password
POCKYMOE_ADMIN_EMAIL=you@example.com

# The exact public HTTPS address of this relay.
POCKYMOE_PUBLIC_BASE_URL=https://relay.example.com

POCKYMOE_RELAY_HOST=127.0.0.1
POCKYMOE_RELAY_PORT=8788
POCKYMOE_RELAY_DATA_DIR=/home/you/pockymoe-relay/data
POCKYMOE_RELAY_WEB_DIST_DIR=/home/you/pockymoe-relay/web
```

Optional settings:

| Variable | Effect |
| --- | --- |
| `POCKYMOE_GOOGLE_OAUTH_CLIENT_ID`, `POCKYMOE_GOOGLE_OAUTH_CLIENT_SECRET` | Show **Continue with Google**. Create an OAuth client in Google Cloud with the redirect URI `https://relay.example.com/relay/auth/oauth/google/callback`. |
| `POCKYMOE_GITHUB_OAUTH_CLIENT_ID`, `POCKYMOE_GITHUB_OAUTH_CLIENT_SECRET` | Sign in with GitHub; callback `…/relay/auth/oauth/github/callback`. |
| `POCKYMOE_RELAY_REGISTRATION_ENABLED=false` | Close public sign-up. It is open by default. |
| `POCKYMOE_RELAY_REGISTRATION_PASSWORD` | Require an invite code to sign up. |

Registration, approval and sign-in providers can also be changed later by the
administrator at `https://relay.example.com/relay-admin`.

## 3. Run it as a service

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
loginctl enable-linger "$USER"   # keep it running after you log out
curl -fsS http://127.0.0.1:8788/healthz
```

## 4. Add HTTPS

Any reverse proxy with WebSocket support works. With [Caddy](https://caddyserver.com),
which obtains certificates automatically:

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:8788
}
```

Open `https://relay.example.com`, create your account, and continue with the
[quick start](../README.md#quick-start).

## Docker

In a checkout of this repository, `Dockerfile.relay` builds the relay and its Web UI from source:

```sh
docker build -f Dockerfile.relay -t pockymoe-relay .
docker run -d --name pockymoe-relay --restart unless-stopped \
  -p 127.0.0.1:8788:8788 -v pockymoe-relay:/var/lib/remote-codex-relay \
  --env-file relay.env pockymoe-relay
```

In the container, leave out `POCKYMOE_RELAY_HOST`, `POCKYMOE_RELAY_DATA_DIR` and
`POCKYMOE_RELAY_WEB_DIST_DIR`; the image sets them.

## Updating

Repeat step 1 with the new version and restart the service. Devices update
themselves from Settings; the relay serves setup commands for its own version.

## Backups

Back up the whole data directory. It holds `relay-store.sqlite` and
`session-secret`. The secret also encrypts stored two-factor and device
credentials: if it is lost or replaced, those can no longer be decrypted. Use a
consistent SQLite backup rather than copying a database that is being written.
More detail: [relay security operations](relay-security-operations.zh.md).
