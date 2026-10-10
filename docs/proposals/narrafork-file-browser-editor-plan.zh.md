# 文件浏览与编辑优化详细方案

日期：2026-10-07（任务日期）。任务 #1；本轮仅设计，不实现产品代码。

**建议先补“安全保存 + 每文件缓冲区”，随后补目录与文件变更感知，再扩展搜索和大文件传输。我们已经有 Monaco、预览/固定标签、聊天/文件分栏、虚拟文件树、上传下载及重命名/删除，不应重造编辑器。** 最直接的收益是：用户打开文件后 agent 改了文件，用户保存时看到可处理的冲突；切换标签不会丢草稿；设备断线不会把未知结果当成失败再覆盖一次。

## 1. 范围、基线和能力归属

| 对象 | 固定版本/提交 | 本次核实范围 |
| --- | --- | --- |
| Pockymoe 主仓库 | `ffb07d8b17c08af5aa601a67af6e9f058a5a25ac`；共同报告底层业务基线 `94edcfadc8a6dda5ebc23271ee582709d32af171` | Rust runtime 文件方法、Supervisor HTTP、relay ACL、Web adapter、现有 E2E 源码 |
| 真正共享 UI 仓库 | `8e4c384d81012c229d1a780ea175fa2dbaa5c82b` | `packages/thread-ui/src` 的 graph-workspace、Monaco、标签、目录模型和预览 hook |
| NarraFork 只读参考 | `4e04d2f2e490bd57a5d8d712b709a574b905848a` | frontend 文件树/编辑器、editor-document 路由/service/worker、file-change 本地写盘、Go executor 条件写与传输 |

共同输入是 `docs/narrafork-comparison-2026-10-07.zh.md`。以下结论来自上述固定源码的静态追踪，没有运行 NarraFork、Agent、浏览器、构建或测试，也没有访问模型凭据；功能边界不等于运行可靠性或性能结论。

能力归属必须清楚：

- **控制面功能**：浏览目录、读取/保存文件、草稿、冲突 UI、权限检查、变化通知，落在 Rust `crates/` 与共享 React UI。
- **harness 原生功能**：模型自行读写文件、shell/apply_patch、原生 CLI 编辑工具。它们不一定经过 Supervisor 的 ACP `fs/write_text_file`，不能被一个 Web 保存锁完全协调。
- **ACP 薄适配功能**：只有经过 ACP 文件请求的路径可以复用控制面文件写入/失效通知；不要为此接管工具循环，不恢复 TypeScript supervisor 或拆出多个 coordinator。
- **本方案设计**：后文接口、状态、阶段与阈值均为提议；不是当前已实现能力。

## 2. 双方当前能力与关键实现对照

### 2.1 我方完整生产链路

`GraphWorkspaceExplorer` → `useWorkspaceFilePreview` → `ThreadWorkspaceAdapter` → Web `useThreadWorkspaceAdapter` / `lib/api.ts` → `crates/supervisor/src/http.rs` → `RuntimeService` (`service.rs`) → `crates/runtime/src/files.rs` → 设备磁盘。浏览器经 relay 时仍由设备 Rust Supervisor执行文件操作，relay 不应获得明文文件副本。

| 能力 | 当前事实 | 源码锚点 |
| --- | --- | --- |
| Monaco 编辑 | 懒加载 Monaco、语言、主题、Ctrl/Cmd+S、行号定位；模型 URI 目前主要由 path 构造 | [U1] `GraphWorkspaceMonacoEditor.tsx:88,131,183` |
| 标签、分栏、保护 | 已有预览标签/固定标签；dirty 自动固定；dirty 关闭有 Keep editing/Discard；重命名/删除检查 dirty。已有聊天/文件分栏 | [U2] `GraphWorkspaceExplorer.tsx:144,269,295,392`；[U3] `WorkspaceFileTabs.tsx:32,91`；[U4] `ThreadWorkspaceLayout.tsx:1306` |
| 编辑门槛 | 完整文本且 ≤50 KiB、≤1000 行才可编辑；部分分子文件走专用预览 | [U5] `GraphWorkspacePreviewPane.tsx:94,128,448` |
| 文件树 | 按层懒加载、目录错误/重试、刷新 generation、祖先定位、选择/展开持久化、过滤/高亮、紧凑目录、键盘与 ARIA、虚拟行 | [U6] controller `:148,156,251,504`；[U7] tree `:68,85,147,205`；[U8] projection `:40,60,75` |
| 空目录 | Rust 按层列目录，初始目录标记未加载；HTTP 列出空目录后 `childrenLoaded:true, hasChildren:false`。不是“不支持空目录” | [R1] `files.rs:105`；[R2] `http.rs:826`；[U9] model `:20` |
| 文本预览与分页 | UI 首次请求 24,000 bytes，继续加载传 offset；Rust HTTP Query 仅有 path，runtime 固定64 KiB；`preview_file` 先读完整文件再截断，并用 lossy UTF-8 | [U10] preview hook `:17,86,120`；[R2] HTTP `:821,850`；[R3] service `:968`；[R1] files `:139` |
| 保存 | UI 传 path/content，保存后全树刷新再重读；Rust `std::fs::write`，没有 expectedHash、保存回执或冲突结果 | [U10] `:149`；[R4] Web adapter `:69`；[R2] `:914`；[R1] `:312` |
| 格式预览 | 已有图片/PDF/Markdown/draw.io/分子等；已按扩展名下载兜底，未知二进制由文本特征判断；draw.io 用认证下载绕过旧64 KiB预览限制，并限8 MiB | [U11] preview policy；[U10] `:62`；[R4] `:43` |
| 变化订阅 | 共享 adapter 有 `subscribeWorkspaceChanged`，controller 180ms 防抖后刷新树；本 Web adapter 没有实现该订阅。文件内容读取也不是目录刷新必然触发 | [U12] adapters `:134`；[U6] controller `:557`；[R4] adapter 返回对象 |
| 上传下载 | UI 单文件选择、Workspace上传；Rust multipart ≤50 MB，支持 path 字段但 Web 没传，实际落到根目录文件名；覆盖写。文件流下载、目录ZIP（<1000文件且<1GB），包含目录项、跳过symlink | [U13] actions `:29`；[R5] api `:1279`；[R2] HTTP `:1983`；[R3] service `:992`；[R1] download `:166` |
| 路径/权限 | `assert_within` canonicalize已有祖先并拒绝越界；rename/delete拒绝选中symlink和workspace根。linked host文件是owner-only只读。relay区分workspace读/写 | [R1] `:28,61`；[R4] `:24,38,70`；[R6] `route_acl.rs:174` |

几个实际问题不能被“已有标签”掩盖：`GraphWorkspacePreviewPane` 只有一个组件局部 `draftContent`，`previewFile.path/content` 改变即重置（[U5]（行488））。切换到另一个文件后，没有按文件保存的草稿；dirty标签集合并不等于草稿存储。当前保存完成还会读回文件并替换preview；若用户在保存过程中继续输入或切走，异步结果缺少按文档 revision/identity 结算的保护。这些是静态代码风险，尚未运行复现。

### 2.2 NarraFork完整生产链路及限制

本地编辑链路：`dock/panels.tsx` 文本文件入口 → `FileEditorContent` → `EditorSession` → `frontend/lib/api/editor-documents.ts` → `server/routes/editor-documents.ts` → `EditorDocumentService` → worker生成版本/检查哈希/编码 → `executeEditorFileChange` → file-change runtime记录before/intended/effect → `fileChangeLocalIo.apply` → 磁盘及回执。关键衔接见[文档service][N15]与[file-change入口][N16]。

| 能力 | 已核实实现 | 不能扩大解释的限制 |
| --- | --- | --- |
| 文件树 | 每层懒加载、in-flight去重、root/context token抵御A→B→A旧请求；hidden选项；目录错误；过期目录并发3重新校验 | `FileTreePanel`只为`deviceId === local`设置root；远端显示不支持。树使用Mantine非虚拟化，每目录显示前1000项并明确截断 [N1][N2][N17] |
| 文件树事件 | `useFileTree`支持路径patch/过期标记 | 当前Panel把legacy `workspace_paths_changed`转为`ingest([],true)`，重新校验当前树，不能写成“生产入口始终精确增量patch” [N1]（行76） |
| 文档版本 | 文档会话、immutable version handle、baseHash、encoding/eol；上传先seal再commit，snapshotRevision关联回执；有用户/session/temp预算 | 当前路由明确拒绝remote editor transfer；不能把它描述成已完成远程编辑产品 [N3]（行68）；[N4] |
| 并发保存 | worker将磁盘decoded text hash与baseHash比较，409 STALE_WRITE返回currentHash和冲突快照handle；编码可无损往返校验 | 它用decoded text hash，不是原始bytes hash；传输归一化LF、保存按原文件主要换行恢复，会归一化混合换行 [N5]（行159）,244 |
| 冲突交互 | worker计算有限diff（每侧32 Ki字符）；下载完整固定冲突版本；keepMine仅将baseHash切换到冲突版本、草稿仍dirty，下一次保存仍校验；takeTheirs检查期间draft revision | 这不是自动三方合并；未见该编辑入口的实时外部内容变更横幅订阅，主要由保存发现冲突和人工reload [N6]（行626）,925；[N7]（行598） |
| 草稿/离开保护 | 保存不可变Monaco快照，可继续编辑；回执只更新该snapshot基线；unknown阻止再次保存；beforeunload和dock关闭/拖动exit guard | 此次未核实浏览器崩溃后跨重启持久恢复草稿，不能把模型内快照当成持久备份 [N6]（行390）；[N7]（行313）,413；[N8]（行967） |
| 大文本 | 有20 MiB编辑文档预算、64 MiB传输预算、worker池/队列/内存预算；面板>1 MiB进入确认/分页路径 | 这些是不同入口与预算，不能声称所有20 MiB文件都从树一键完整可编辑；更不能不测就移植阈值 [N4][N9][N10] |
| 本地写盘 | file-change runtime先记录证据，重读before和对象身份，再在fd上truncate/write/sync/验证；结果区分未应用/应用/不确定 | 本地编辑生产路径不是“temp+rename原子替换”；源码自己说明不是OS级CAS。它能控制自家工具，不代表能排除任意外部writer [N11]（行238） |
| Go executor | `FsWriteConditional`检查expected bytes/路径身份、metadata，写同目录temp、sync、再校验并平台替换；transfer有chunk、manifest续传、sha256与rename提交 | 独立底层能力，不能跨越editor-documents远端拒绝；transfer的内容digest校验不等于目标旧文件版本校验；条件写仍明确不是OS CAS [N12][N13] |
| 下载 | `/api/fs/download` 单文件附件，2GiB上限，Content-Length/no-store/nosniff | 文件树本身没有我方现有那样的上传/目录ZIP流程；不能笼统说我们缺上传下载 [N14] |

## 3. 具体差距、保留项和目标行为

| 方面 | 当前差距/风险 | 目标行为与优先级 |
| --- | --- | --- |
| 导航/展开 | 我方基础比“补树”完整；刷新根和已展开目录串行await，展开多时产生多次远程RTT；错误时`adapterModel=null`可能退回artifact fallback | 保留旧树标stale；局部重试；按祖先拓扑分层、同层并发3；in-flight去重+取消；P1 |
| 搜索 | 我方过滤只搜索已加载model，已有`hasUnresolvedDirectories`提示；双方所读树入口都不应当成全工作区搜索 | 保留“已加载目录过滤”；另加“搜索工作区文件名”，设备端有界遍历，debounce/cancel，结果点击复用祖先reveal；P2 |
| 隐藏/忽略 | 我方list_tree不筛dotfiles；对方明确showHidden。不能直接把默认隐藏套上去，让用户找不到.env等 | 显示隐藏文件开关；与ignore规则独立；搜索默认尊重.gitignore/忽略大目录，可显式包含；不改变读写权限；P1/P2 |
| 空目录 | 未加载与已加载空在模型已有区分；初始hasChildren:true仅表示可探测，不应宣称目录确有内容 | unknown/loading/empty/error/partial分离；空目录可选中、上传目标可用；空不是权限拒绝；P1 |
| 刷新/监听 | 我方有订阅扩展点但Web没接通；刷新树不保证内容重读；对方实际也有全失效fallback | 内容和树分别失效；文件stat/版本重验证先于重载；dirty绝不覆盖；P0手动/P1主动通知 |
| 延迟/离线 | 预览取消仅忽略完成结果，不能中断网络；树generation已有较好保护；loadMore只检查path，A→B→A可能接收旧响应 | adapter支持AbortSignal及resourceGeneration；最后一次成功内容保留；显示离线/缓存时间；手动重试；P0/P1 |
| 路径边界 | canonical根边界已有；检查后使用路径仍有TOCTOU；文件列表未标symlink，to_string_lossy可能使非UTF-8文件名无法可靠回寻 | 返回isSymlink/可操作性；先继续禁止linked写；编辑拒绝symlink祖先/特殊文件；服务端路径身份复验；非UTF-8名字先只读且解释原因；P0/P1 |
| 权限 | UI能力门控已有，不能只靠按钮；新路由容易漏relay allowlist和read-only shared workspace边界 | 服务端逐次授权；conflict/operation同源workspace和actor绑定；下载/订阅不扩大共享范围；权限撤销保留草稿但禁写；P0 |
| 大文件 | Rust先读全文件再截断；UI分页与Rust不一致；编辑现有小文本门槛合理 | P0关闭旧runtime无效“继续加载”并修有界读；P1真实byte分页+版本；P2按预算逐步提高编辑上限 |
| 二进制/编码 | 后端lossy decode后再由前端启发式识别，可能把未知编码文本当可编辑或丢字节 | 后端严格utf8分类、BOM/EOL元数据；不支持编码只读下载，禁止lossy内容回写；P0 |
| 上传 | 已有50MB单文件但默认为根文件名、同名覆盖；UI没传目标path；无进度/取消/版本保护 | 上传到当前选中目录；默认createIfAbsent，同名选择改名/对比/有条件替换；独立上传状态；P1 |
| 下载 | 文件后端流式，但Web`downloadFile`返回Blob，浏览器仍可能把大文件放内存；目录ZIP有明确预算 | 保留ZIP及上限；UI先显示限制、进度/取消/错误；P2增强端到端加密分块/续传，不绕relay传明文 |
| 文件操作 | 已有rename/delete；重命名仅拦dirty集合不足以解决被切走丢draft；删除的版本也可能已变化 | 文档store统一阻止有draft子树操作；返回路径映射更新tab/model，外部rename先missing避免错绑；P1 |

## 4. 保存协议：baseHash / expectedHash与写盘边界

### 4.1 版本定义

我方建议统一为**服务端原始文件bytes的SHA-256**，格式`sha256:<hex>`，称`contentHash`；首次读取后保存为UI的`baseHash`；写请求传`expectedHash: baseHash`。不要混用Monaco LF文本hash、mtime或文件长度充当版本。

这样CRLF→LF、BOM变化、编码变化都会被识别。代价是两个语义相同但bytes不同的版本也会冲突；这是有意保守。NarraFork的decoded-text hash值得理解但不直接复制，避免其baseHash/transfer digest两套语义进入我方小文件第一阶段。

P0只编辑存在的完整UTF-8常规小文件，保留现有≤50KiB/1000行门槛；保存后也检查编码后bytes/行数预算。新建文件另加`createIfAbsent`语义，不能用空字符串expectedHash模拟不存在。删除之后保存进入missing冲突，绝不自动重建。

`workspaceRevision`绑定设备端workspace物理根身份的opaque generation；同ID换根、worktree更换/重建必须使旧generation失效。`path`统一相对workspace、斜杠；`fileIdentity`为不暴露inode/绝对路径的opaque对象身份，防同一路径被替换且bytes恰好相同的旧文档误写。绝对linked文件继续走现有owner-only只读入口。

### 4.2 受控保存步骤

1. 校验访问者、workspace读写scope、请求长度、workspaceRevision、相对路径与常规文件类型；禁止symlink祖先/特殊文件。先授权再返回存在性、哈希和冲突正文。
2. 以canonical workspace + canonical file为键获取进程内写锁；同一物理文件经不同workspace别名必须合并键。控制面受管写入（编辑、上传、ACP回调）共用此底层串行入口，单独考虑rename/delete目录锁顺序；P0不引入多个协调器。
3. 有界读取当前bytes、对象身份与元数据；比较expectedHash/fileIdentity。变化即409，**未写盘**。保留当前版本快照供冲突对照；不直接塞入超大错误响应。
4. 从本次固定`draftRevision + content`构建输出；按原encoding/BOM/EOL规则编码。创建同目录临时文件，写完并sync；先保留所需mode/metadata，不在写了一半时truncate原文件。
5. 最终再授权、验证根/父目录/文件身份、重读版本；变化则清理temp并409。在平台支持且能保留权限/metadata时替换目标，完成必要sync和目标验证，再记录saved回执。无法安全保留metadata时拒绝并给出可恢复错误，不悄悄退回直接truncate。
6. 发出文件/父目录失效事件。若其后外部writer又写入，回执仍只代表本次提交的版本，不宣称此刻磁盘始终相同。响应返回本次实际保存版本和draftRevision，UI结算此文档此revision。目录更新失败不能把已经保存的结果改成“保存失败”。

**这个步骤不是针对所有外部writer的强原子CAS。** 进程内锁只串行化经过该入口的写；原生harness shell、自带工具、IDE、其他进程可以在最后检查与rename间写入。原子替换避免半文件，不等于条件检查和替换为一个OS事务；replace还会改变inode、影响hardlink和某些watcher。P0承诺“保存前发现已变化即拒绝，受管并发串行”，不承诺任意外部并发绝不覆盖。保持有限before备份/结果记录，并明确最后窗口；需要更强保证时另评估OS能力/合作文件锁及agent worktree隔离，不能靠浏览器锁或强制暂停所有agent假装解决。

P0先对普通文件验证平台替换策略；hardlink数>1、无法复制owner/ACL/xattr、网络/特殊文件系统、Windows共享冲突等先拒绝安全编辑并支持下载草稿。不要以“在Linux通过”为依据承诺所有平台；实现只跑受影响平台的针对回归，完整平台矩阵仍需显式请求。

### 4.3 保存期间继续输入

每文件store保留`baseContent/baseHash/currentContent/draftRevision`。点击保存捕获不可变`submittedContent/submittedRevision`；一次文档最多一个in-flight保存，继续输入生成更高revision。

- 成功且当前revision等于submittedRevision：更新base、清dirty。
- 成功但用户继续输入：base切到submittedContent/新hash，currentContent和undo不变，仍dirty。
- 成功但用户已切到另一标签：只更新原文档store；不改变当前选中项、不重新初始化当前编辑器。
- 控制面刷新/外部通知：不触碰dirty/currentContent；另存diskVersion/externalChanged。
- 禁止`onSave → 全树refresh → readFile → setPreviewFile`作为保存结算主路径；当前链路应拆开。保存回执就是本次保存版本，额外refresh失败只显示“保存成功，目录更新待重试”。

### 4.4 失败与“结果未知”

网络timeout/5xx/浏览器取消不能证明未写盘。新保存请求携带`operationId`；设备持久存最小保存日志（owner、workspaceRevision、path、inputDigest、expectedHash、intendedHash、draftRevision、phase、result、时间），**先intent后提交**，结果可查询，重复同ID返回原结果或pending/uncertain，不再次写盘；同ID不同input报409 `operationIdReuse`。

- 明确校验拒绝：`failedBeforeWrite`，草稿保留，可修正后用新operationId再保存。
- 目标替换成功且回执已记录：`saved`；丢响应后查询原operationId结算。
- 崩溃后只有intent或出现post-commit核验失败：`uncertain`；不自动重放。允许读取最新文件并对照、下载草稿、人工重新建立base。磁盘bytes等于intendedHash只能说明“当前磁盘与提交内容相同”，不能证明本操作一定执行，也不能跳过新的版本前提。
- 仅sync/替换前失败应明确未应用；替换后sync/record失败要返回不确定，不能声称磁盘原样。
- 轻量journal与有限before备份放设备本地，沿用数据库/私有数据目录和迁移方式；建议24h TTL、每workspace/actor预算、活动operation不清理，超额在写前拒绝；不为P0建设完整文件历史CAS仓库。

## 5. 每文件文档store、外部变更和离开保护

建议新增 `useWorkspaceDocuments` 与纯状态模块。key包含 `relayOwnerScope/deviceId/workspaceId/workspaceRevision/normalizedPath`；Monaco URI包含设备/workspace身份，不能只用`/src/index.ts`在两台设备间复用同一model。共享UI通过adapter获得不透明resourceScopeKey，不与某个Web relay实现耦合。

```ts
type WorkspaceDocument = {
  resourceKey: string;
  path: string;
  baseContent: string;
  baseHash: string;
  fileIdentity: string;
  currentContent: string;
  draftRevision: number;
  savedRevision: number;
  phase: 'loading' | 'clean' | 'dirty' | 'saving' | 'conflict'
    | 'unknown' | 'missing' | 'readOnly' | 'error';
  externalChanged: boolean;
  encoding: 'utf-8';
  bom: boolean;
  eol: 'lf' | 'crlf' | 'mixed' | 'cr';
  operationId?: string;
  diskSnapshot?: { versionId: string; contentHash: string; content?: string };
};
```

这是协议示意，不要求在一个对象里重复持有所有大文本。P0小文本可用字符串基线；后续按预算用Monaco model/snapshot、worker进行hash/diff，并LRU释放clean未活动model。dirty文档不得因cache eviction丢弃。

| 状态/动作 | 产品表现 | 恢复规则 |
| --- | --- | --- |
| clean，磁盘变化 | 标签“磁盘已更新”，可显示新版本预览；自动更新须保留selection/scroll且revision仍clean | 更新base/model前再次检查用户没有开始输入；不重置正在编辑的draft |
| dirty，磁盘变化 | 标签dirty点 + “磁盘另有修改”；保存将做expectedHash检查 | 提供查看差异、保留草稿、重新加载；不自动合并或自动覆盖 |
| saving | “正在保存此版本”；可继续输入/切标签 | 关闭此tab可等待结果或保留store；不能中止HTTP后认为写取消 |
| conflict | 当前草稿可编辑；独立冲突对照区 | 见第6节；新外部变化使旧冲突标记过期，但不销毁固定快照 |
| missing | 文件已删除/路径失效，草稿仍在 | 下载草稿或“另存为”新路径；不把下一次Ctrl+S当自动创建 |
| readOnly/权限撤销 | 现有内容/草稿可查看、导出；保存禁用 | 重新授权/重新打开后重新检查版本；不自动提交旧草稿 |
| error/离线 | 保留最后成功内容与草稿，显示离线或失败原因 | 明确重试读/重试检查；禁止用空内容覆盖当前model |

**切换标签**：只换active document，不做discard，也无需每次询问；dirty预览标签自动固定（复用已有行为）。切换线程/工作区/设备导致store将卸载时显示“保存全部 / 放弃 / 取消”；有conflict/unknown不能用“保存全部”跳过处理。关闭单标签扩展现有Keep editing/Discard为“保存并关闭 / 放弃 / 取消”，只有真实saved且无新revision才关闭。

重命名/删除本文件或父目录继续受draft保护；路径重命名后模型URI迁移/标签映射由store统一处理，不能把新路径无条件绑定旧baseHash。外部rename没有可靠身份映射时先标missing，而不是猜测文件名并转存。

浏览器`beforeunload`只在dirty/saving/unknown时启用；SPA路由、设备选择、线程切换必须用应用导航guard，不能只依赖beforeunload。刷新时确认是P0的最低保护；P2加入有配额的IndexedDB草稿恢复（device/root/owner/hash隔离、按需启用、退出账号清理策略、过期/敏感目录不自动持久化），不能把localStorage布局持久化当草稿备份。

## 6. 冲突 diff 与重新应用

保留三份概念：**B**=打开/上次保存的完整基线，**M**=当前用户草稿，**T**=服务器发现冲突时的固定磁盘快照。diff默认比较M↔T，另可看B↔M和B↔T；第一阶段复用Monaco diff能力，不更换编辑器或引入Dockview。

P0动作：

1. **保留草稿，继续编辑**：不改baseHash、不写盘，关闭对照后标签仍conflict/dirty。
2. **采用磁盘版本**：明确放弃当前草稿确认；读取固定T，核对版本handle和当前draftRevision，期间有新输入则中止替换；T成为base，检查实时磁盘可能已更新，不能标为“最新”直到复验。
3. **将我的版本覆盖到所展示版本**：明确显示覆盖含义，用户确认后以`expectedHash=T.hash`提交M；不是`force:true`绕过校验。T之后又变则再次409。
4. **下载草稿/冲突版本**：固定版本下载需绑定workspace权限和TTL；下载“实时文件”与“冲突快照”必须有不同名称，避免误以为同一份。

P1再增加**重新应用我的修改**：计算B→M patch，尝试应用到T生成候选C；不重叠变更可自动生成候选，重叠hunk要求手工选择。应用只改草稿与显示基线T，需用户再保存；预览不足/截断时禁用自动patch；最终仍以T.hash做条件保存。不要把“保留我的版本”称作合并。P2可将大diff/patch计算搬到有界worker，保留取消、revision和资源身份。

冲突API返回的versionId指向不变bytes；若保存最终检查后才发现更大/二进制/编码变化，仍返回元数据并禁用不适用动作。版本过期返回410，UI保留M/B、重新获取T并解释差异基线已更新，不悄悄替换为另一个实时版本。

## 7. 编码、换行、预览和大文件

### 7.1 P0编码规则

- 只对完整严格UTF-8小文本开放编辑，允许UTF-8 BOM，单独记录`bom`；不通过`from_utf8_lossy`的文本回写。
- 传给Monaco的编辑文本可归一化LF，但服务端原始bytes hash不变；保存时根据原文件元数据恢复一致LF/CRLF和BOM，并保留用户文本中的末尾换行状态，禁止默认trim/补newline。
- `eol:mixed`或裸CR暂只读，说明“混合换行暂不支持安全编辑”；可以下载并本地处理。后续提供显式“统一换行”动作，不能无提示归一化。
- UTF-16/GBK等P0只读下载并标“编码不支持编辑”；UTF-8解码失败与二进制分开可表示unknown，不能启发式猜编码后自动写。
- P2按实际需求引入`encoding_rs`等已评估方案、BOM检测和往返验证；字符不可表示则写前拒绝，保留draft；保持raw contentHash。NarraFork检测/重编码是一项后续能力，不是P0前提。

### 7.2 预览与分页

新后端先metadata/type检查，再打开常规file做有界read，不能读任意GB文件进内存。P0可保留旧preview响应形状，修内部读取为limit+UTF-8边界所需少量bytes，unknown binary只返回描述/下载入口；需要完整hash的安全编辑走独立小文件document入口。

P1分页以**原始byte offset**定义，返回nextOffset为真实消费bytes；正确处理多字节UTF-8、CRLF、BOM和最后残片。各页绑定同一个contentHash/readVersion；磁盘变化则409 `fileChanged`、清除组合预览并提供重新载入，禁止把不同版本拼成一个假文件。可使用短期readVersion快照避免每页重新hash大文件，但其配额/过期必须明确。

旧runtime不advertise`textRangeRead`时隐藏“继续加载”，显示“此设备仅提供首段预览，下载完整文件”；检测`nextOffset <= requestedOffset`即终止并提示，不能继续拼接重复首段。当前draw.io完整下载兼容路径保留，直到新能力已启用且验证CSP、压缩页与8MiB限制，不能为统一接口把它退化成截断XML。

P2大文本提升分两步：先完整只读≤1MiB显式加载，再评估≤5/20MiB编辑。阈值是候选，不是已测结论；同时限制bytes/UTF-16 chars/最大行长、model数、diff预算、worker总内存。移动端维持更低预算；过大/长单行关闭昂贵tokenization/wrap，提供分页与下载。每侧diff截断只用于显示，绝不成为可保存全文。

## 8. Rust API、协议与UI改动草案

### 8.1 P0新增能力与安全编辑端点

为避免旧runtime**静默忽略新增expectedHash字段**，安全UI不直接给旧`PUT /files`增加字段后继续用。新增独立`/files/save`，未知路由明确失败，不允许回退到无条件写。保留旧接口供兼容消费者，标出其缺少条件保存保护；新UI在老设备降为只读预览，并提示通过Settings Check/Update升级。版本号判断不如明确能力广告可靠。

```http
GET /api/workspaces/{workspaceId}/files/capabilities
```

```json
{
  "workspaceRevision": "wr:opaque",
  "conditionalSave": true,
  "documentRead": true,
  "textRangeRead": false,
  "workspaceChanges": false,
  "maxEditableBytes": 51200,
  "maxEditableLines": 1000,
  "encodings": ["utf-8"]
}
```

能力响应还须结合当前访问者scope；read-only消费者可以了解兼容性，但不能得到写权限。不能把`conditionalSave:true`当成授权。404/旧设备当能力缺失，不连续重试。

```http
GET /api/workspaces/{workspaceId}/files/document?path=src/main.rs
```

```json
{
  "path": "src/main.rs",
  "workspaceRevision": "wr:opaque",
  "fileIdentity": "fi:opaque",
  "contentHash": "sha256:abc...",
  "content": "fn main() {}\n",
  "size": 13,
  "language": "rust",
  "encoding": "utf-8",
  "bom": false,
  "eol": "lf",
  "readOnlyReason": null,
  "truncated": false
}
```

过大/编码不支持返回元数据与`readOnlyReason`，可省略content，不能让UI以空string初始化可保存文档。`fileIdentity/workspaceRevision`由服务端颁发并校验，不接受客户端伪造物理路径。

```http
POST /api/workspaces/{workspaceId}/files/save
Content-Type: application/json
```

```json
{
  "path": "src/main.rs",
  "workspaceRevision": "wr:opaque",
  "fileIdentity": "fi:opaque",
  "expectedHash": "sha256:abc...",
  "content": "fn main() { println!(\"hello\"); }\n",
  "draftRevision": 7,
  "operationId": "uuid"
}
```

```json
{
  "status": "saved",
  "operationId": "uuid",
  "draftRevision": 7,
  "path": "src/main.rs",
  "contentHash": "sha256:def...",
  "fileIdentity": "fi:newOpaque",
  "size": 33,
  "encoding": "utf-8",
  "bom": false,
  "eol": "lf"
}
```

示例hash/size仅示意，实际由服务端计算。encoding/EOL第一阶段继承document描述，不允许请求任意改成未经支持的编码。

```json
{
  "code": "fileConflict",
  "message": "文件已在磁盘上变化",
  "operationId": "uuid",
  "path": "src/main.rs",
  "currentHash": "sha256:ghi...",
  "currentFileIdentity": "fi:currentOpaque",
  "conflictVersionId": "fv:opaque",
  "size": 42,
  "encoding": "utf-8",
  "eol": "lf",
  "deleted": false
}
```

409 conflict；404 missing；403 forbidden/pathOutsideWorkspace；413 fileTooLarge；415 unsupportedEncoding/binaryFile；409 workspaceChanged/fileIdentityChanged/operationIdReuse；507 insufficientStorage；503 saveBusy。对缺失文件的409可用`deleted:true,currentHash:null`，UI一律进入missing保护，不自动重建。错误使用现有ApiError封装，扩展typed details，不能只throw message丢失conflict数据。

```http
GET /api/workspaces/{workspaceId}/files/operations/{operationId}
GET /api/workspaces/{workspaceId}/files/versions/{versionId}
```

前者返回`status: pending|saved|failedBeforeWrite|uncertain`、draftRevision与结果；后者返回固定冲突版本（P0小文本可JSON，后续走有界stream），TTL后410。operationId/versionId不是访问凭证，读取仍授权并校验actor/workspace。新路由显式补relay allowlist及secure transport匹配；GET operation与version不允许任意枚举他人操作。

### 8.2 P1/P2目录与变化端点

```http
GET /api/workspaces/{workspaceId}/files/tree?path=src&cursor=opaque&limit=500&showHidden=true
GET /api/workspaces/{workspaceId}/files/preview?path=log.txt&offset=24000&limit=24000&readVersion=opaque
GET /api/workspaces/{workspaceId}/files/search?query=main&limit=100&cursor=opaque
```

tree保留现有root节点兼容形状，新增`directoryRevision,nextCursor,truncated,partialErrors`；单节点可新增`isSymlink,readOnlyReason`。不要把“unknown”伪装成hasChildren=true的确切事实；已有childrenLoaded保持。分页cursor绑定目录identity/revision，目录变化返回失效提示并保留旧列表，不重复/漏项却宣称完整。大目录枚举需要设备端scan/time预算，不止UI虚拟化；具体可用短期目录快照，不能无上限每页排序全目录。

变化通过现有加密事件通道承载（事件命名最终需按当前协议规范确定），示意：

```json
{
  "type": "workspaceFilesChanged",
  "workspaceId": "ws-id",
  "workspaceRevision": "wr:opaque",
  "eventCursor": "epoch:128",
  "changes": [
    {"path": "src/main.rs", "kind": "modified"},
    {"path": "src", "kind": "childrenChanged"}
  ],
  "rescanRequired": false
}
```

事件不带文件正文；订阅按workspace权限隔离。epoch/游标缺口、watch overflow、重连或根变化返回`rescanRequired:true`；UI使已加载目录/打开文档stale后有限重验证。原生harness变更依赖OS watcher/主动stat，不依赖模型工具事件；ACP/UI受管写额外主动失效可加速但去重。P0仅用户打开/重新聚焦/保存/显式刷新时重验证，P1加Rust watcher，按实际打开workspace引用计数、忽略噪声、合并批次。通知不能保证无丢失，保存哈希仍是最后防线。

文件名搜索由设备Rust做有界遍历，不让浏览器展开全树：默认文件名/相对路径，不混同内容grep；含`truncated,nextCursor,scannedCount,skippedCount`；取消token/AbortSignal、每workspace并发上限。读权限与树同一根边界，默认不跟symlink，unreadable目录计入skippedCount，不泄露未授权路径。

### 8.3 文件落点

| 层 | 既有落点及建议新模块 | 具体改动 |
| --- | --- | --- |
| runtime | `crates/runtime/src/files.rs`；按体积拆同域`files/document.rs`、`files/save.rs`、`files/watch.rs` | 有界读、strict decode、raw hash、条件保存/对象身份、metadata保留与平台替换、写锁与类型化错误；不重建TS控制面 |
| runtime service/存储 | `crates/runtime/src/service.rs`；现有数据库迁移目录 | workspaceRevision、操作日志/固定冲突快照生命周期、有限资源预算；存本设备，不放relay |
| ACP | `crates/runtime/src/acp/runtime.rs:2861` | 经此回调的写复用受管写锁/失效通知；保留原生协议请求形状，不要求所有harness新增expectedHash |
| HTTP | `crates/supervisor/src/http.rs`；视体积拆`workspace_files.rs` | capabilities/document/save/operation/version、参数/流预算、状态码；同步IO进spawn_blocking有界并发，避免占async reactor |
| Rust/TS协议 | `crates/protocol/src/lib.rs`、`packages/shared/src/index.ts` | DTO与serde `rename_all="camelCase"`、typed conflict、能力；Rust snake_case仅内部 |
| relay/传输 | `crates/relay/src/route_acl.rs`、Supervisor secure_transport路由/流匹配 | 新端点最小allowlist、read/write scope、固定版本读取；复用加密传输，新增流才改流匹配 |
| Web adapter | `apps/supervisor-web/src/lib/api.ts`、`pages/useThreadWorkspaceAdapter.ts` | typed错误、返回save result、signal、资源scope、能力探测；接workspace事件；上传目标path |
| 共享UI适配 | `pockymoe-thread-ui/packages/thread-ui/src/adapters.ts` | 新可选document/save/checkOperation/getVersion能力；保留老readFile/writeFile类型一段迁移期，但安全编辑不调用旧writeFile |
| 共享UI文档 | `components/graph-workspace/explorer/useWorkspaceFilePreview.ts`、新增`useWorkspaceDocuments.ts`/`workspaceDocumentState.ts` | 每文件状态、不可变保存revision、未知结果核验、内容/树刷新解耦 |
| Monaco/标签/导航 | `GraphWorkspaceMonacoEditor.tsx`、`GraphWorkspacePreviewPane.tsx`、`WorkspaceFileTabs.tsx`、`GraphWorkspaceExplorer.tsx` | 资源唯一URI、model/view state、dirty close扩展、固定diff；导航卸载guard向应用壳回调 |
| 文件树 | explorer controller/model/projection/tree/action | 局部stale、去重取消、有限并发、分页与hidden开关；保留现有virtualizer/keyboard/ARIA |

## 9. 典型用户流程

### 9.1 agent改了用户正在编辑的文件

打开`src/main.rs` → 完整小文件读取返回B/H0 → 用户输入M，标签dirty且固定 → agent原生工具写入T/H1 → P0用户保存时发现，P1事件提前显示“磁盘另有修改” → 保存带expectedHash H0返回409，不修改T → 展示固定T对照 → 用户手工合并或选择覆盖该T → 新保存expectedHash H1 → 若agent又写H2，再409；成功仅结算所提交revision。

不要求暂停agent才能编辑；UI可以提示“agent仍在运行，此文件可能继续变化”。发消息给agent属于用户主动协作，不是文件保存的隐含副作用。

### 9.2 编辑A、查看B、回到A

A改动后保存在A文档store和Monaco model；点击B只切active；A标签继续dirty；返回A保留内容、undo、selection/scroll。关闭A显示“保存并关闭/放弃/取消”；保存失败停留A，取消则继续编辑。任何refresh/newpreview不得用磁盘A替换草稿。

### 9.3 网络断线发生在保存之后

点击保存捕获revision7/op1 → 设备写盘，响应丢失 → UI unknown、草稿保留 → 重连查询op1；saved则只更新revision7基线，用户revision8仍dirty → 如果journal只能判uncertain，显示“结果需核验”，允许查看磁盘与草稿、导出；禁止自动发送op2覆盖。

### 9.4 搜索深层文件与慢目录

输入过滤词时明确“已加载目录”；选择“搜索工作区”后Rust有界返回相对路径 → 选结果复用祖先定位，以每层目录请求展开 → 目录失败只标该行重试，保留已有树/编辑区；设备断线保留缓存并注明未更新；取消搜索/换设备旧响应不能进入当前树。

### 9.5 上传到目录和同名处理

选中`assets/` → 选择上传 → 显示目标`assets/logo.png`及大小 → 默认createIfAbsent → 同名提示改名/取消/对比替换；替换必须绑定目标hash，上传传输digest仅校验输入bytes → 提交后只失效`assets/`，提示成功并选中新文件。取消/失败保留源文件，清理临时上传，不产生半文件；有dirty文档的同路径上传需先处理草稿。

### 9.6 大文件、二进制与权限变化

打开大log先metadata → 显示首段/明确分页、完整下载 → 不显示“可保存”截断文本；打开未知binary只给类型/大小/下载。权限撤销时读/保存返回403，保留当前草稿可导出，禁用写和相关操作；不要自动刷新为空白并清dirty。

## 10. 分阶段交付与验收

工作量为相对估算：S≈1–3工程日，M≈4–7，L≈8–15；包含针对回归和评审，不含跨平台完整验证/发布，受实现细节影响。以下是推荐切片，不是本轮已获实现授权。

| 阶段 | 范围与工作量 | 验收条件 | 兼容/迁移风险 |
| --- | --- | --- | --- |
| **P0A 安全文件协议** | 新能力/document/save；strict UTF-8与BOM/EOL；raw hash、条件保存、有限冲突版本、最小operation journal；有界preview；L | 外部先改→409且磁盘不变；两个受管同base保存最多一个成功；断线查原operation；超大/非法编码/symlink拒绝编辑；保存前失败不伤原文件；旧runtime不显示无效加载更多 | 新端点需relay ACL/安全传输接通；旧UI仍可无条件写是过渡遗留，文档标记；数据库迁移向后可读；不能依旧server忽略字段 |
| **P0B 文档store与冲突UI** | 保留Monaco/标签/分栏；按文件draft、revision保存、错误留稿、固定diff、关闭/卸载保护；M–L；依赖P0A合并交付 | A→B→A不丢内容和undo；保存期间打字不清dirty；切设备迟到响应不串；关闭保存失败不退出；冲突二次变化再409；目录刷新失败仍显示已保存 | 共享UI独立仓库与Web adapter须协调版本；其他宿主未升级adapter只读；model URI变化释放旧clean model，dirty必须先处理 |
| **P1 变化感知与目录一致性** | Rust watcher/事件、重连rescan；局部stale与并发3；hidden/空目录/部分错误；真实preview分页；上传目标/同名条件提交；冲突重新应用；L（应再拆2–3PR） | agent原生写后打开文档有变化提示；dirty不被重载；空目录/不可读目录区分；watch丢事件可手动/重连修复；分页无重复/UTF-8损坏/跨版本拼接；上传不会默认覆盖 | 事件跨workspace/设备scope与根generation；watcherFD和大目录预算；旧adapter退回显式刷新；上传覆盖语义需UI迁移提示 |
| **P2 搜索与大文件/恢复增强** | 有界文件名搜索；更大文档/worker；可选IndexedDB草稿；传输进度取消/加密续传；编码支持；L×多个独立切片 | 未展开路径可找到且有扫描限制；20k目录条目DOM仍虚拟；大文件按设备预算不卡死；草稿恢复只匹配正确设备根与owner；续传digest正确且目标版本校验独立 | 不随意扩大设备/浏览器内存；流协议/relay资源预算；本地敏感草稿隐私与配额；legacy编码不能silent转码 |

**最小第一阶段是P0A+P0B，只支持既有小文件编辑范围。** 不把watcher、全仓搜索、自动merge、20MiB编辑、跨浏览器共享草稿、CRDT或任意外部writer强CAS塞进P0；但typed冲突、每文件draft、revision回执和失败保护必须一起交付，单加expectedHash按钮仍会丢用户输入。

P0若平台metadata保留无法在预算内安全落地，先缩小可编辑文件/平台能力广告，在不支持的文件上只读和导出；不能用直接写回退换取表面可用。Windows Device Manager无bootstrap变化，本工作不涉及它的版本/seed或独立发布。

## 11. 验证建议：仅计划，不在本轮执行

按项目 `.agents/skills/focused-e2e/SKILL.md`：纯方案只检查文件与源码锚点，不构建、不跑应用测试。未来实施优先用最便宜有效层级；references/test-map是入口，实际现存源码优先，不能根据地图遗漏判定没有相关spec。

### 11.1 Rust与组件层

- `crates/runtime/src/files.rs`及新save模块的精准单测：raw hash/BOM/CRLF、invalid UTF-8、mixed EOL、size gate、路径/祖先symlink/FIFO、缺失文件、对象替换、final-check冲突、权限保留/磁盘满/temp cleanup、两次受管并发、operationId重放和崩溃pending。平台条件用本平台fixture，不默认全平台矩阵。
- Supervisor针对HTTP用例：document/save冲突码和details、read-only授权、操作/version scope、404旧能力、真实byte分页；可扩展`crates/supervisor/tests/http_e2e.rs`已有workspace文件场景，按test名运行。
- relay ACL精准测试：新增save只能write、document/version/operation按当前owner/scope，linked只读边界不放大。只有修改加密/stream边界才追加相关relay回归，不把全套relay测试当例行保险。
- 共享UI Vitest：新增文档状态reducer/组件覆盖A→B→A、保存revision7后又输入8、旧设备响应、unknown核验、conflict T再次变化、刷新不覆盖dirty、读取时又输入；扩展现有`WorkspaceFileTabs.test.tsx`/`GraphWorkspacePreviewPane.test.tsx`等。验证状态机制，不写“每个setter都有测试”。

具体cargo包名/测试名按实施代码定，执行`cargo fmt --check`及相关crate编译/选定测试；不默认`cargo test --workspace`。

### 11.2 浏览器串联最小集合

建议新建`e2e/workspace-edit-safety.spec.ts`，fake harness + 实际隔离workspace磁盘，不依赖模型、不mock掉保存持久化。只保留以下代表串联，组合下沉组件/API层：

1. `dirty file survives tab switch and guarded close`：编辑A→B→A验证文本；close取消保留；save-and-close实际落盘后关闭。
2. `external write conflicts and reapply uses new disk version`：浏览器读B后fixture写T→Ctrl+S→409并验证T磁盘仍在→diff和手动合并→expectedHash更新后成功。
3. `lost save receipt reconciles without overwriting later typing`：确实放行服务端提交、只丢响应→unknown→op查询→revision8仍dirty且只有一次文件提交；不能靠静态mock一个saved结果替代时序。

示例执行范围（未来，非本轮）：

```sh
pnpm exec playwright test e2e/workspace-edit-safety.spec.ts \
  --grep 'external write conflicts' --project=desktop-chromium
pnpm exec playwright test e2e/explorer-actions.spec.ts --project=desktop-chromium
```

第二条只在改上传/rename/delete/download衔接时运行。已有`e2e/explorer-actions.spec.ts`覆盖“下载、复制路径、重命名、确认删除”，没有覆盖保存冲突；`e2e/drawio-preview.spec.ts`只在预览/分页兼容路径受改时选相关test，不随编辑保存改动全跑。移动端只有toolbar/确认对话框/标签触摸布局变化时选`mobile-chromium`的一条代表场景；不在两个project重复所有API风险。

启动隔离测试时覆盖高优先级`POCKYMOE_DATABASE_PATH`、`POCKYMOE_WORKSPACE_ROOT`并清除继承relay连接参数，勿触碰活动Supervisor。改共享UI TS/TSX后按skill仅构建一次共享UI包并确认Web消费其dist；改Rust且需要Supervisor才准备对应debug binary。选定检查通过后停止；不追加全浏览器套件、workspace-wide测试、release dry-run。

## 12. 不照搬的设计、未验证项与落地约束

不照搬：

- 不引入NarraFork AgentLoop、中央Provider调用、工具写入总协调体系或其大规模file-change证据仓库作为小文件安全保存前提；我方原生harness依然掌握工具执行。
- 不移植Dockview/Mantine树或重新做Monaco。我们已有虚拟树、键盘、预览/固定标签与分栏，NarraFork非虚拟树的1000项截断是限制，不应倒退采用。
- 不照搬decoded-text hash或不提示的混合换行归一化；我方采用原始bytes版本令牌，先限定无损UTF-8。
- 不把NarraFork本地fd truncate生产写盘描述成原子替换，也不因Go条件写实现存在便宣称其远程编辑已接通。
- 不把传输sha256等同目标文件expectedHash；一个验证上传bytes，一个防覆盖磁盘旧版本。
- 不自动将草稿发送给agent、停agent、给每次变更发协作通知；这些需用户主动选择，文件安全应独立成立。
- 不把文件树事件、mtime或工具完成事件当保存正确性保证；它们只加速提示，最终检查仍在设备。

待验证问题（实现前/对应阶段解决，不能把推断写成事实）：

| 问题 | 为什么影响设计 | 最小验证 |
| --- | --- | --- |
| 当前UI切标签/保存中输入具体丢稿路径 | 代码只有一个draft state、preview变化重置，尚未浏览器复现 | P0前做一条最小A→B→A及保存延迟fixture，记录是否丢输入，确认模型生命周期 |
| 文件URI冲突实际影响范围 | 目前URI仅path；同页面是否共存两设备editor由宿主布局决定 | 两workspace同路径模型fixture，验证数据与undo隔离 |
| 最后外部write窗口及metadata策略 | POSIX rename、Windows replace、hardlink/ACL/xattr不同，atomic不是CAS | 选目标平台精确系统调用与故障注入；不以“没复现”承诺强保证 |
| 文件列表symlink/metadata行为 | 当前entry.metadata未显式返回link状态，平台差异和broken link错误需验证 | 单目录含broken symlink、指外link、无权限entry，确认局部错误策略 |
| raw/preview路径经公共relay的媒体和分页行为 | Web多种URL/加密Blob转换，CSP与stream路由不能只看本机HTTP | 仅涉及变化的media/stream边界用现有relay fixture选定用例 |
| watcher在容器、网络FS、大仓库的事件质量 | overflow、原子替换、重连和目录迁移均可能漏/重发 | P1有限压力fixture+overflow/rescan注入，测FD/队列/重验证次数 |
| 大文件浏览器内存/远程RTT | 不能由Rust/Go语言或worker数量推断谁更快 | P2固定1/5/20MiB、超长单行、远程延迟和手机预算的专项测量 |
| 草稿恢复的隐私和保存策略 | 浏览器持久明文会增加与现有临时model不同的数据留存 | P2产品决定默认关闭/按workspace启用、清理/配额/敏感路径行为 |

实施涉及独立共享UI仓库时，分别提交相关变更。公共Web由Rust relay提供；真正上线必须由父线程按授权发布共享UI提交并从main dispatch `relay-deploy.yml`、传完整`thread_ui_sha`，不能把重启设备Supervisor当作Web部署。本任务不push、不发布、不改版本，父线程负责集成方案与必要上线。

## 13. 最值得先做的五项

1. **新增独立条件保存接口与raw bytes hash**：直接防止用户旧buffer覆盖已发生的agent修改；能力探测避免旧runtime静默无视expectedHash。
2. **每文件draft store + 保存revision结算**：补齐已有标签背后的文档生命周期；切标签、刷新和保存期间输入都不丢稿。
3. **固定冲突diff + 明确三种处理动作**：让409成为可完成的用户流程；覆盖也只能覆盖所展示版本，继续变化再次冲突。
4. **最小operation回执与unknown恢复**：远程断线常见，必须避免“失败就再保存”产生第二次无条件副作用。
5. **有界strict文本读取与旧分页降级**：修正先全读/乱码回写/重复首段这类协议风险，再逐步接文件变更事件和真实分页。

## 附：固定源码锚点

以下链接仅引用本地已审查的固定提交，未通过外网重新检索。共享UI是独立仓库，路径不在`apps/supervisor-web`里。

[R1]: https://github.com/dufangshi/remoteCodex/blob/ffb07d8b17c08af5aa601a67af6e9f058a5a25ac/crates/runtime/src/files.rs#L105
[R2]: https://github.com/dufangshi/remoteCodex/blob/ffb07d8b17c08af5aa601a67af6e9f058a5a25ac/crates/supervisor/src/http.rs#L821
[R3]: https://github.com/dufangshi/remoteCodex/blob/ffb07d8b17c08af5aa601a67af6e9f058a5a25ac/crates/runtime/src/service.rs#L963
[R4]: https://github.com/dufangshi/remoteCodex/blob/ffb07d8b17c08af5aa601a67af6e9f058a5a25ac/apps/supervisor-web/src/pages/useThreadWorkspaceAdapter.ts#L27
[R5]: https://github.com/dufangshi/remoteCodex/blob/ffb07d8b17c08af5aa601a67af6e9f058a5a25ac/apps/supervisor-web/src/lib/api.ts#L1204
[R6]: https://github.com/dufangshi/remoteCodex/blob/ffb07d8b17c08af5aa601a67af6e9f058a5a25ac/crates/relay/src/route_acl.rs#L174
[U1]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/GraphWorkspaceMonacoEditor.tsx#L88
[U2]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/GraphWorkspaceExplorer.tsx#L144
[U3]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/WorkspaceFileTabs.tsx#L32
[U4]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/ThreadWorkspaceLayout.tsx#L1306
[U5]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/GraphWorkspacePreviewPane.tsx#L488
[U6]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/explorer/useWorkspaceExplorerController.ts#L156
[U7]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/explorer/WorkspaceExplorerTree.tsx#L85
[U8]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/explorer/workspaceExplorerProjection.ts#L40
[U9]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/explorer/workspaceExplorerModel.ts#L20
[U10]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/explorer/useWorkspaceFilePreview.ts#L120
[U11]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/explorer/filePreviewPolicy.ts#L1
[U12]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/adapters.ts#L80
[U13]: https://github.com/dufangshi/remote-codex-thread-ui-rust/blob/8e4c384d81012c229d1a780ea175fa2dbaa5c82b/packages/thread-ui/src/components/graph-workspace/explorer/useWorkspaceExplorerActions.ts#L29
[N1]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/narrator/file-tree/FileTreePanel.tsx#L33
[N2]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/narrator/file-tree/useFileTree.ts#L85
[N3]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/routes/editor-documents.ts#L68
[N4]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/shared/editor-document.ts#L1
[N5]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/editor-document-worker.ts#L244
[N6]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/narrator/file-editor/FileEditorContent.tsx#L925
[N7]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/narrator/file-editor/editor-session-state.ts#L313
[N8]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/narrator/dock/panels.tsx#L967
[N9]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/narrator/file-panel/LargeFileGate.tsx#L1
[N10]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/narrator/file-editor/editor-worker-client.ts#L22
[N11]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/file-change-local-io.ts#L238
[N12]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/remote-executor/internal/handlers/fs.go#L348
[N13]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/remote-executor/internal/handlers/transfer.go#L446
[N14]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/routes/fs.ts#L817
[N15]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/editor-document-service.ts#L734
[N16]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/server/services/file-change-runtime.ts#L2010

[N17]: https://github.com/NarraFork/NarraFork/blob/4e04d2f2e490bd57a5d8d712b709a574b905848a/frontend/components/narrator/file-tree/FileTreeContent.tsx#L42
