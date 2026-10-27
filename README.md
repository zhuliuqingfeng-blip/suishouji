# 随手记

**记下此刻，也记住那些不想忘记的日子。**

一款安静、易用的 Windows 本地记录软件。把突然冒出的想法、截图和文件收在一起，也替你记着家人的生日和纪念日。

**[下载 Windows 安装版 · 1.8.3](https://github.com/zhuliuqingfeng-blip/suishouji/releases/download/v1.8.3/suishouji-1.8.3-setup-x64.exe)** · [发布说明](https://github.com/zhuliuqingfeng-blip/suishouji/releases/latest) · [使用说明](docs/使用说明.txt) · [反馈问题](https://github.com/zhuliuqingfeng-blip/suishouji/issues)

Windows 64 位 · 支持覆盖升级 · 离线可用 · 数据保存在本地

![随手记首页：写点什么、继续上次与最近记录](docs/images/readme-home.png)

## 随手记下，随时找回

从一条新想法开始，接着上次写，或翻翻最近的记录。打开软件后，由你决定从哪里开始。

- **文字、图片、文件放在一起**：粘贴截图，拖入图片或附件。文件会保存独立副本，原文件移动或删除后仍能打开。
- **简单排版，写起来顺手**：支持标题、加粗、列表和链接，也能复制、粘贴为纯文本，留下内容，去掉多余格式。
- **想找的时候，找得到**：搜索标题、正文和附件名称，用标签整理片段，把常看的记录置顶。
- **写完不用惦记保存**：输入停顿时自动保存，切换和关闭前完成保存。误删的手记还能从回收站找回。

需要专心时，收起目录，进入专注模式，留一页安静的书写空间。

![随手记书写页：简单排版、标签与附件](docs/images/readme-editor.png)

## 也记住重要的人和日子

伴侣的生日、家人的农历生日、在一起的纪念日，记下一次，临近时给自己一个提醒。

- 公历、农历都支持，农历闰月也能单独记录。
- 每年重复的日子自动寻找下一次日期，按远近排列。
- 可设置提前提醒；临近时，在首页和应用内给你轻提示。

提醒在软件运行时生效，关闭后不会在后台提醒。

![重要日子：公历与农历生日、纪念日及距离提示](docs/images/readme-important-days.png)

*以上界面均来自实际软件，内容为虚构演示资料。*

## 资料保存在自己的电脑里

无需注册账号，断网也能记录。安装版将手记、重要日子、设置和备份独立保存在当前用户的应用数据目录，升级只更新程序，正常卸载也会保留资料。

每天首次启动自动备份，保留最近七份；也可以一键备份全部资料，或将手记导出为 HTML，用浏览器阅读。换电脑时，在新电脑安装软件并恢复完整备份，就能把记录一起带走。

## 开始使用

1. **[下载 1.8.3 安装包](https://github.com/zhuliuqingfeng-blip/suishouji/releases/download/v1.8.3/suishouji-1.8.3-setup-x64.exe)**，双击运行。
2. 首次安装可以选择存放位置。例如选择 `E:\soft`，会自动创建 `E:\soft\随手记`，安装前显示最终路径，无需自己新建文件夹。
3. 打开软件，点击“写点什么”，记下第一件想留下的事。无需配置 Node.js 或数据库。
4. 以后更新时，直接运行新版安装包。沿用已有安装位置和个人资料，无需先卸载、导出或手工搬动数据。

已经在用免安装版？安装器可靠识别到原程序时，会先备份，再自动带入手记、重要日子和设置，旧版原件保留。无法自动识别时，也可通过“从免安装版导入”选择旧文件夹，完成一次迁移。已有正式版资料不会被旧资料覆盖。[迁移与使用说明](docs/使用说明.txt)。

<details>
<summary>免安装版与其他下载</summary>

本次 1.8.3 发布提供正式安装版，推荐日常使用。较早的免安装版可在 [历史版本](https://github.com/zhuliuqingfeng-blip/suishouji/releases) 中下载：完整解压 Windows x64 的 `.zip`，双击 `随手记.exe`，资料保存在软件旁的“我的数据”中。

GitHub 自动生成的 **Source code** 是源码；直接使用软件请选择带 `setup-x64.exe` 的安装包。

</details>

<details>
<summary>更多文档与项目说明</summary>

- [开发说明](docs/开发说明.md)
- [验收记录](docs/验收记录.md)
- [问题反馈与使用建议](https://github.com/zhuliuqingfeng-blip/suishouji/issues)

本项目暂未指定开源许可证。第三方依赖仍适用各自许可证，农历库许可见 [第三方许可](app/assets/third-party/lunar-typescript-LICENSE.txt)。

</details>
