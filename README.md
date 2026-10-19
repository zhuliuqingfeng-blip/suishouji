# 随手记

个人离线图文记录软件，支持文字、图片、附件、搜索、标签和本地备份。

日常双击桌面“随手记”即可使用。当前程序在 `release/随手记/随手记.exe`，记录在同目录的“我的数据”；移动到另一台电脑前，先关闭软件，再复制整个软件文件夹。

## 目录

| 目录 | 内容 |
| --- | --- |
| `app/` | 源码、依赖、开发配置和脚本；编译输出在其中生成 |
| `docs/` | 使用说明、开发说明、验收记录、界面示例 |
| `release/随手记/` | 正在使用的软件和个人数据 |
| `release/packages/` | 按版本归档的软件包、源码包 |
| `.artifacts/` | 测试结果和打包暂存文件 |
| `.cache/` | 本地下载缓存 |
| `private/upgrade-backups/` | 升级前的数据及旧程序备份 |

Git 只管理源码、测试、配置和文档，不收录软件成品、个人数据、备份或缓存。

## 开发

进入 `app` 目录执行 `npm ci --cache ../.cache/npm`、`npm run setup`、`npm run dev`。已有依赖时无需重复安装。

`npm run build` 构建，`npm test` 运行数据测试，`npm run test:ui`、`npm run test:ux` 和 `npm run test:workspace` 验证实际窗口。`npm run test:clipboard` 检查真实剪贴板、纯文本操作与窄窗口工具栏；`npm run test:dev` 检查开发服务器；`npm run test:portable` 检查打包暂存副本的整套搬迁。所有验收使用隔离数据。

`npm run package` 打包至 `.artifacts/staging/`，`npm run release` 生成便携包和源码包。正常关闭已安装程序后，执行 `node scripts/upgrade.mjs` 安全升级。

1.2 新增多选删除和恢复、10秒删除撤销、记录右键菜单、排序选择、两栏独立拖动与收起、专注模式和窗口记忆。保留原有本地存储和靛蓝珊瑚配色。

1.2.1 新增纯文本复制（Ctrl+Shift+C）、纯文本粘贴（Ctrl+Shift+V）、全文纯文本复制，以及正文右键菜单和工具栏“纯文本”入口。复制保留换行，原记录格式不变；切换记录时重置撤销历史，避免撤销带入另一条记录。

详细说明见 [开发说明](docs/开发说明.md) 和 [使用说明](docs/使用说明.txt)。
