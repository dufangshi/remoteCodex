# 线程交互：Docker 端到端验证记录

验证日期：2026-09-11。分支：`feat/local-thread-messaging`。

## 环境与真实模型

- Docker Desktop，Linux ARM64；隔离容器 `remote-codex-thread-e2e`，独立数据库与示例目录。
- 实际运行从本分支构建的 Rust `remote-codex`，没有使用 fake runtime 代替真实模型场景。
- Codex CLI 0.154.0、codex-acp 1.10.0、Grok 1.0.25。
- Astra 主线程：`28c55ce7-07b6-4d4c-ac04-36287a8c35de`，provider `codex`，模型 `gpt-6-astra`，推理等级 `high`。
- 网页手动创建的 Grok 线程：`24667668-9c56-479d-a581-e743419a35ea`，provider `acp` / agent `grok`，模型 `grok-4.6`，推理等级 `xhigh`。
- Astra 自行创建的 Grok 线程：`4931df65-e7f3-4d60-88e9-07d8de81867f`，相同 Grok 配置。

通过 computer use 在桌面 Chrome 中添加工作区、选择 ACP / Grok Build / Grok 4.6 / xhigh 并创建手动线程。创建后的界面明确显示模型与等级。主线程自行创建的另一个 Grok 线程来自其实际 CLI 工具调用，数据库历史与 `auto-peer.json` 回执均已核验。

浏览器使用 Docker Nginx 网关 `http://127.0.0.1:18880`；Supervisor API 在 `http://127.0.0.1:18879`。前端使用已有 Web dist。当前分支的 Supervisor 静态文件响应头会限制 JavaScript 执行，因此此验证使用 Nginx 提供静态文件并代理 API/WS；该既有问题未混入本功能修改。全部线程执行与持久化仍在 Docker 中。

## 场景结果

| 场景 | 实际交互与结果 |
| --- | --- |
| 主线程自行创建 peer | Astra 读取 CLI skill 与 self 信息，创建 Grok 4.6-xhigh 线程并提交初始编译 prompt，保存回执后结束 turn；未等待 peer 完成 |
| Supervisor 自动通知 | Grok 用 `cc -Wall -Wextra -Werror` 编译并执行 C 示例，结束 turn 后系统向 Astra 发送一次通知；Astra 新一轮读取 peer transcript、独立执行产物，写出 `AUTO_NOTIFY_FOLLOWUP_OK` |
| 联系网页已有线程 | Astra 通过 CLI 给 computer use 创建的 Grok 线程发送编译 prompt，不新建线程 |
| Agent 主动回信 | 该 prompt 未启用自动通知；Grok 自行 CLI 发送 `MANUAL_COMPILE_REPLY_OK` 给 Astra，Astra 被唤起后独立验证产物并写出 `MANUAL_REPLY_FOLLOWUP_OK` |
| 运行中连续发消息 | Astra 在 Grok 第一轮仍为 `running` 时发送第二条消息；数据库时间戳确认第二条先入队、第一轮结束后才开始执行 |
| 排队后的后续操作 | Grok 第二轮验证第一轮文件、写出第二个文件并回信；Astra 读取最近两轮、验证两个文件，写出 `QUEUED_MESSAGES_FOLLOWUP_OK` |
| 最终版本复测 | 迭代后的最终代码再次由 Astra 复用 Grok 线程并开启自动通知，结束当前轮后由系统唤起下一轮；产物与 transcript 验证后写出 `FINAL_VERSION_NOTIFY_OK` |

总计 13 个真实 turn：Astra 8、自动创建的 Grok 2、手动创建的 Grok 3。全部为 `completed`；收口时三个线程均 `idle`，pending prompt 数量与待发通知订阅均为 0。

自动编译和手动编译的程序输出都为 `thread-compile-ok`。独立验证脚本还检查了通知唯一性、通知开始时间晚于 peer 完成时间、主线程先返回，以及运行中连续发送的因果顺序，不以“已经 idle”代替业务成功。

## 可复现资料与回归

- [Docker 环境与场景步骤](../e2e/thread-interaction/README.md)
- [测试镜像 Dockerfile](../e2e/thread-interaction/Dockerfile)
- [只读验证脚本](../e2e/thread-interaction/verify.py)
- [CLI 使用说明](thread-interaction.md)
- [随二进制提供的 skill](../skills/thread-interaction/SKILL.md)

本机测试数据保留在 worktree 的忽略目录 `.local/thread-e2e`，包含回执、编译产物与验证 JSON。凭据和完整真实 transcript 不提交到仓库。

最终 `cargo test --workspace`：**253 项通过，0 失败，1 项既有 Gemini 真实模型测试忽略**。新回归覆盖对话分页 / 长内容续读、连续收发、自动通知去重、中断状态、取消排队消息、多个实时插话通知、会话 CLI 身份重新绑定，以及本机 API 鉴权。配套 skill 的 `quick_validate.py` 校验通过。

浏览器验证采用 computer use 的桌面 Chrome 创建与结果检查；未运行无关的全量 Playwright 套件。没有进行生产发布或活跃宿主 Supervisor 更新。
