---
layout: doc
---

# Markdown 图片素材

通过 `bot.materialService` 上传、查询和删除当前机器人的 Markdown 图片素材。
素材上传完成后返回 `qqbot-media://` 链接，可写入现有 `segment.markdown()`，无需公网图床。
这与普通图片消息的 `/files` 上传、`file_info` 不同。

## 一键上传并发送

以下示例假定 `bot` 已启动并取得访问令牌。`openid` 是接收用户的 OpenID。

```typescript
import { segment } from 'qq-official-bot'

const image = await bot.materialService.uploadImage('./chart.png')

await bot.sendPrivateMessage(
    openid,
    segment.markdown(`![图表 #800px #400px](${image.url})`)
)

// 保存 image_id 和 url 以便复用；preview_url 仅供临时预览。
console.log(image.image_id, image.url, image.ttl)
```

群聊可使用 `bot.sendGroupMessage(groupOpenid, segment.markdown(...))`。
消息发送仍需满足平台的 Markdown 使用权限、主动发送及被动回复规则；
被动回复时按原有接口传入 `source`。

本地文件路径默认按扩展名推导 MIME 类型，也可以显式传入 `fileName` 和 `contentType`。
传入 Buffer 时必须提供这两个字段：

```typescript
import { readFile } from 'node:fs/promises'

const controller = new AbortController()
const image = await bot.materialService.uploadImage(await readFile('./chart.png'), {
    fileName: 'chart.png',
    contentType: 'image/png',
    timeout: 30_000,
    signal: controller.signal, // 可选，可调用 controller.abort() 取消
})
```

`uploadImage` 自动计算 MD5、SHA1，依次申请上传、直传二进制、完成上传。
直传使用独立 HTTP 请求，不携带机器人鉴权头；Content-Type 与申请时保持一致。
完成上传使用 PUT 返回的 ETag，并验证其与本地 MD5 一致。
任一步失败即抛出错误，不自动重试或清理已有素材。

## 分页查询

```typescript
const firstPage = await bot.materialService.listImages()
console.log(firstPage.total, firstPage.images)

if (firstPage.next_cursor) {
    const secondPage = await bot.materialService.listImages(firstPage.next_cursor)
    console.log(secondPage.images)
}
```

按上传时间倒序返回当前机器人有效素材；`next_cursor` 为空表示末页。
每张图片包含 `image_id`、`url`、`file_name`、`preview_url`、`created_at` 和 `expires_at`。
时间戳单位为 Unix 秒。平台可能将 `total`、`created_at`、`expires_at` 的 64 位整数
返回为十进制字符串，因此 SDK 类型为 `number | string`，保持响应原样。
需要进行数值运算时，应由调用方转换并检查数值范围。
`preview_url` 是短时效预览地址，请勿持久化。

## 删除素材

```typescript
await bot.materialService.deleteImage(image.image_id)
```

成功返回 `void`，失败抛出错误。删除释放数量配额，引用链接立即失效；已发送消息中的图片副本不受影响。
SDK 不自动删除素材，也不自动淘汰旧图片。

## 分步上传

需要自行控制上传时，可直接调用基础接口：

```typescript
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const bytes = await readFile('./chart.png')
const prepared = await bot.materialService.prepareImageUpload({
    file_name: 'chart.png',
    file_size: bytes.length,
    content_type: 'image/png',
    md5: createHash('md5').update(bytes).digest('hex'),
    sha1: createHash('sha1').update(bytes).digest('hex'),
})

// 预签名地址必须使用独立客户端，不要使用 bot.request。
const response = await fetch(prepared.presigned_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
})
await response.body?.cancel()
if (!response.ok) throw new Error(`上传失败：${response.status}`)
const md5 = response.headers.get('etag')?.replace(/^"|"$/g, '')
if (!md5) throw new Error('上传响应缺少 ETag')

const image = await bot.materialService.completeImageUpload({
    upload_id: prepared.upload_id,
    md5,
})
```

所有服务方法支持可选的 `{ timeout, signal }` 请求选项：

| 方法 | 参数 | 返回值 |
|------|------|--------|
| `prepareImageUpload` | `payload, options?` | `Promise<MaterialImagePrepareResult>` |
| `completeImageUpload` | `payload, options?` | `Promise<MaterialImageResult>` |
| `uploadImage` | `filePath, options?` 或 `buffer, options` | `Promise<MaterialImageResult>` |
| `listImages` | `cursor?, options?` | `Promise<MaterialImageListResult>` |
| `deleteImage` | `imageId, options?` | `Promise<void>` |

类型均从包入口导出。高级用法可使用 `new MaterialService(bot.request)`。
`uploadImage` 默认每步超时 30 秒；基础接口未指定超时时沿用 `bot.request` 配置。
`timeout: 0` 表示不限时，`signal` 可取消上传流程。

## 平台限制与错误

- 支持 PNG、JPEG、GIF、WebP；文件扩展名必须与 MIME 类型匹配。
- 单张图片不超过 10MB，SDK 按 `10 * 1024 * 1024` 字节限制，并拒绝空文件。
- 单机器人默认最多 100 张，超限需由调用方删除不再使用的素材。
- 素材连续 90 天未被消息引用则过期；成功引用后自动顺延，查询的 `expires_at` 可用于检查有效期。
- 上传任务有效期 4 小时，预签名地址有效期以 `expires_in` 为准。
- 链接与机器人绑定，不可跨机器人使用；同一 Markdown 可混用素材链接与公网图片。
- SDK 校验扩展名、MIME 类型、大小和摘要；调用方仍须确保内容确实为合法图片。

OpenAPI 错误沿用 SDK 的错误处理，保留平台 `code`、`err_code` 和 `trace_id`。
常见错误包括 `40035007`（数量超限）、`40035008`（图片不存在）、
`40035009`（引用过期或已删除）和 `40035010`（引用无效或属于其他机器人）。
COS 直传失败、缺少 ETag 或摘要不符时不会调用完成接口。

完整字段和限制参见[QQ 官方素材管理文档](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/material-management.html)。
