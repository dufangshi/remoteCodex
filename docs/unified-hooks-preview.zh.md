# 统一 hooks 预览

统一自动化已接入 Rust Supervisor、Pockymoe CLI 与工作台“自动化”面板。当前在预览分支，尚未合入 main、发布 runtime 或部署公开 Web。未在生产线程创建任何自动任务。此前的文件创建、双向分屏、紧凑输入区与进展指示点一并保留。

## 可以定义什么

触发条件支持固定间隔（例如每小时）、一次指定时间、某个线程的精确轮次结束、任务板某个任务结束、通过 CLI wrapper 执行的命令结束。条件支持成功/失败/中断状态、退出码、来源工作区或命令 ID，以及 all/any/not 组合。

所有触发类型共用三类动作：发送 prompt 到登记线程；将普通 result/status 被动投递 inbox；执行固定 argv 命令或显式 shell 脚本。时间触发和轮次/任务结束事件也可以执行脚本。只有明确设置 prompt 动作才会唤醒线程，普通结果不会自动开始新一轮。

`pockymoe hooks`、`pockymoe hook` 都是 `pockymoe automation` 的别名。CLI、REST 和 UI 使用同一套定义、执行记录与调度逻辑，原 Claude watches 继续作为独立只读来源显示。

## 使用示例

以下为新版 CLI 的调用方式，需运行已包含本分支实现的 CLI 和 Supervisor。

每小时检查自己负责的项目：

```sh
pockymoe hooks create --thread self --request-id hourly-project-check --json '{
  "name": "每小时检查",
  "trigger": {"kind": "interval", "everySeconds": 3600},
  "action": {"kind": "prompt", "text": "检查当前项目的待办与执行状态，汇报需要处理的事项。"}
}'
```

命令成功后执行工作区内脚本，使用 JSON 文件登记：

```json
{
  "name": "构建后整理报告",
  "trigger": {
    "kind": "commandEnded",
    "sourceThreadId": "替换为来源线程 UUID",
    "commandKey": "build"
  },
  "condition": {"kind": "exitCodeEquals", "value": 0},
  "action": {
    "kind": "runScript",
    "argv": ["/bin/sh", "scripts/report-build.sh"],
    "cwd": ".",
    "timeoutSeconds": 60
  }
}
```

```sh
pockymoe hooks create --file build-hook.json --request-id build-hook
pockymoe command run --thread self --command-key build --request-id build-run-1 --cwd . -- cargo check -p pockymoe-runtime
pockymoe hooks list --thread self
pockymoe hooks runs --thread self AUTOMATION_ID
pockymoe hooks pause --thread self AUTOMATION_ID
pockymoe hooks resume --thread self AUTOMATION_ID
pockymoe hooks cancel --thread self AUTOMATION_ID
```

`commandKey` 关联通过 wrapper 实际运行的命令，每次命令运行用独立 request ID；同一次请求重试沿用原 ID，避免重复执行。普通终端执行相同文本不会触发。详细 DTO、轮次/任务提醒示例和 HTTP 接口见 [接口说明](unified-hooks.md)。

## 运行与恢复

线程忙时 prompt 等待整轮结束，多次到期合并为一个未执行项；下一次计划时间继续推进，历史记录合并次数。脚本动作也等待目标线程的整轮与已有 continuation 队列结束。默认离线漏跑合并为最近一次，最大迟到 24 小时，可设置 skip。设备离线时不运行。

定义、事件、执行意图与接受回执保存在 SQLite。重复事件或同 request ID 不会重复投递；queued 只代表已接受，只有关联轮次或命令结束才记录执行完成。Supervisor 重启后未确认结束的脚本标为 uncertain，不会自动重跑；崩溃后的子进程可能仍存在，外部副作用需核查。

暂停/取消仅清理该自动化尚未执行的队列，不删除用户排队消息；正在执行的工作允许结束。点击 Stop 会暂停该线程的 prompt 自动化，需显式恢复。取消永久生效。对已启用定义重复恢复不会重置计划或吞掉待消费事件；表单在当前页面内对同一定义重试沿用 request ID，避免丢回执后重复登记。权限沿用现有设备访问控制，没有新增脚本 hash 授权或信任流程。

## UI 与边界

所有 provider 都可打开“自动化”，查看下一次计划、待执行项、合并次数、启停状态、执行历史、错误和命令输出；支持中英表单及高级 JSON。

[桌面中文](assets/narrafork-preview/hooks/automations-zh.png) · [桌面英文](assets/narrafork-preview/hooks/automations-en.png) · [手机中文](assets/narrafork-preview/hooks/automations-mobile-zh.png) · [手机英文](assets/narrafork-preview/hooks/automations-mobile-en.png)。图中失败为刻意执行 exit 7 的隔离验收数据。

当前支持 interval/at，不含 cron/DST、跨设备调度、任意 PTY 或通用 ACP 工具事件。脚本支持显式 cwd、1–300 秒超时和受限输出记录。定义暂不支持原地编辑；修改时显式取消并新建。历史暂不自动清理，不承诺外部脚本副作用恰好执行一次。


## 复核与验证

已复核事件持久化、整轮入场、忙时合并、去重、脚本执行和恢复路径，并补齐三个边界：非零退出码条件可匹配真实失败；重复恢复保持原计划和未消费事件；创建回执丢失后 UI 重试不重复注册。

实现分支通过 14 项 hooks runtime 回归、5 项迁移回归、13 项既有线程交互回归、1 项 relay ACL、9 项 i18n，以及独立 CLI/HTTP/真实进程停启验证。Rust fmt/check/build 通过。父线程整合后的 Web 类型检查、桌面自动化 2 项与手机自动化 1 项通过，均使用私有数据库、工作区与 fake harness；脚本执行为真实隔离进程。未运行无关全量测试。

本页截图由整合版本的 `e2e/automations.spec.ts` 生成。桌面覆盖定义/暂停/恢复/取消、真实脚本输出与失败历史、中英文，以及真实接受后丢回执重试；手机覆盖前述面板交互与横向溢出检查。失败记录中的 exit 7 是刻意设置的验收场景。

集成位置：主仓 `preview/narrafork-editor-workbench`，功能提交 `b5523194c416498c10be7d7be540e32eed91bc28`；共享 UI `preview/narrafork-editor-workbench-ui`，提交 `f5d7c5a3cce94ef9428979ef9f347bdb110766bc`。图像来源和 SHA-256 见 [截图清单](assets/narrafork-preview/hooks/manifest.json)。用户确认后再决定是否合入 main。
