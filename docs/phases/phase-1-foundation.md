# Phase 1：基础 Supervisor 与工程底座

## 1. 阶段目标

从零搭建项目骨架，建立后续所有功能共用的运行、开发、测试和存储基础。Phase 1 通过后，团队应拥有一个可以本地启动、具备基础 UI/API/数据库/工作区浏览能力的 supervisor 雏形。

## 2. 前置条件

- 已确认技术选型为 TypeScript + Node.js。
- 已确认部署目标为 `macOS` 与 `WSL Ubuntu`。
- 已确认第一版入口是本地 supervisor，而不是直接暴露 `codex app-server`。

## 3. 本阶段需要开发什么

### 3.1 工程结构

需要建立一个清晰、可扩展的 monorepo 或等效多模块结构，至少覆盖以下职责：

- `apps/supervisor-api`
- `apps/supervisor-web`
- `packages/shared`
- `packages/db`
- `packages/config`
- `packages/workspace`

同时建立统一的脚本约定：

- `pnpm dev`
- `pnpm build`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

### 3.2 基础运行时

需要实现 supervisor 进程的最小可运行版本：

- 内置 HTTP server
- WebSocket 基础通道骨架
- 配置加载机制
- 日志输出机制
- 错误处理中间件
- 健康检查接口

最低要求：

- `GET /healthz`
- `GET /api/version`
- `GET /api/config/runtime`

### 3.3 SQLite 与迁移体系

需要建立统一数据库接入层，至少包括：

- SQLite 文件位置约定
- migration 执行机制
- seed 或初始化逻辑
- 本地开发与生产配置区分

第一批核心表建议落地：

- `hosts`
- `workspaces`
- `threads`
- `shell_sessions`
- `viewer_sessions`
- `notifications`
- `policies`

说明：

- 即使后续 Phase 才真正使用全部表，也应在本阶段先把核心对象模型和迁移机制固定下来。

### 3.4 Workspace 管理与只读目录树

需要完成第一版 workspace 基础能力：

- 手动添加 workspace
- 列出 workspace
- 收藏 workspace
- 更新最近打开时间
- 从 `~/` 开始浏览目录
- 支持输入绝对路径添加 workspace
- 只读 tree API
- 默认隐藏 dotfiles，可通过参数显示

第一版暂不做文件内容编辑，但要支持：

- 目录展开
- 文件/目录类型识别
- 基础元信息返回

### 3.5 基础前端壳

需要实现可继续迭代的 Web UI 壳层：

- 登录前占位或单用户入口页
- workspace 列表页
- workspace 添加页或抽屉
- 基础导航结构
- 错误态、空态、加载态

注意：

- 当前是从零开始，但 UI 不应只停留在接口调试页，必须有明确的信息架构。

### 3.6 开发规范与质量门禁

需要在本阶段建立全项目统一规范：

- ESLint / Prettier 或等效格式化约定
- TypeScript 严格模式
- 环境变量规范
- `README` 启动说明
- `.env.example`
- 提交前校验脚本或等效约束

## 4. 本阶段交付物

- 可安装依赖并启动的项目骨架
- 可运行的 supervisor API 服务
- 可访问的基础 Web 页面
- 可执行的数据库 migration
- 可用的 workspace 增删查与目录树接口
- 一套固定的质量检查命令
- 项目根目录 `README` 与开发说明

## 5. 验收标准

满足以下条件才可视为 Phase 1 完成：

1. 新机器按文档执行后，可以在 30 分钟内完成本地启动。
2. API、Web、数据库迁移三者都能独立运行且互相联通。
3. 用户可以从网页添加一个真实本地目录为 workspace，并在页面看到只读目录树。
4. 错误路径有明确反馈，例如路径不存在、没有权限、目录不可读。
5. 所有基础检查命令可稳定执行，不依赖人工临时步骤。

## 6. 如何验收

建议按以下顺序验收：

1. 冷启动验收
   - 删除本地构建产物与临时数据库。
   - 按 `README` 从零安装并启动项目。
   - 验证服务可启动且页面可访问。
2. 数据库验收
   - 执行 migration。
   - 检查表结构是否完整建立。
   - 重启服务后确认初始化逻辑不重复报错。
3. workspace 验收
   - 添加一个存在的目录。
   - 添加一个不存在的目录并确认返回可读错误。
   - 浏览目录树并切换显示隐藏文件。
4. 前端验收
   - 在手机宽度和桌面宽度下分别打开页面。
   - 验证基础布局未出现明显断裂。
5. 质量门禁验收
   - 执行 lint、typecheck、test、build。
   - 任一命令失败即不通过。

## 7. 如何检查

开发完成后，必须至少执行并记录以下检查：

- 运行 `pnpm lint`
- 运行 `pnpm typecheck`
- 运行 `pnpm test`
- 运行 `pnpm build`
- 运行数据库 migration 命令
- 手动访问 `GET /healthz`
- 手动访问 workspace 列表与 tree 页面
- 手动验证一个正常路径与一个非法路径
- 桌面端与手机端各做一次页面冒烟检查

## 8. Checklist

以下项目必须全部打钩，Phase 1 才算通过：

- [ ] 已建立明确的项目目录结构，并覆盖 API、Web、共享类型、数据库、workspace 服务。
- [ ] 已统一包管理、脚本命名和本地开发启动方式。
- [ ] 已实现基础 HTTP server、错误处理中间件、日志与健康检查接口。
- [ ] 已建立 WebSocket 基础入口，为后续事件流保留接口。
- [ ] 已建立 SQLite 接入层、migration 机制和初始化流程。
- [ ] 已创建核心数据表或等效模型：`hosts`、`workspaces`、`threads`、`shell_sessions`、`viewer_sessions`、`notifications`、`policies`。
- [ ] 已实现 workspace 的新增、列表、收藏、最近打开时间更新能力。
- [ ] 已实现从 `~/` 开始浏览目录和通过绝对路径添加 workspace 的能力。
- [ ] 已实现只读 tree API，支持隐藏/显示 dotfiles。
- [ ] 已实现基础 Web UI 壳层，至少可完成 workspace 管理与目录树展示。
- [ ] 已补齐空态、加载态、错误态，不存在只能看白屏或原始报错的页面。
- [ ] 已建立统一代码规范、格式化规范和 TypeScript 严格校验。
- [ ] 已提供 `.env.example` 与 `README`，并说明本地启动步骤。
- [ ] 已验证 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
- [ ] 已完成一次从零环境冷启动验收，并确认文档可复现。
