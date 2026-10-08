# 文件草稿与条件保存实现、验收

本分支实现 `docs/proposals/narrafork-file-browser-editor-plan.zh.md` 的有界 P0A + P0B。产品沿用文件树、标签、桌面 Monaco 和手机文本编辑器；没有改全局工作台布局。截图来自独立 fake Supervisor 的真实页面与真实文件系统，聊天和文档为明确标注的演示 fixture。分支供审图，尚未合入 main、部署或发布。

配套共享 UI 提交：`c0b34ab34676391c8cb6fa2d697057cf9f7d6303`（`feature/narrafork-file-editor-ui`）。主仓库的宿主接线需要消费该提交的 dist 和 worker export。

## 行为和接口

- 每个文件保留独立草稿、递增 revision、dirty/保存中/冲突/未知结果状态；切换 A/B/A 保留文本和 Monaco undo/view state。保存提交的是不可变草稿版本，回执只更新该版本的 base；保存中继续输入仍为未保存草稿。
- 源身份由 Web origin、选中 relay device、登录 owner scope、workspace ID 组成；模型 URI 另含服务器 workspaceRevision 和路径。共享 UI 的旧 adapter 无需修改，新增能力均为可选。宿主和延迟加载入口共享一个浏览器内存 store；全局最多 32 份文档，只淘汰非编辑中的干净文档。
- 新 HTTP 协议：`GET /api/workspaces/{id}/files/capabilities`、`GET /document?path=...`、`POST /save`、`GET /operations/{operationId}`。这里后面三项均在同一 `/api/workspaces/{id}/files` 前缀下，JSON 使用 camelCase，响应为 private/no-store。旧 PUT 不支持 expectedHash，也不会被新编辑器当作条件保存使用。
- `save` 必须提交 path、workspaceRevision、fileIdentity、expectedHash、content、draftRevision、operationId、operationCreatedAt。原始字节 SHA-256 包含 BOM/EOL；编辑器使用 LF，写回保留原始 BOM 和统一 CRLF/LF。相同操作 ID/输入返回已有回执，不重复写入；不同输入复用 ID 拒绝。
- Relay ACL：document/capabilities 要 read，save 和操作回执要 write。Relay 将当前已认证用户 ID 注入可信 actor；tunnel 用外层 actor 覆盖内层伪造值。回执按 actor、workspace、根 revision 隔离。旧 relay 没有可信 actor 时，安全保存拒绝，避免匿名查询或误写。
- 冲突返回 409 和当次读取的固定磁盘 snapshot，存入该操作回执。可查看草稿/磁盘、原始基线/草稿、原始基线/磁盘；可继续编辑、下载、采用所示版本或明确覆盖所示版本。覆盖继续使用 snapshot 的 hash/identity 条件，再次变化继续冲突。采用快照显示待核验，不将固定快照宣称为最新磁盘。
- SQLite migration 12 提供最小操作 journal（FULL synchronous）：写入前提交 uncertain intent、旧原始字节、预期 hash；提交后存回执。HTTP 接收后至执行结束另有进程内活跃标记，等待 blocking worker/写锁也返回 pending；此时不能人工重建基线。丢响应查询原操作，不换 ID 自动重试；重启后的 uncertain 不自动重放。24 小时过期/不存在回执必须核验磁盘；保留 uncertain，终态过期清理。每 actor/workspace 最多 256 条，全局 32 MiB payload 预算，满额拒绝新操作；相对路径限制 4096 bytes，预留 JSON 转义和快照/备份空间。
- 标签关闭提供保存并关闭、丢弃、继续编辑；保存中/未知结果禁止当作取消写入来丢弃。SPA 路由、登录/设备切换受保护；原生离页使用 beforeunload，即使面板隐藏仍有效。草稿仅内存保存，主动离开时可确认丢弃，也可先逐文件保存或下载。

## 文件安全边界

文档读取最多 50 KiB + 1 字节，编辑上限 50 KiB/1000 行；严格 UTF-8，拒绝 NUL、混合换行、bare CR。普通预览读取最多 64 KiB + UTF-8 边界余量，不对整文件读取再截断；没有 range 能力就不显示伪造的“加载更多”。大文件、非 UTF-8、特殊元数据和不支持的平台只读。现有 drawio 专用有界预览仍保留，不新增 drawio 条件编辑。

Unix 文档读取逐级使用 fd-relative O_NOFOLLOW，拒绝越界相对路径、symlink、非普通文件。条件保存目前只在 Linux 支持，限定已检查的普通本地 ext4/XFS/btrfs/tmpfs/overlay 文件；硬链接、非当前 owner、特殊 mode 位、xattr/ACL、其他文件系统拒绝编辑。临时文件同父目录、保留 owner/group/mode、校验继承元数据、fsync；复核根/父目录/文件 identity 与 raw hash 后原子 rename，目录 fsync 并读回提交 inode。替换之后的失败分类为 uncertain。

全进程 mutation gate 串行覆盖条件保存、旧文本写入、上传、ACP 受管文件写入、Explorer rename/delete，保护这些路径之间的并发。Agent 的 shell 工具、IDE 和其他进程不会被这把锁冻结；外部 writer 仍可能在最后检查与 rename 之间写入或替换文件。这不是针对任意外部 writer 的操作系统强 CAS，不能保证该最终窗口绝不覆盖其写入。已接收的保存也可能在 relay 权限随后撤销时完成；每个新请求仍重新校验 ACL。

没有引入完整 watcher、全仓文件名搜索、多编码、大文件传输、自动 merge、草稿持久化或外部 writer 强 CAS。

## 定向验证

在本 worktree 使用独立 `.temp/cargo-target`、自身 debug executable、自身 node_modules/shared UI dist。未跑 workspace 全测、平台矩阵或全浏览器套件。

```bash
CARGO_TARGET_DIR="$PWD/.temp/cargo-target" cargo test -p remote-codex-runtime --test file_documents --test db_migration -j2
CARGO_TARGET_DIR="$PWD/.temp/cargo-target" cargo test -p remote-codex-supervisor --test http_e2e file_document_http_conditional_save_conflict_and_receipt_use_real_disk -j2
CARGO_TARGET_DIR="$PWD/.temp/cargo-target" cargo test -p remote-codex-supervisor file_receipts_bind_to_trusted_relay_actor_and_ignore_inner_actor_forgery -j2
CARGO_TARGET_DIR="$PWD/.temp/cargo-target" cargo test -p remote-codex-relay route_acl::tests -j2
CARGO_TARGET_DIR="$PWD/.temp/cargo-target" cargo check -p remote-codex-supervisor -p remote-codex-relay -j2
CARGO_TARGET_DIR="$PWD/.temp/cargo-target" cargo build -p remote-codex -j2
cargo fmt --all --check
```

结果：文件安全 5 项、migration 5 项、真实 HTTP 1 项、可信 actor 1 项、relay ACL 7 项通过；最终读回、路径预算和活跃操作改动后文件安全 5 项、真实 HTTP 1 项再通过，独立可执行文件再次构建通过。文件安全用例也验证活跃 pending、actor 隔离及移除活跃标记后持久 uncertain 的区别。编译检查与 fmt 通过。

```bash
# 在 nested UI worktree
corepack pnpm --filter @remote-codex/thread-ui typecheck
corepack pnpm --filter @remote-codex/thread-ui exec vitest run src/components/graph-workspace/explorer/workspaceDocuments.test.ts src/i18n/i18n.test.tsx
corepack pnpm --filter @remote-codex/thread-ui build
# 在主 worktree：刷新自身 file 依赖后验证消费者
corepack pnpm install --offline --frozen-lockfile
corepack pnpm --filter @remote-codex/supervisor-web typecheck
corepack pnpm --filter @remote-codex/supervisor-web exec vitest run src/pages/useThreadWorkspaceAdapter.test.tsx
corepack pnpm --filter @remote-codex/supervisor-web build
```

共享 UI state/i18n 12 项、Web adapter 2 项通过。typecheck、shared UI build 和消费者生产 Web build 通过；消费的 33 个 dist 文件逐个 hash 一致。Worker 从 package export 由宿主 Vite 显式打包，真实浏览器 diff 成功渲染。

```bash
PATH="$PWD/.temp/bin:$PATH" \
E2E_API_PORT=18184 E2E_WEB_PORT=15184 \
E2E_DATABASE_URL="$PWD/.temp/file-editor/e2e.sqlite" \
E2E_WORKSPACE_ROOT="$PWD/.temp/file-editor/workspace" \
FILE_EDITOR_SCREENSHOTS=/home/ubuntu/dev/remoteCodex/.temp/research/narrafork-implementation/screenshots/files \
corepack pnpm exec playwright test e2e/workspace-edit-safety.spec.ts e2e/explorer-actions.spec.ts \
  --project=desktop-chromium --grep-invert 'mobile editor'

# 同样隔离环境，仅选择手机场景
PATH="$PWD/.temp/bin:$PATH" \
E2E_API_PORT=18184 E2E_WEB_PORT=15184 \
E2E_DATABASE_URL="$PWD/.temp/file-editor/e2e.sqlite" \
E2E_WORKSPACE_ROOT="$PWD/.temp/file-editor/workspace" \
FILE_EDITOR_SCREENSHOTS=/home/ubuntu/dev/remoteCodex/.temp/research/narrafork-implementation/screenshots/files \
corepack pnpm exec playwright test e2e/workspace-edit-safety.spec.ts \
  --project=mobile-chromium --grep 'mobile editor'
```

桌面 4 项通过：草稿/undo/离页/隐藏后保护/保存关闭；真实 409/固定快照/二次冲突；真实已提交但丢响应/保存中新输入；原有下载/路径/rename/delete。手机 1 项通过：草稿、关闭选择、保存和无水平溢出。测试配置清空继承 REMOTE_CODEX_*，设置隔离数据库和工作区；未触及生产服务。fake harness 仅提供会话数据，文件接口和磁盘保存使用真实 Rust。没有运行线上 OAuth/多用户浏览器链路，relay 保障使用定向 ACL/tunnel 回归验证。

补充 pending 状态后只重跑受影响的定向浏览器用例（相同隔离端口/数据库/工作区环境）：`corepack pnpm exec playwright test e2e/workspace-edit-safety.spec.ts --project=desktop-chromium --grep 'lost save receipt'`，1 项通过；共享 UI draft-state 3 项也再次通过。

## 实际截图

`/home/ubuntu/dev/remoteCodex/.temp/research/narrafork-implementation/screenshots/files/`：

- `desktop-editor.png`：1440×1000，中文深色主题，A/B/A/undo 后保留草稿，dirty 标签、下载、磁盘检查和保存动作。
- `desktop-conflict.png`：1440×1000，真实外部文件变化触发 409，固定 diff、有色差异、继续编辑/采用/条件覆盖/下载。
- `mobile-editor.png`：390×844，主题文字清晰、dirty 标签、文本草稿、保存/关闭操作，无水平溢出。

生成 fixture 与断言保存在 `e2e/workspace-edit-safety.spec.ts`；截图目录另有生成脚本和 caption。截图是产品页面，不是静态 mock，也不表示已经集成布局线程的独立分支。
