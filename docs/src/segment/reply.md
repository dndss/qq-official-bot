---
layout: doc
---

# 回复消息段

回复消息段同时支持“普通被动回复”和“引用回复”。两种回复使用的标识不同：

- `msg_id` 使用事件的真实消息 ID，即 `event.id`。
- `message_reference.message_id` 使用事件的引用索引，即 `event.msg_idx`。

不要把 `event.id` 同时用于这两个字段。

## 接收嵌套引用

对于 `message_type=103`，SDK 将 `msg_elements` 的结构化内容及嵌套引用文本
解析为 `event.quoted_message`。缺少可解析快照时，使用
`parallel_message.msg_nodes` 中的直接引用内容，并保留无法解析的文本。
当前消息正文仍来自顶层 `content`，不会与引用链拼接。

```typescript
interface ReferenceMessageNode {
  content: string
  msg_idx?: string
  children?: ReferenceMessageNode[]
}

interface ReferenceMessageData {
  nodes: ReferenceMessageNode[]
  raw?: string
  truncated?: boolean
}
```

`parseReferenceMessage(payload)` 也可单独解析原始网关消息体。
解析限制为 16 层、100 个节点、64 KiB 文本；超过限制时保留受限原文。
引用快照不包含可靠的发送者时，不从当前发送者推断。
`TMP_...` 以及不同的 `REFIDX_...` 不建立别名关系；
只有已知消息 ID 或引用索引精确匹配时，使用方才能定位原消息。

## 回复序号

SDK 按 `msg_id` 在内存中维护 5 分钟的回复序号。第一次被动回复使用
`msg_seq = 1`，后续回复依次使用 `2、3……`：

```json
{ "msg_id": "event.id", "msg_seq": 1 }
{ "msg_id": "event.id", "msg_seq": 2 }
```

主动消息不携带 `msg_seq`。如果发送失败，且该序号尚未被后续并发请求占用，
SDK 会回退序号，使调用方再次发送时继续使用原序号。5 分钟后对应的内存计数自动清除。

如果腾讯接口返回 `40054005`（消息被去重）、`40034005`（`msg_id` 已过期）
或其他发送错误，SDK 会直接抛出原始错误，不自动递增重试或改用主动消息发送。
是否重试、何时取消被动请求以及是否转主动，由调用方决定。

## 接口

```typescript
interface Quotable {
  id?: string
  event_id?: string
  msg_idx?: string
}

segment.reply(
  idOrQuotable: string | Quotable,
  quote?: boolean,
  referenceMsgIdx?: string
)
```

| 参数 | 说明 |
|------|------|
| `idOrQuotable` | 真实消息 ID、事件 ID，或者包含这些字段的事件对象 |
| `quote` | 是否显示引用，默认 `false` |
| `referenceMsgIdx` | 被引用消息的引用索引；传入事件对象时可省略，默认读取其 `msg_idx` |

## 普通被动回复

普通回复只填写 `msg_id`：

```typescript
segment.reply(event.id)
```

生成的核心请求结构为：

```json
{
  "msg_id": "event.id",
  "msg_seq": 1
}
```

也可以直接调用事件方法：

```typescript
await event.reply('回复内容')
```

## 引用回复

传入完整事件对象时，SDK 自动读取 `event.id` 和 `event.msg_idx`：

```typescript
segment.reply(event, true)
```

使用字符串时，需要显式传入引用索引：

```typescript
segment.reply(event.id, true, event.msg_idx)
```

两种写法都会生成：

```json
{
  "msg_id": "event.id",
  "msg_seq": 1,
  "message_reference": {
    "message_id": "event.msg_idx"
  }
}
```

引用回复按上述被动回复结构发送，失败时直接抛出原始错误。
如果调用方决定发送主动引用消息，可以显式仅提供引用索引：

```typescript
await bot.sendGroupMessage(event.group_id, [
  { type: 'reply', data: { msg_idx: event.msg_idx } },
  '引用回复内容'
])
```

这会生成 `message_reference`，而不携带 `msg_id` 和 `msg_seq`，引用显示仍会保留。

事件方法也支持相同的 `quote` 参数：

```typescript
await event.reply('引用回复内容', true)
```

如果 `quote` 为 `true`，但没有提供 `msg_idx`，SDK 仍会保留普通被动回复的
`msg_id`，不会错误地用真实消息 ID 填充 `message_reference.message_id`。

## 事件回复

事件回复适用于群聊、C2C 私聊、频道和频道私信：

```typescript
bot.on('message.group', async event => {
  // 不显示引用
  await event.reply('普通回复')

  // 显示引用
  await event.reply('引用回复', true)
})
```

## 事件 ID 回复

按钮等事件可以继续使用 `event_id`：

```typescript
segment.reply({ event_id: interaction.event_id })
```

这类回复使用 `event_id`，不生成 `message_reference`。
