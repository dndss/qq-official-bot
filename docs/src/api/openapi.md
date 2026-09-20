---
layout: doc
---

# 底层 OpenAPI 请求

当 SDK 暂未封装某个 QQ OpenAPI 时，可以通过 `bot.request` 直接调用底层 HTTP 客户端。
`request` 是一个公开的 Axios 实例，支持 `get`、`post`、`put`、`patch`、`delete`
以及 Axios 的通用请求形式。

SDK 会为请求自动配置：

- 与 `sandbox` 配置对应的 QQ OpenAPI 基础地址；
- `Authorization: QQBot <access_token>`；
- `X-Union-Appid`；
- `timeout` 配置和 SDK 的 OpenAPI 错误处理。

> 建议在 `await bot.start()` 成功后调用底层接口，确保访问令牌已经就绪。

## 获取请求客户端

直接使用 SDK 时：

```typescript
const response = await bot.request.get('/users/@me')
console.log(response.data)
```

在 QQBot-Plugin 的插件事件中，可以从事件机器人对象获取同一个 SDK 实例：

```javascript
const response = await e.bot.sdk.request.get('/users/@me')
console.log(response.data)
```

## GET 请求

查询参数通过 `params` 传入：

```typescript
const response = await bot.request.get('/users/@me/guilds', {
  params: {
    before: 'guild_id',
    limit: 20,
  },
})

console.log(response.data)
```

## POST 请求

第二个参数是请求体，第三个参数是 Axios 请求配置：

```typescript
const response = await bot.request.post(
  `/v2/groups/${groupOpenid}/messages`,
  {
    content: '测试消息',
    msg_type: 0,
    msg_seq: 1,
  },
  {
    timeout: 10_000,
  },
)

console.log(response.data)
```

## PUT 请求

```typescript
const response = await bot.request.put(
  `/interactions/${interactionId}`,
  { code: 0 },
)

console.log(response.status)
```

## PATCH 请求

```typescript
const response = await bot.request.patch(
  `/channels/${channelId}`,
  { name: '新的子频道名称' },
)

console.log(response.data)
```

## DELETE 请求

```typescript
const response = await bot.request.delete(
  `/channels/${channelId}/messages/${messageId}`,
  {
    params: { hidetip: true },
  },
)

console.log(response.status)
```

如果 DELETE 接口需要请求体，应放在配置对象的 `data` 字段中：

```typescript
await bot.request.delete(`/guilds/${guildId}/members/${memberId}`, {
  data: {
    add_blacklist: false,
    delete_history_msg_days: 0,
  },
})
```

## 通用请求形式

需要动态决定方法时，可以直接调用 `request(config)`：

```typescript
const response = await bot.request<{ id: string; username: string }>({
  method: 'GET',
  url: '/users/@me',
  params: {
    example: 'value',
  },
})

console.log(response.data.id)
```

常用配置字段包括：

| 字段 | 类型 | 说明 |
|------|------|------|
| `method` | `string` | HTTP 方法 |
| `url` | `string` | QQ OpenAPI 相对路径 |
| `params` | `object` | URL 查询参数 |
| `data` | `unknown` | 请求体 |
| `headers` | `object` | 附加请求头 |
| `timeout` | `number` | 单次请求的超时时间，单位为毫秒 |
| `responseType` | `string` | Axios 响应数据类型 |

## 响应结构

正常情况下返回 Axios 完整响应，而不是只返回响应体：

```typescript
const response = await bot.request.get('/users/@me')

response.data       // QQ OpenAPI 响应体
response.status     // HTTP 状态码
response.statusText // HTTP 状态文本
response.headers    // 响应头
response.config     // 本次请求配置
```

返回 `204 No Content` 的接口通常没有可用的 `data`，应检查 `response.status`。

## 错误处理

OpenAPI 返回错误时，SDK 抛出的错误会保留 QQ 响应中的以下字段：

- `code`：错误码；
- `err_code`：详细错误码，没有该字段时与 `code` 相同；
- `trace_id`：用于排查请求的链路 ID。

```typescript
try {
  await bot.request.get('/unknown/path')
} catch (error) {
  const requestError = error as Error & {
    code?: number
    err_code?: number
    trace_id?: string
  }

  console.error(requestError.message)
  console.error('code:', requestError.code)
  console.error('err_code:', requestError.err_code)
  console.error('trace_id:', requestError.trace_id)
}
```

出于兼容性考虑，错误码 `304023` 和 `304024` 当前会记录警告并直接返回 QQ
响应体，不会抛出异常。调用这些接口时不要假定结果一定包含 Axios 响应的 `status`
等字段。

网络中断、超时或服务端没有返回响应体时，SDK 会继续抛出原始 Axios 错误。

## 安全注意事项

`request` 的请求拦截器会自动添加机器人鉴权信息。**只应向它传入 QQ OpenAPI
的相对路径**，例如 `/users/@me` 或 `/v2/groups/...`。

不要使用它请求第三方完整 URL：

```typescript
// 请勿这样调用：可能将机器人鉴权请求头发送给第三方服务
await bot.request.get('https://example.com/api')
```

调用普通网站或其他第三方 API 时，请单独使用 `fetch` 或创建不带 QQ Bot
拦截器的 HTTP 客户端。
