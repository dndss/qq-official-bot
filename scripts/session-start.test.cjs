const assert = require('node:assert/strict')
const { test } = require('node:test')
const { Session, ReceiverMode, ReceiverFactory } = require('../lib')

function createSession(t, mode = ReceiverMode.WEBSOCKET) {
    const noop = () => {}
    const bot = {
        config: {
            appid: 'session-start-test', secret: 'test-secret', mode,
            ...(mode === ReceiverMode.WEBHOOK ? { port: 3000, path: '/webhook' } : {}),
        },
        logger: { debug: noop, info: noop, mark: noop, warn: noop, error: noop },
        request: {
            post: async () => ({ status: 200, data: { access_token: 'test-token', expires_in: 3600 } }),
        },
        dispatchEvent: noop,
    }
    const session = new Session(bot)
    t.after(async () => {
        session.userClose = true
        session.authManager.clearAuth()
        session.connectionManager.destroy()
        await session.receiver.stop()
        ReceiverFactory.clearAll()
    })
    return session
}

function listenerCounts(receiver) {
    return Object.fromEntries(['ready', 'error', 'close'].map(event => [event, receiver.listenerCount(event)]))
}

test('startup waits for ready after the receiver start method resolves', { timeout: 1500 }, async t => {
    const session = createSession(t)
    const before = listenerCounts(session.receiver)
    const start = t.mock.method(session.receiver, 'start', async () => {})
    let ready = false
    const pending = session.start().then(() => { ready = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(ready, false)
    assert.equal(start.mock.callCount(), 1)

    session.receiver.emit('ready')
    await pending
    assert.deepEqual(listenerCounts(session.receiver), before)
})

test('synchronous ready is observed and concurrent startup calls share one attempt', { timeout: 1500 }, async t => {
    const session = createSession(t)
    const before = listenerCounts(session.receiver)
    const token = t.mock.method(session, 'getAccessToken', async () => ({ access_token: 'test-token', expires_in: 3600 }))
    const start = t.mock.method(session.receiver, 'start', async () => session.receiver.emit('ready'))
    const pending = session.start()
    assert.equal(session.start(), pending)
    await pending
    assert.equal(token.mock.callCount(), 1)
    assert.equal(start.mock.callCount(), 1)
    assert.deepEqual(listenerCounts(session.receiver), before)
})

for (const mode of [ReceiverMode.WEBSOCKET, ReceiverMode.WEBHOOK]) {
    test(`${mode} receiver startup rejection reaches the caller`, { timeout: 1500 }, async t => {
        const session = createSession(t, mode)
        const before = listenerCounts(session.receiver)
        const failure = new Error('receiver startup failed')
        t.mock.method(session.receiver, 'start', async () => { throw failure })

        await assert.rejects(session.start(), error => error === failure)
        assert.equal(session.userClose, true)
        assert.equal(session.access_token, '')
        assert.equal(session.authManager.refreshTimer, undefined)
        assert.deepEqual(listenerCounts(session.receiver), before)
    })
}

test('synchronous startup throw is returned as a rejection', { timeout: 1500 }, async t => {
    const session = createSession(t)
    const before = listenerCounts(session.receiver)
    const failure = new Error('synchronous startup failure')
    t.mock.method(session.receiver, 'start', () => { throw failure })
    await assert.rejects(session.start(), error => error === failure)
    assert.deepEqual(listenerCounts(session.receiver), before)
})

test('token failure never starts the receiver', { timeout: 1500 }, async t => {
    const session = createSession(t)
    const before = listenerCounts(session.receiver)
    const failure = new Error('invalid credentials')
    t.mock.method(session, 'getAccessToken', async () => { throw failure })
    const start = t.mock.method(session.receiver, 'start', async () => {})
    await assert.rejects(session.start(), error => error === failure)
    assert.equal(start.mock.callCount(), 0)
    assert.deepEqual(listenerCounts(session.receiver), before)
})

test('real WebSocket startup catches gateway failure without an unhandled rejection', { timeout: 1500 }, async t => {
    const session = createSession(t)
    const before = listenerCounts(session.receiver)
    const failure = new Error('gateway unavailable')
    t.mock.method(session, 'getWsUrl', async () => { throw failure })
    await assert.rejects(session.start(), error => error === failure)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(session.receiver.isStarted, false)
    assert.equal(session.authManager.refreshTimer, undefined)
    assert.deepEqual(listenerCounts(session.receiver), before)
})

test('receiver error before ready rejects startup and late rejection is consumed', { timeout: 1500 }, async t => {
    const session = createSession(t)
    const before = listenerCounts(session.receiver)
    const failure = new Error('handshake failed')
    let rejectReceiver
    t.mock.method(session.receiver, 'start', () => new Promise((resolve, reject) => { rejectReceiver = reject }))
    const rejected = assert.rejects(session.start(), error => error === failure)
    await new Promise(resolve => setImmediate(resolve))
    session.receiver.emit('error', failure)
    await rejected
    rejectReceiver(failure)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(listenerCounts(session.receiver), before)
})

test('close before ready rejects startup without scheduling connection manager reconnect', { timeout: 1500 }, async t => {
    const session = createSession(t)
    const before = listenerCounts(session.receiver)
    t.mock.method(session.receiver, 'start', async () => {})
    const connect = t.mock.method(session.connectionManager, 'connect', async () => {})
    const rejected = assert.rejects(session.start(), /4001: closed before ready/)
    await new Promise(resolve => setImmediate(resolve))
    session.receiver.emit('close', 4001, 'closed before ready')
    await rejected
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(connect.mock.callCount(), 0)
    assert.deepEqual(listenerCounts(session.receiver), before)
})

test('stop during startup rejects the pending wait and cleans temporary listeners', { timeout: 1500 }, async t => {
    const session = createSession(t)
    const before = listenerCounts(session.receiver)
    t.mock.method(session.receiver, 'start', async () => {})
    const rejected = assert.rejects(session.start(), /启动已停止/)
    await new Promise(resolve => setImmediate(resolve))
    await session.stop()
    await rejected
    assert.equal(session.authManager.refreshTimer, undefined)
    assert.deepEqual(listenerCounts(session.receiver), before)
})

test('stop during token fetch prevents a late response from starting the receiver', { timeout: 1500 }, async t => {
    const session = createSession(t)
    const before = listenerCounts(session.receiver)
    let releaseToken
    t.mock.method(session.getBot().request, 'post', () => new Promise(resolve => { releaseToken = resolve }))
    const start = t.mock.method(session.receiver, 'start', async () => {})
    const rejected = assert.rejects(session.start(), /启动已停止/)
    await new Promise(resolve => setImmediate(resolve))
    await session.stop()
    await rejected
    releaseToken({ status: 200, data: { access_token: 'late-token', expires_in: 3600 } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(start.mock.callCount(), 0)
    assert.equal(session.access_token, '')
    assert.equal(session.authManager.refreshTimer, undefined)
    assert.deepEqual(listenerCounts(session.receiver), before)
})

test('a failed startup can be retried without accumulating temporary listeners', { timeout: 1500 }, async t => {
    const session = createSession(t)
    const before = listenerCounts(session.receiver)
    let attempts = 0
    t.mock.method(session.receiver, 'start', async () => {
        if (++attempts === 1) throw new Error('first attempt failed')
        session.receiver.emit('ready')
    })
    await assert.rejects(session.start(), /first attempt failed/)
    await session.start()
    assert.equal(session.userClose, false)
    assert.equal(session.alive, true)
    assert.equal(attempts, 2)
    assert.deepEqual(listenerCounts(session.receiver), before)
})

test('late close or ready after startup failure cannot revive the failed attempt', { timeout: 1500 }, async t => {
    const session = createSession(t)
    t.mock.method(session.receiver, 'start', async () => { throw new Error('startup failed') })
    const connect = t.mock.method(session.connectionManager, 'connect', async () => {})
    await assert.rejects(session.start(), /startup failed/)
    session.receiver.emit('close', 4001, 'late close')
    session.receiver.emit('ready')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(connect.mock.callCount(), 0)
    assert.equal(session.alive, false)
})
