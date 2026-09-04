# Remote Codex Rust 版本的 npm 发布设计

## 结论

npm 包不要求实现语言是 JavaScript。包中可以包含 Rust、Go 或其他语言生成的可执行文件；npm 负责保存 tarball、按 `package.json` 的 `os`/`cpu`/`libc` 过滤依赖，并按 `bin` 字段创建命令入口。Remote Codex 仍保留一层很小的 Node launcher，因为用户通过 npm 安装时一定已有 Node，它适合完成平台选择、服务进程管理和旧 CLI 兼容。

推荐结构是“一个 launcher 包 + 每个平台一个原生包”，不在用户机器上编译 Rust，也不把 GitHub Release 下载放在 `postinstall` 中。

```text
remote-codex
  bin/remote-codex.mjs
  web/
  optionalDependencies:
    @dufangshi/remote-codex-native-darwin-arm64
    @dufangshi/remote-codex-native-darwin-x64
    @dufangshi/remote-codex-native-linux-arm64-gnu
    @dufangshi/remote-codex-native-linux-arm64-musl
    @dufangshi/remote-codex-native-linux-x64-gnu
    @dufangshi/remote-codex-native-linux-x64-musl
    @dufangshi/remote-codex-native-win32-x64-msvc
```

## 为什么采用平台 optionalDependencies

| 方案                             | 优点                                                | 问题                                                                          | 结论                  |
| -------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------- |
| 安装时 `cargo build`             | npm 包简单                                          | 用户必须安装固定 Rust、C 编译器和系统库；安装慢且失败面大                     | 不采用                |
| `postinstall` 下载 GitHub binary | root 包小                                           | `--ignore-scripts` 会跳过；企业代理、私有 registry、GitHub 限流和校验处理复杂 | 只可作为未来 fallback |
| 一个包包含所有平台 binary        | 发布最简单                                          | 每位用户下载所有平台，包体积和安全审计面都显著增加                            | 不采用                |
| 平台 optionalDependencies        | npm 按 OS/CPU/libc 选择；可被私服缓存；无需安装脚本 | 必须原子发布多个同版本包；`--omit=optional` 用户需要明确错误                  | 推荐                  |

该模式与 esbuild 等成熟原生工具相同。平台包故意不声明自己的 `bin` 字段，只有 launcher 提供 `remote-codex`，避免多个依赖争抢同一个 `node_modules/.bin` 链接。

## 仓库与发布包边界

仓库根 `package.json` 继续设置 `private: true`，只承担 monorepo 开发命令。真正公开的 manifest 位于 `npm/remote-codex/package.json`。这样 `npm publish` 不会把 `crates/`、测试、workflow 和大型字体误发到 registry。

`scripts/prepare-npm-release.mjs` 执行以下确定性步骤：

1. 校验 Cargo workspace、launcher 和全部平台包版本完全一致。
2. 复制已构建 Web UI、LICENSE 和对应平台 binary。
3. 清理未提供的平台旧 binary，防止本地残留进入新版本。
4. `--require-all` 发布模式要求七个平台 artifact 全部存在。

`scripts/pack-npm-release.mjs` 为每个 tarball 记录 npm integrity。`scripts/publish-npm-release.mjs` 先对全部包做 integrity 预检，再按平台包在前、launcher 在后的顺序发布；失败重试时，只在 registry integrity 与本地完全相同时跳过已发布版本。版本已经通过 `next` 发布时，`latest` 流程仍会对每个平台包执行 `npm dist-tag add`，并且最后才移动 launcher 的 `latest`；任一平台包失败时，launcher 保持在原稳定版。

## 用户安装和升级

标准安装方式保持不变：

```bash
npm install -g remote-codex
remote-codex start
```

不支持 `--omit=optional` 或 `--no-optional`。launcher 会明确报告当前平台所需的包名，而不是在找不到 binary 时静默下载或编译。

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

所有 optional dependency 使用与 launcher 完全相同的精确版本，不能使用 `^`、`~` 或 `latest`。npm 版本不可覆盖，因此半发布后的重试依赖 integrity manifest，而不是重新上传同一版本。

## npm 权限和供应链

建议先创建 npm organization/scope `@remote-codex`。七个新 scoped 包第一次发布后，为每个包和现有 `remote-codex` 配置同一个 trusted publisher：

- GitHub repository: `dufangshi/remoteCodex`
- Workflow: `npm-release.yml`
- Environment: `npm-release`
- Allowed action: `npm publish`

GitHub workflow 使用 cloud-hosted runner、`id-token: write`、Node 24 和 npm 11.19.1。npm trusted publishing 要求 npm 11.5.1+ 与 Node 22.14+；OIDC 发布会自动生成 provenance，不保存长期写 token。

新平台包在 npm 上还不存在时，需要先由拥有 scope 的账号完成一次受控 bootstrap 发布，然后才能在包设置页绑定 trusted publisher。bootstrap 后应撤销临时 token，并禁止传统 token 发布。`npm-release` GitHub Environment 应要求人工审批；`latest` 还要求 workflow 内的第二个显式开关。

本次 `0.12.0` 首发可以把本机 `.npmrc` 中已验证的 granular token 写入
GitHub repository secret `NPM_TOKEN`。发布 job 通过 `NODE_AUTH_TOKEN` 使用它完成
七个平台包和 launcher 的首次创建；所有包创建并绑定 trusted publisher 后，再移除
该 secret，后续版本只使用 OIDC。

官方参考：

- npm package.json 的 `optionalDependencies`、`os`、`cpu`、`libc`：<https://docs.npmjs.com/files/package.json/>
- npm trusted publishing 与 OIDC：<https://docs.npmjs.com/trusted-publishers/>
- npm provenance：<https://docs.npmjs.com/generating-provenance-statements/>
- cargo-zigbuild 的 glibc target：<https://github.com/rust-cross/cargo-zigbuild#specify-glibc-version>
