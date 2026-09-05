---
name: release-runtime
description: 排查 Remote Codex 安装后版本未更新的问题，并固定提交、高效验证和执行 runtime/npm 发布。用于升级排障、发布准备、Actions 发布及结果核验；Windows Device Manager 的独立发布另按其流程处理。
---

# Remote Codex 更新与发布

## 安装成功但版本没变

先确认实际执行路径，再决定修复：

```bash
type -a remote-codex
command -v npm
npm prefix -g
npm ls -g remote-codex --depth=0
npm view remote-codex dist-tags --json
remote-codex version
```

在 macOS/Linux 直接比较 `"$(npm prefix -g)/bin/remote-codex" version`。Windows 用 `Get-Command remote-codex -All` 和 npm prefix 下的 `.cmd` 入口比较。

- npm 安装已是新版、PATH 入口仍是旧版：检查 pnpm 全局安装、多个 Node prefix、alias 和 shell 命令缓存。根据用户选定的包管理器移除已确认的重复安装；不要删除整个 pnpm 目录或重排所有工具的 PATH。
- 若选用 npm，且 `pnpm list -g --depth=0` 确认有另一份 remote-codex，则用 `pnpm remove -g remote-codex` 移除重复包；zsh 用 `rehash`、bash 用 `hash -r`，再验证普通命令及 npm 绝对路径入口均为目标版本。重复执行用户原来的更新命令，确认问题消失。
- npm prefix 中版本也旧：检查 registry、dist-tag、当前 npm/Node 的路径。先获取证据，避免默认清空缓存或强制重装全部依赖。
- `version` 读取 launcher 的 package.json，不会验证已运行的后台进程。若涉及服务升级，读取其启动路径和状态，再按用户授权重启；不能把 launcher 更新等同于正在运行的服务更新。

## 固定发布内容

从项目根目录执行。先合并本次需要的远端改动、收敛用户授权的工作区变更，再安排最终检查。若其它会话还在修改同一检出，使用固定提交的独立 worktree 完成发布，避免边修边发布。

记录 runtime 的候选提交、版本和 UI 的完整 SHA。`remote-codex-thread-ui/` 是独立仓库，核对 origin 必须是 `dufangshi/remote-codex-thread-ui-rust`；本地目录名不代表远端仓库。UI 必须先提交并推送，工作流的 `thread_ui_sha` 必须使用已推送的完整 SHA。

版本同时核对根 package.json、远端 npm dist-tags 和 GitHub 已有版本。需要新版本时使用 `node scripts/set-version.mjs <version>`。遵循 AGENTS.md 的不可变版本、完整四平台资产和 Device Manager 独立发布规则。

本次范围之外的新改动进入下一批，不因为等待 CI 就主动继续审查并加入发布。不要为发布优化重新修改已经验证的应用功能。

## 一次验证并提交

按最终差异选择检查；独立检查可并行执行，每项结果都要核对：

- 修改 crates 后按 AGENTS.md 跑 `cargo test --workspace`。
- 修改 launcher/发布脚本，跑相关 `node --test`；现成入口是 `pnpm npm:publish:test`。
- UI 改动按 focused-e2e skill 选相关测试和显式浏览器项目。
- 修改工作流用 actionlint 检查；涉及 job 依赖或 artifact 传递，再跑一次 `channel=dry-run` 验证完整打包。
- 已在相同源码上通过的检查不重复跑，除非新差异、失败或未解决的问题使结果失效。

检查通过后只提交本次相关文件。记录最终提交；后续需要修改源码时，更新记录并重跑受影响检查。工作流优化不需要单独提升 runtime/npm 版本。

## 触发和等待

在已有用户授权范围内 push 和触发发布；技能本身不扩大授权。主仓库与 UI 都推送完成后，核对远端 runtime ref 指向记录的提交，再触发：

```bash
gh workflow run npm-release.yml --ref <pushed-runtime-ref> \
  -f channel=<dry-run|next|latest> -f thread_ui_sha=<full-ui-sha>
```

保存返回/查询到的唯一 run ID，并核对其 `headSha`。版本发布遇到相同版本但不同内容时停下处理冲突，不覆盖已有资产，也不盲目反复触发。

只用一种监控方式，例如 `gh run watch <run-id> --interval 30 --exit-status`。在工具支持后台进程时保留 session ID，分段读取输出，单次等待不超过 60 秒。不要同时开启另一个 `gh run view` 定时循环；仅在失败诊断或需要获取缺失信息时额外读取。

更新用户时说明阶段变化、失败或已确认的结果，避免重复描述相同状态。等待进程的时间包含在 CI 耗时中，分析耗时时不要重复计入。

## 完成条件

- dry-run：verify、四平台 native、web、package 成功；release 和 publish 应跳过。检查包包含 Web 文件及四平台 manifest，报告没有发布 npm。
- 实际发布：检查 run 成功、GitHub 版本与全部平台资产、npm 对应 dist-tag/version；下载 launcher 包核对版本和 manifest。需要安装更新验证时，比较实际 PATH 命令、npm prefix 入口与发布版本，不能只看 `npm install` 返回成功。
- 发布结果不确定时，先查询既有 run、GitHub 和 registry，再决定是否重试。网络查询失败不代表版本尚未发布。
- 报告提交、版本、run 链接、关键验证及限制。记录本地准备、CI 各阶段和最终核验时间；并行平台按最慢完成时间计算。

## CI 提速约束

测试、四平台编译、Web 构建并行；package 必须依赖三者成功，之后才允许外部发布。UI 使用固定 SHA。Rust 缓存按工具链、平台和编译配置隔离，锁文件变化时可恢复兼容依赖中间产物；始终由 Cargo 判断重建本次源码。仅冷缓存成功不能证明暖缓存收益。不要为缩短等待而省略平台或复用旧版本最终二进制。
