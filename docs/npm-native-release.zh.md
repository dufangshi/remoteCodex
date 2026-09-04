# Remote Codex Rust 版本的 npm 发布设计

## 结论

npm 包不要求实现语言是 JavaScript。包中可以包含 Rust、Go 或其他语言生成的可执行文件；npm 负责保存 tarball、按 `package.json` 的 `os`/`cpu`/`libc` 过滤依赖，并按 `bin` 字段创建命令入口。Remote Codex 仍保留一层很小的 Node launcher，因为用户通过 npm 安装时一定已有 Node，它适合完成平台选择、服务进程管理和旧 CLI 兼容。

当前采用“一个 launcher 包 + GitHub Release 原生资产”。不在用户机器上编译
Rust，也不在 `postinstall` 中执行网络请求；用户第一次真正启动命令时，launcher
按平台下载同版本二进制、校验包内固定的 SHA-256，并缓存到
`~/.remote-codex/bin/<version>/<platform>/`。

```text
remote-codex
  bin/remote-codex.mjs
  native-manifest.json
  web/

GitHub Release v0.12.0
  remote-codex-darwin-arm64
  remote-codex-darwin-x64
  remote-codex-linux-arm64-gnu
  remote-codex-linux-arm64-musl
  remote-codex-linux-x64-gnu
  remote-codex-linux-x64-musl
  remote-codex-win32-x64-msvc-cli.exe
  remote-codex-win32-x64-msvc.exe  # Native Windows Device Manager, not used by npm
```

## 方案取舍

| 方案                             | 优点                                                | 问题                                                              | 结论               |
| -------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- | ------------------ |
| 安装时 `cargo build`             | npm 包简单                                          | 用户必须安装固定 Rust、C 编译器和系统库；安装慢且失败面大         | 不采用             |
| `postinstall` 下载 GitHub binary | root 包小                                           | `--ignore-scripts` 会跳过，安装阶段副作用大                       | 不采用             |
| 一个包包含所有平台 binary        | 发布最简单                                          | 每位用户下载所有平台，包体积和安全审计面都显著增加                | 不采用             |
| 平台 optionalDependencies        | npm 按 OS/CPU/libc 选择；可被私服缓存；无需安装脚本 | 必须创建并原子发布 7 个额外包；当前 token 只允许写 `remote-codex` | token 扩权后的备选 |
| 首次运行下载 Release binary      | 单一 npm 包、安装轻量、`--ignore-scripts` 可用      | 首次运行需要访问 GitHub；需实现缓存、超时、并发与完整性校验       | 当前采用           |

下载 URL 和 SHA-256 均由发布时生成的 `native-manifest.json` 固定到 npm 包中，
不会读取可变的 `latest` 资产。缓存命中时仍重新计算 SHA-256；损坏文件会重新下载。
`REMOTE_CODEX_NATIVE_BINARY` 保留为本地测试覆盖，
`REMOTE_CODEX_NATIVE_DOWNLOAD_BASE_URL` 只用于镜像和自动化测试。

## 仓库与发布包边界

仓库根 `package.json` 继续设置 `private: true`，只承担 monorepo 开发命令。真正公开的 manifest 位于 `npm/remote-codex/package.json`。这样 `npm publish` 不会把 `crates/`、测试、workflow 和大型字体误发到 registry。

`scripts/prepare-npm-release.mjs` 执行以下确定性步骤：

1. 校验 Cargo workspace 与 launcher 版本完全一致。
2. 复制已构建 Web UI 和 LICENSE。
3. `--require-all` 发布模式要求七个平台 artifact 全部存在。
4. 根据实际 artifact 生成资产名、字节数和 SHA-256 manifest。

`scripts/pack-npm-release.mjs` 只打包公开 launcher 并记录 npm integrity。
`scripts/publish-npm-release.mjs` 发布前检查 registry 中不可变版本的 integrity；失败重试时，
只有 registry integrity 与本地完全相同才会跳过上传并移动 dist-tag。

## 用户安装和升级

标准安装方式保持不变：

```bash
npm install -g remote-codex
remote-codex start
```

安装不会运行 lifecycle script。`version` 和 `help` 无需下载；第一次执行服务命令会显示
明确的下载或校验错误，之后复用经过校验的版本化缓存。

launcher 保留这些兼容命令：

- `start`、`status`、`stop`
- `supervisor` 前台运行
- `relay` 前台运行
- `relay-supervisor start|run|status|stop|reset`
- `version`

Rust supervisor 直接托管 `web/`，所以正常服务只有一个后端进程。launcher 继续读取旧 `~/.remote-codex/relay-supervisor.json`，并能停止由 Node 0.11.x state file 记录的旧服务。

数据库迁移不能放在 npm lifecycle script 中。`npm install -g` 可能在旧服务仍运行、没有目标用户环境或使用 `--ignore-scripts` 时执行。迁移应在下一次显式 `start` 时由 Rust 数据层完成，并且必须先校验、事务执行和保留旧 schema/备份。

## 平台与 ABI

第一批 release gate：

- macOS arm64、x64，deployment target 12.0
- Linux arm64、x64，分别提供 glibc 与 musl
- Windows x64 MSVC

Linux GNU artifact 使用 cargo-zigbuild 声明 glibc 2.28 最低版本；musl artifact 用于 Alpine 等环境。不能直接把 Debian Bookworm 或 Ubuntu 最新 runner 的普通 release binary 当成通用 GNU npm artifact，否则会无意提高用户机器的 glibc 下限。

每个平台必须执行 `remote-codex version`；可在对应 runner 原生执行的平台还必须跑 npm 安装、Web/API 启动和退出 smoke。不能把在 macOS arm64 本机通过 `cargo build` 当作 Windows/Linux 发布验证。

## 版本和 dist-tag

当前稳定版为 Node `0.11.64`，Rust 使用新的 `0.12` 版本线：

1. 保持 `latest=0.11.64`，并增加 `legacy` tag。
2. 首个 Rust 包使用 `0.12.0-rc.1`，发布到 `next`。
3. RC 必须通过真实 0.11.64 数据库升级、本地服务、relay supervisor 和生产数据副本演练。
4. 再发布不可变的 `0.12.0`，最后移动 `latest`。
5. 降级 npm 包并不等于数据库回滚；必须同时选择保留的旧数据库或兼容 schema。

npm 版本和 GitHub Release 标签都不可覆盖。必须先发布带全部原生资产的 `v<version>`
Release，再发布包含对应 hash manifest 的 npm 包，最后移动 `latest`。

## npm 权限和供应链

为现有 `remote-codex` 配置 trusted publisher：

- GitHub repository: `dufangshi/remoteCodex`
- Workflow: `npm-release.yml`
- Environment: `npm-release`
- Allowed action: `npm publish`

GitHub workflow 使用 cloud-hosted runner、`id-token: write`、Node 24 和 npm 11.19.1。npm trusted publishing 要求 npm 11.5.1+ 与 Node 22.14+；OIDC 发布会自动生成 provenance，不保存长期写 token。

当前 `.npmrc` 的 granular token 只对既有 `remote-codex` 包有读写权限，不能创建
新平台包；这也是采用单 npm 包结构的实际约束。首发通过 GitHub repository secret
`NPM_TOKEN` 使用该 token。绑定 trusted publisher 后应删除长期 secret，后续版本只用
OIDC。`npm-release` GitHub Environment 应要求人工审批；`latest` 仍要求 workflow 的显式开关。

官方参考：

- npm package.json 的 `optionalDependencies`、`os`、`cpu`、`libc`：<https://docs.npmjs.com/files/package.json/>
- npm trusted publishing 与 OIDC：<https://docs.npmjs.com/trusted-publishers/>
- npm provenance：<https://docs.npmjs.com/generating-provenance-statements/>
- cargo-zigbuild 的 glibc target：<https://github.com/rust-cross/cargo-zigbuild#specify-glibc-version>
