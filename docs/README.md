# qq-official-bot 本地维护与使用说明

本仓库是自用 fork。维护流程为：修改 TypeScript 源码 → 本地构建 → 提交源码和 `lib` 产物 → 推送到 GitHub → 工作流同步下游仓库。

包已设置 `private: true`，不发布 npm；文档直接阅读仓库内的 Markdown，不再自动发布 GitHub Pages。现有 `docs/src` 详细资料保留，入口见本文后面的文档目录。

## 本地构建

在 SDK 仓库根目录执行。环境要求与 `package.json` 一致：Node.js >=20.12、pnpm 9.0.2。

```bash
pnpm install --frozen-lockfile
pnpm run compile
pnpm run build
```

- `compile`：编译 JavaScript、改写路径别名，并校验构建产物的模块引用。
- `build`：包含 `compile`，并生成 `lib/index.d.ts`；提交产物前使用此命令。
- `src` 是源码，`lib` 是生成目录；功能修改应在 `src` 完成，再通过构建更新 `lib`。

启动生命周期、引用消息和语音解析回归测试可手动运行：

```bash
node --test scripts/session-start.test.cjs scripts/session-stop.test.cjs scripts/error-boundaries.test.cjs scripts/reference.test.cjs scripts/audio.test.cjs
```

`pnpm test` 目前仍是占位脚本。

## 产物同步

同步配置为 [sync-plugin.yml](../.github/workflows/sync-plugin.yml)。

1. 在本地修改 `src`，运行构建与相关检查。
2. 检查差异，将源码和生成的 `lib` 产物一起提交。
3. 推送到 `main`；推送包含 `lib/**` 变更时触发同步。只修改文档不会触发同步。
4. 在 GitHub Actions 的 `Sync SDK to downstream repositories` 中查看执行结果，也可手动触发该工作流。

工作流将本仓库 `lib` 目录同步到以下位置：

| 下游仓库 | 目标目录 |
| --- | --- |
| `dndss/Yunzai-QQBot-Plugin` | `lib/modules/qq-official-bot/lib` |
| `dndss/qqbot-web` | `packages/qq-official-bot/lib` |

同步使用 `rsync --delete` 镜像更新目标目录，并提交到下游的 `main` 分支；本地构建不会直接更新下游仓库。跨仓库读写使用 SDK 仓库中配置的 `PLUGIN_REPO_TOKEN` secret。

## 使用方式与配置

QQBot-Plugin 通过本地依赖 `link:lib/modules/qq-official-bot` 加载同步后的 SDK。README 中的独立 SDK 使用示例适用于已配置本地依赖的项目；从 npm 安装同名包不会获得本 fork 的修改。

以下是在 SDK 根目录中编写 CommonJS 脚本的最小示例。账号信息通过运行脚本时的环境变量传入：

```javascript
const { Bot, ReceiverMode } = require('./lib')

async function main() {
    const appid = process.env.QQ_BOT_APPID
    const secret = process.env.QQ_BOT_SECRET
    if (!appid || !secret) throw new Error('请设置 QQ_BOT_APPID 和 QQ_BOT_SECRET')

    const bot = new Bot({
        appid,
        secret,
        mode: ReceiverMode.WEBSOCKET,
        intents: ['GROUP_AND_C2C_EVENT'],
        logLevel: 'info',
    })

    bot.on('message', async event => {
        if (event.raw_message === 'ping') await event.reply('pong')
    })

    await bot.start()
}

main().catch(console.error)
```

| 配置项 | 用途 |
| --- | --- |
| `appid`、`secret` | 机器人认证，必填 |
| `mode` | `websocket`、`webhook` 或 `middleware` |
| `intents` | 订阅的事件，按所需功能配置 |
| `logLevel` | 日志级别，默认 `info` |
| `timeout` | HTTP 请求超时，默认 5000 毫秒 |
| `removeAt` | 是否移除消息中的机器人提及；显式设为 `false` 时不移除 |
| `accessTokenUrl` | WebSocket 模式下自定义 token 接口的完整 URL |
| `gatewayUrl` | WebSocket 模式下自定义网关接口的 URL 或路径 |

默认 HTTP API 根地址为 `https://api.bot.qq.com`，token 接口为该地址下的 `/app/getAppAccessToken`，网关接口为 `/gateway/bot`。

SDK 尚未封装的接口可通过 `bot.request` 调用；在 QQBot-Plugin 事件中使用 `e.bot.sdk.request`。完整示例见[底层 OpenAPI 请求](./src/api/openapi.md)。

## 错误处理

SDK 不注册进程级的全局异常监听。SDK 接口的 Promise 失败、业务消息回调及项目
关闭流程需要由宿主项目捕获；进程退出或重启策略由项目入口管理。协议解析错误
与业务回调错误分开处理，具体约定与示例见[错误处理说明](./src/api/common.md#错误处理)。

## 详细文档目录

现有详细资料保留了独立 SDK 的说明，部分安装指令、环境版本或示例可能沿用上游。自用构建及同步流程以本文为准；接口签名和配置以源码及生成的 `lib/index.d.ts` 为准。

| 内容 | 文档 |
| --- | --- |
| 快速开始、连接模式 | [快速开始](./src/guide/start.md) |
| 配置项 | [配置参考](./src/config.md) |
| 底层 HTTP 接口 | [OpenAPI 请求](./src/api/openapi.md) |
| 生命周期、通用方法 | [公共 API](./src/api/common.md) |
| 群、好友 | [群 API](./src/api/group.md)、[好友 API](./src/api/friend.md) |
| 频道、子频道、频道私信 | [频道](./src/api/guild.md)、[子频道](./src/api/channel.md)、[私信](./src/api/direct.md) |
| 消息段与构建 | [消息段概览](./src/segment/index.md)、[消息段 API](./src/segment/segment-api.md) |
| 常用消息段 | [文本](./src/segment/text.md)、[图片](./src/segment/image.md)、[音频](./src/segment/audio.md)、[视频](./src/segment/video.md) |
| 回复和提及 | [回复](./src/segment/reply.md)、[At](./src/segment/at.md) |
| 富文本和交互 | [Markdown](./src/segment/markdown.md)、[按钮](./src/segment/button.md)、[Ark](./src/segment/ark.md)、[Embed](./src/segment/embed.md) |
| 表情和链接 | [表情](./src/segment/face.md)、[链接](./src/segment/link.md) |
| 类型资料 | [TypeScript 接口](./src/interface/index.md) |

VitePress 配置、依赖与 `docs:*` 脚本保留用于手动预览。日常查看本文和详细 Markdown 无需构建文档站点。
