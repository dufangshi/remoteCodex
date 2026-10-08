# 文件浏览器：新建文件

本功能在 `preview/narrafork-editor-workbench` 与共享 UI 预览分支实现，尚未合入 main、push 或部署。

文件树工具栏新增“新建文件”。选择目录时默认其路径，选择文件时默认所在目录；可以填写工作区相对路径。父目录必须已存在，不会隐式创建目录。取消不写盘。确认后创建空文件，刷新并展开父目录，选中、固定文件标签，并在支持安全编辑时直接进入编辑模式。手机创建后切换到文件编辑视图。

同名文件、目录或符号链接不会被覆盖；重试也不会截断已经创建的文件。保留冲突错误和路径输入，允许修改名称后重试。已存在未保存草稿的同一路径必须先处理草稿，不能因重建文件丢弃它。读取/打开失败与创建失败分开提示，避免用户把成功创建误当成失败再次创建。

## 接口与权限

`POST /api/workspaces/{id}/files`，JSON `{ "path": "docs/new.md" }`，成功返回 201 与 `{ "path": "docs/new.md" }`。创建的是空文件，正文沿用既有 document/条件保存 API。该 POST 只允许 workspace write 权限；read adapter 不提供 createFile。旧运行时不支持时显示更新提示，不降级调用无条件 PUT。

Rust managed mutation gate 与现有保存/移动/删除共用。Unix 使用目录 fd + openat，父目录不跟随符号链接，最终创建 O_CREAT|O_EXCL|O_NOFOLLOW 并同步文件与目录；其他平台使用 create_new 与既有工作区路径校验。本轮只验证 Linux，没有平台矩阵。拒绝绝对路径、..、控制字符、反斜杠、空路径段；父目录不存在时失败，不写到工作区外。

创建不是保存回执机制；网络或 fsync 失败后需要检查文件树，重试遇到同名仍拒绝，不会自动回滚或覆盖。未知扩展名可创建，但显示/编辑能力依旧按既有预览与安全文档能力判断。

## 验证

定向 Rust create_file 2 测试、HTTP创建/重复/越界/文档读取 1 测试、Relay ACL 1 测试通过；格式检查及新 CLI debug build 通过。Web adapter 3 项测试、Web 与共享 UI 类型检查、共享 UI build 与 file dependency 刷新通过。桌面 Chromium 和手机 Chromium 新建文件专项各 1 项通过：目录默认路径、Escape 取消、创建后直接编辑并安全保存、重复路径不覆盖、非法路径拒绝、改名重试。


浏览器验收发现并修正空 Monaco model 默认 CRLF 导致首次多行输入被安全接口拒绝的问题：编辑器统一输出 LF 草稿，由现有保存 API 恢复文件磁盘换行格式。创建等待期间另一个 pane 新编辑的同路径草稿也会被保留，成功创建后的打开失败单独提示。

截图：[桌面新建后编辑](assets/narrafork-preview/files/desktop-new-file.png)、[手机新建后编辑](assets/narrafork-preview/files/mobile-new-file.png)，独立哈希清单为 `files/creation-manifest.json`。旧文件编辑截图未替换。输入区预览见 [紧凑输入区](narrafork-composer-preview.zh.md)。

最终专项命令：

```bash
# 以下从预览主仓执行；两个 project 顺序运行
PATH="$PWD/.temp/bin:$PATH" E2E_API_PORT=18206 E2E_WEB_PORT=15206 \
E2E_DATABASE_URL="$PWD/.temp/new-file/e2e.sqlite" \
E2E_WORKSPACE_ROOT="$PWD/.temp/new-file/workspaces" \
FILE_EDITOR_SCREENSHOTS="$PWD/.temp/new-file/screenshots" \
corepack pnpm exec playwright test e2e/workspace-edit-safety.spec.ts \
  --project=desktop-chromium --grep 'new file opens' --output .temp/new-file/desktop-results
# mobile 同样参数，--project=mobile-chromium --output .temp/new-file/mobile-results
```

日志在预览工作区 `.temp/new-file/`：`runtime-final.log`、`http.log`、`acl.log`、`fmt.log`、`build.log`、`adapter.log`、`web-typecheck-final.log`、`ui-build-lf.log`、`ui-typecheck-final.log`、`desktop-lf.log`、`mobile-final.log`。排障中出现过并行依赖重建造成的 Vite 504，依赖稳定后顺序验收通过；测试选择器也按目录完整路径及空文档 Monaco EditContext 调整，没有用 force 或增加重试掩盖失败。
