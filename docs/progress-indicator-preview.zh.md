# 进展指示点预览

活动轮次的三个点合并了原来常驻的“上次进展 · N 秒前”。距最近进展 0–5 秒为绿色、超过 5 秒至 20 秒为黄色、超过 20 秒为红色，颜色过渡 300ms。收到新的进展事件会立即重新计算。没有可用时间为灰色。颜色表示进展间隔；轮次终态仍采用原成功/失败/中断标记，恢复状态及后台 agent 提示保持原语义。

桌面悬停或键盘聚焦、手机点击可以看到秒数和具体日期时间；点击其他位置或 Escape 关闭，手机再次点击切换。中英时间文案沿用现有字典和 locale。按钮提供完整文字的无障碍标签。

实现位于共享 UI `timeline/turnStatus.tsx`；主仓专项 `e2e/thread-reading-polish.spec.ts`。5 项状态栏单测通过，覆盖 0/5/6/20/21 秒边界及无效时间；共享 UI build/类型生成通过。桌面和手机各 1 项浏览器回归通过，验证悬停/点击详情、收起文字、新事件变绿、时钟推进变黄/红及终态清理。日志：`.temp/progress-unit.log`、`.temp/progress-build.log`、`.temp/progress-desktop.log`、`.temp/progress-mobile.log`。测试采用隔离 fake Supervisor、mock 事件及浏览器时钟，没有等待真实模型。

截图：[桌面细节](assets/narrafork-preview/progress/progress-detail.png)、[桌面页面](assets/narrafork-preview/progress/progress-desktop-chromium.png)、[手机页面](assets/narrafork-preview/progress/progress-mobile-chromium.png)。哈希见同目录 manifest.json。当前仅预览分支提交，未合 main、推送或部署。
