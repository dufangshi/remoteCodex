# Rust 版本切换为 main 的执行手册

本文只描述发布操作。所有命令中的版本、路径、容器名和 commit 必须在执行当天重新确认。

## 1. 固化 Node 代码和发布物

当前 Node main 基线为 `4bb48be4`（`remote-codex@0.11.64`）。在改变 main 前创建可维护分支和不可移动 tag：

```bash
git branch legacy/node-0.11 4bb48be4
git tag -a node-v0.11.64-final 4bb48be4 -m "Final Node control-plane baseline"
git push origin legacy/node-0.11 node-v0.11.64-final
```

同时记录生产 Node relay 镜像 digest，不要只保留会被覆盖的 `latest` tag。npm 增加 `legacy` dist-tag，但保持 `latest` 指向 Node，直到 Rust stable gate 完成：

```bash
npm dist-tag add remote-codex@0.11.64 legacy
```

Git 分支、tag、npm 包和容器镜像都只是代码/二进制备份，不包含任何用户数据库。

## 2. 合并前 gate

必须全部满足：

- Rust workspace 在 Linux、macOS、Windows 的固定 Rust 1.89 toolchain 通过。
- 使用真实 `remote-codex@0.11.64` 生成的 supervisor 数据库完成升级、重复启动、新 turn、queued steer 和 Node 降级读取测试。
- npm 七个平台包齐全，launcher tarball 不包含源码，当前平台完成安装、Web/API、status/stop smoke。
- relay 数据副本的 dry-run 不报告未支持的 hosted sandbox、OAuth identity、pending registration 或 auth setting 数据。
- relay 用户登录、旧 HMAC session、旧密码、device token、REST、二进制 body、client WebSocket 和分享权限测试通过。
- `Relay Deploy` 仅允许手工触发，并使用受保护的 GitHub Environment。

## 3. 本地 supervisor 升级

数据库迁移不能在 `npm install` 期间运行。用户先更新 `next`，再显式重启：

```bash
npm install -g remote-codex@next
remote-codex stop
remote-codex start
```

首次打开 Node 数据库时，Rust 应先创建同目录 Online Backup，再在事务中执行 additive migration。迁移保留 Node 的 `__migrations`、旧表和旧列；Rust turn 同时写入兼容 metadata，使短期降级仍有可读数据。

验证至少包括：旧 workspace/thread/turn 数量、历史详情、settings、图片/tool/hook metadata、新 prompt 和服务重启。失败时停止 Rust，把旧 Node package 与 `DATABASE_URL` 指回首次启动前备份；不要尝试有损 down migration。

## 4. 唯一 relay 服务器手工迁移

Rust 不会隐式接管未带 `rustSchemaVersion` marker 的 Node `relay-store.sqlite`。正式操作窗口：

1. 记录旧容器 image digest、环境文件、反向代理 upstream 和 volume 名。
2. 停止 Node relay，确认没有仍在写入数据库的进程。
3. 对 Docker volume 再做一份服务器级快照。
4. 用即将部署的同一个 Rust binary 执行只读检查：

```bash
remote-codex relay-migrate \
  --data-dir /var/lib/remote-codex-relay \
  --dry-run
```

5. 核对报告中的 users/devices/shares/grants counts，以及 unsupported 数据计数。任何不符都停止切换。
6. 执行显式迁移：

```bash
remote-codex relay-migrate \
  --data-dir /var/lib/remote-codex-relay
```

7. 确认 `relay-store.pre-rust-0.12.sqlite` 存在，`quick_check`、`foreign_key_check` 和迁移前后核心表计数通过。
8. 手工触发 main 的 `Relay Deploy`，通过 `relay-production` environment 审批。
9. 验证 admin、普通用户、旧浏览器 session、device reconnect、REST、上传/下载、thread event 和 terminal WebSocket。

不采用负载均衡滚动升级：supervisor tunnel 和 browser socket registry 位于单进程内存，切换时允许一次短连接重连。

回滚时先停止 Rust，切回记录的 Node image digest。schema 采用 Node-compatible additive 结构，Node 应能直接读取；若需要恢复快照，先把 Rust 运行后的数据库另行保存，再用 Online Backup 恢复旧文件。不要删除任一代数据库。

## 5. npm 发布顺序

1. 用 `pnpm version:set 0.12.0-rc.1` 同步 Cargo 和全部 npm manifest。
2. 手工运行 `Native npm release`，先选择 `dry-run` 并下载检查 tarball artifact。
3. 七个平台包完成首次 bootstrap 并配置 npm trusted publisher。
4. 通过 `npm-release` environment 审批发布 `next`。
5. 完成真实用户与 relay canary 后，再设置 stable 版本并选择 `latest`。

平台包总是先发布，launcher 最后发布。任何已存在版本只有 registry integrity 与本地 manifest 完全一致时才可在重试中跳过。

## 6. Git 主干切换

不要直接把 main 普通 merge 到 Rust：两边存在大量有意删除和 modify/delete 冲突。推荐：

1. 从最终 Rust commit 建 `integration/rust-main`。
2. 对 main 自共同基点后的提交做逐项行为审计，移植仍缺能力。
3. 让所有 gate 在 integration 分支通过。
4. 在 integration 分支执行保留 Rust 目标树的 ancestry merge：

```bash
git merge -s ours main -m "chore: join Node and Rust histories for main cutover"
```

5. 对 `main..integration/rust-main` 的完整目标树做最终删除清单审查，再通过受保护 PR/fast-forward 更新 main。

`-s ours` 仅用于所有行为和删除已经人工核对后的历史汇合，不是解决代码冲突的捷径。移动端、旧 Node 服务和旧部署工具继续保存在 `legacy/node-0.11`；Rust main 不应重新引入旧控制平面。
