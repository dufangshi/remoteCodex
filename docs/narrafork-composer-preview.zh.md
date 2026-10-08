# 紧凑输入区体验评审

本次预览把两个会话的标准输入区统一为紧凑布局。空白、短提示词以及失去焦点的草稿都只占一行；光标进入长正文或多行正文时，输入区自动展开。展开依据浏览器实际字体、附件和右侧工具栏占用的宽度判断，支持中文和窗口宽度变化。

右侧从左至右依次为斜杠工具箱、添加附件、模型与推理设置、沙箱设置（当前后端提供时）、停止（会话运行时）和发送。模型名称在手机上缩短显示，完整名称仍可通过按钮的无障碍标签与设置菜单识别。展开后所有工具仍在右侧。点击模型或附件菜单时，按钮保持相同底部位置。

收起保留完整正文与附件；重新聚焦即可继续编辑。停止和发送仍分别针对所在会话。请求发送期间新增的正文、附件不会被前一条请求的成功回执清空。原有快捷键、粘贴、附件上传和输入法组合状态继续使用标准输入实现。

## 实际页面截图

截图来自隔离 fake harness 的实际工作台，使用正常会话历史、两个会话的独立输入框和运行中的停止按钮。没有连接真实模型；页面中的讨论正文为验收样例。截图哈希与尺寸见 [composer/manifest.json](assets/narrafork-preview/composer/manifest.json)。原有文件编辑截图保持不变。

| 视图 | 收起 | 展开 |
| --- | --- | --- |
| 桌面 1440 × 1000 | [桌面收起](assets/narrafork-preview/composer/desktop-collapsed.png) | [桌面展开](assets/narrafork-preview/composer/desktop-expanded.png) |
| 手机 390 × 844 | [手机收起](assets/narrafork-preview/composer/mobile-collapsed.png) | [手机展开](assets/narrafork-preview/composer/mobile-expanded.png) |

## 验证范围

- 定向 composer 单测：受控 / 非受控草稿、旧回执与新正文 / File 对象隔离，以及相关标准输入区组件。
- 桌面浏览器：双栏空白和短内容一行、长文聚焦展开、移动光标保持稳定、菜单 blur 可点击且不位移、粘贴多行和重新聚焦恢复、停止 / 发送横排、渲染宽度与缩放。
- 手机浏览器：两个会话分别使用输入区、工具栏不覆盖正文、不造成横向页面溢出，以及同样的收起 / 展开与菜单交互。
- 桌面串联：中文 composition Enter 不发送；快捷键提交旧稿，在途继续编辑并加附件，旧稿接收后新稿与附件仍保留，并可真实提交到当前会话。

浏览器采用 Chromium 桌面及手机仿真；IME 回归验证浏览器 composition 事件边界，未代替真实手机系统键盘或所有操作系统输入法的人工验收。长正文收起时只显示首行视口，完整内容在重新聚焦后恢复；收起不会改写正文。未发布、推送或部署本次预览。

桌面输入区细节裁剪：[收起](assets/narrafork-preview/composer/desktop-collapsed-detail.png)、[展开](assets/narrafork-preview/composer/desktop-expanded-detail.png)。来自上述实页截图，裁剪坐标与哈希在 manifest 的 detailCrops 中。
