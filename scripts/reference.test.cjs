const assert = require('node:assert/strict')
const { test } = require('node:test')
const { parseReferenceMessage, MessageEvent } = require('../lib')

const nested = (content, children) =>
    `[消息内容] ${content}\n[消息类型] 引用消息\n${children
        ? `[关联消息]\n--- 第1条 ---\n${children.replace(/\n$/, '').split('\n').map(line => `    ${line}`).join('\n')}\n`
        : ''}`
const payload = (text) => ({
    message_type: 103,
    content: ' 4',
    msg_elements: [{ content: `=== 消息 1 ===\n${text}` }],
    parallel_message: { msg_nodes: [{ content: '3', message_type: 0 }] },
})

test('structured quote keeps its own index without treating it as the original event ID', () => {
    assert.deepEqual(parseReferenceMessage({
        message_type: 103,
        content: ' 2',
        msg_elements: [{ content: '1', message_type: 103, msg_idx: 'REFIDX_quoted' }],
    }), { nodes: [{ content: '1', msg_idx: 'REFIDX_quoted' }] })
    assert.equal(parseReferenceMessage({ message_type: 0, content: 'ordinary text' }), undefined)
})

test('nested quote preserves 3 -> 2 -> 1 and current message body stays 4', () => {
    const raw = payload(nested(' 3', nested(' 2', nested('1'))))
    assert.deepEqual(parseReferenceMessage(raw), {
        nodes: [{ content: ' 3', children: [{ content: ' 2', children: [{ content: '1' }] }] }],
    })
    const fakeBot = { removeAt() {}, logger: { info() {} } }
    const event = MessageEvent.parse.call(fakeBot, 'message.group', {
        ...raw, id: 'current', group_id: 'group', author: { id: 'sender', username: 'Sender' },
        timestamp: '2026-10-12T23:36:15+08:00',
    })
    assert.equal(event.raw_message, '4')
    assert.deepEqual(event.message, [{ type: 'text', data: { text: '4' } }])
    assert.deepEqual(event.quoted_message, parseReferenceMessage(raw))
})

test('siblings, CRLF and multiline quoted content keep their boundaries', () => {
    const raw = `=== 消息 1 ===\n${nested('first\nsecond', nested('leaf'))}=== 消息 2 ===\n${nested('other')}`
    assert.deepEqual(parseReferenceMessage({ message_type: 103, msg_elements: [{ content: raw.replace(/\n/g, '\r\n') }] }), {
        nodes: [{ content: 'first\nsecond', children: [{ content: 'leaf' }] }, { content: 'other' }],
    })
})

test('missing or changed text format falls back to direct snapshot and retains raw text', () => {
    const raw = payload('[unrecognized format]\ncontent')
    assert.deepEqual(parseReferenceMessage(raw), {
        nodes: [{ content: '3' }],
        raw: raw.msg_elements[0].content,
    })
    assert.deepEqual(parseReferenceMessage({ message_type: 103, msg_elements: [null, { content: 'unknown' }] }), {
        nodes: [], raw: 'unknown',
    })
})

test('untrusted depth, size and number of nodes are bounded', () => {
    let text = nested('leaf')
    for (let index = 0; index < 25; index++) text = nested(`node${index}`, text)
    const deep = parseReferenceMessage(payload(text))
    assert.equal(deep.raw, payload(text).msg_elements[0].content)
    const huge = parseReferenceMessage({ message_type: 103, msg_elements: [{ content: 'x'.repeat(100000), message_type: 103 }] })
    assert.equal(huge.nodes[0].content.length, 65536)
    assert.equal(huge.truncated, true)
    const many = parseReferenceMessage({ message_type: 103, parallel_message: { msg_nodes: Array.from({ length: 110 }, () => ({ content: 'x' })) } })
    assert.equal(many.nodes.length, 100)
    assert.equal(many.truncated, true)
})
