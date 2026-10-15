const assert = require('node:assert/strict')
const { test } = require('node:test')
const { once } = require('node:events')
const { WebSocket, WebSocketServer } = require('ws')
const { Session, Auth, Connection, ReceiverMode, ReceiverFactory } = require('../lib')

const flush = () => new Promise(resolve => setImmediate(resolve))
const logger = Object.fromEntries(['debug', 'info', 'mark', 'warn', 'error'].map(level => [level, () => {}]))
const tokenResponse = access_token => ({ status: 200, data: { access_token, expires_in: 3600 } })

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

function createSession(t, config = {}) {
    const bot = {
        config: { appid: 'session-stop-test', secret: 'test-secret', mode: ReceiverMode.WEBSOCKET, ...config },
        logger,
        request: {
            post: async () => tokenResponse('test-token'),
            get: async () => ({ data: { url: 'ws://unused.example' } }),
        },
        dispatchEvent() {},
    }
    const session = new Session(bot)
    t.after(async () => {
        t.mock.restoreAll()
        await session.stop()
        session.connectionManager.destroy()
        ReceiverFactory.clearAll()
    })
    return session
}

async function startWithoutSocket(t, session) {
    t.mock.method(session.receiver, 'start', async () => session.receiver.emit('ready'))
    await session.start()
}

test('stop clears token refresh, gateway cache, connection state and heartbeat', { timeout: 2000 }, async t => {
    const session = createSession(t)
    await startWithoutSocket(t, session)
    await session.getWsUrl()
    const refreshTimer = session.authManager.refreshTimer
    const heartbeat = session.connectionManager.heartbeatTimer
    assert.ok(refreshTimer)
    assert.ok(heartbeat)
    await session.stop()
    assert.equal(session.access_token, '')
    assert.equal(session.wsUrl, '')
    assert.equal(session.alive, false)
    assert.equal(session.authManager.refreshTimer, undefined)
    assert.equal(session.authManager.gatewayInfo, undefined)
    assert.equal(session.connectionManager.heartbeatTimer, undefined)
    assert.equal(refreshTimer._destroyed, true)
    assert.equal(heartbeat._destroyed, true)
})

test('concurrent stop waits for receiver cleanup and runs it once', { timeout: 2000 }, async t => {
    const session = createSession(t)
    await startWithoutSocket(t, session)
    const cleanup = deferred()
    const stop = t.mock.method(session.receiver, 'stop', () => cleanup.promise)
    const pending = session.stop()
    assert.equal(session.stop(), pending)
    let stopped = false
    pending.then(() => { stopped = true })
    await flush()
    assert.equal(stop.mock.callCount(), 1)
    assert.equal(stopped, false)
    assert.equal(session.access_token, '')
    cleanup.resolve()
    await pending
    assert.equal(stopped, true)
})

test('receiver cleanup failure rejects stop while auth and connection remain stopped', { timeout: 2000 }, async t => {
    const session = createSession(t)
    await startWithoutSocket(t, session)
    const failure = new Error('receiver cleanup failed')
    t.mock.method(session.receiver, 'stop', async () => { throw failure })
    await assert.rejects(session.stop(), error => error === failure)
    assert.equal(session.access_token, '')
    assert.equal(session.alive, false)
    assert.equal(session.authManager.refreshTimer, undefined)
})

test('start requested during stop waits for old receiver cleanup', { timeout: 2000 }, async t => {
    const session = createSession(t)
    const start = t.mock.method(session.receiver, 'start', async () => session.receiver.emit('ready'))
    await session.start()
    const cleanup = deferred()
    t.mock.method(session.receiver, 'stop', () => cleanup.promise)
    const stopping = session.stop()
    const restarting = session.start()
    await flush()
    assert.equal(start.mock.callCount(), 1)
    cleanup.resolve()
    await stopping
    await restarting
    assert.equal(start.mock.callCount(), 2)
    assert.equal(session.alive, true)
})

test('old token response after restart cannot overwrite the new token or timer', { timeout: 2000 }, async t => {
    const session = createSession(t)
    await startWithoutSocket(t, session)
    const oldRequest = deferred()
    let oldSignal
    const post = t.mock.method(session.getBot().request, 'post', (url, body, options) => {
        oldSignal = options.signal
        return oldRequest.promise
    })
    const oldRefresh = assert.rejects(session.authManager.refreshAccessToken(), { name: 'AbortError' })
    await session.stop()
    assert.equal(oldSignal.aborted, true)
    post.mock.restore()
    t.mock.method(session.getBot().request, 'post', async () => tokenResponse('new-token'))
    await session.start()
    const newTimer = session.authManager.refreshTimer
    oldRequest.resolve(tokenResponse('old-token'))
    await oldRefresh
    assert.equal(session.access_token, 'new-token')
    assert.equal(session.authManager.refreshTimer, newTimer)
})

test('old gateway response after restart cannot overwrite the new gateway', { timeout: 2000 }, async t => {
    const session = createSession(t)
    await startWithoutSocket(t, session)
    const oldRequest = deferred()
    let oldSignal
    const get = t.mock.method(session.getBot().request, 'get', (url, options) => {
        oldSignal = options.signal
        return oldRequest.promise
    })
    const oldGateway = assert.rejects(session.getWsUrl(), { name: 'AbortError' })
    await flush()
    await session.stop()
    assert.equal(oldSignal.aborted, true)
    get.mock.restore()
    t.mock.method(session.getBot().request, 'get', async () => ({ data: { url: 'ws://new.example' } }))
    await session.start()
    assert.equal(await session.getWsUrl(), 'ws://new.example')
    oldRequest.resolve({ data: { url: 'ws://old.example' } })
    await oldGateway
    assert.equal(session.wsUrl, 'ws://new.example')
    assert.equal(session.authManager.gatewayInfo.url, 'ws://new.example')
})

for (const operation of ['token', 'gateway']) {
    test(`clearAuth cancels pending ${operation} retry delay`, { timeout: 2000 }, async t => {
        let attempts = 0
        const request = {
            post: async () => {
                if (operation === 'token') { attempts++; throw new Error('temporary token failure') }
                return tokenResponse('test-token')
            },
            get: async () => { attempts++; throw new Error('temporary gateway failure') },
        }
        const auth = new Auth({ appid: 'auth-test', secret: 'test-secret', retryDelay: 60000 }, { logger, request })
        t.after(() => auth.destroy())
        const pending = operation === 'token' ? auth.refreshAccessToken() : auth.getGatewayInfo()
        const rejected = assert.rejects(pending, { name: 'AbortError' })
        await flush()
        assert.equal(attempts, 1)
        auth.clearAuth()
        await rejected
        assert.equal(attempts, 1)
        assert.equal(auth.refreshTimer, undefined)
    })
}

for (const settle of ['resolve', 'reject']) {
    test(`automatic refresh ${settle} after stop cannot schedule another timer`, { timeout: 2000 }, async t => {
        const session = createSession(t)
        t.mock.timers.enable({ apis: ['setTimeout'] })
        await startWithoutSocket(t, session)
        const late = deferred()
        const post = t.mock.method(session.getBot().request, 'post', () => late.promise)
        t.mock.timers.tick(3555000)
        await flush()
        assert.equal(post.mock.callCount(), 1)
        await session.stop()
        if (settle === 'resolve') late.resolve(tokenResponse('late-token'))
        else late.reject(new Error('late failure'))
        await flush()
        t.mock.timers.tick(20000)
        await flush()
        assert.equal(post.mock.callCount(), 1)
        assert.equal(session.access_token, '')
        assert.equal(session.authManager.refreshTimer, undefined)
    })
}

test('connection manager cancels a delayed reconnect even if a new cycle has started', { timeout: 2000 }, async t => {
    const connection = new Connection({ logger }, { reconnectDelay: 60000 })
    t.after(() => connection.destroy())
    const connect = t.mock.method(connection, 'connect', async () => {})
    const oldReconnect = connection.handleReconnect()
    assert.equal(connection.pendingDelays.size, 1)
    await connection.disconnect()
    connection.handleReady()
    await oldReconnect
    assert.equal(connection.pendingDelays.size, 0)
    assert.equal(connect.mock.callCount(), 0)
    assert.equal(connection.isAlive(), true)
})

test('stop during connection recycling prevents its queued connect', { timeout: 2000 }, async t => {
    const connection = new Connection({ logger })
    t.after(() => connection.destroy())
    const connect = t.mock.method(connection, 'connect', async () => {})
    const oldDisconnect = connection.handleDisconnect({ code: 4001 })
    await connection.disconnect()
    await oldDisconnect
    assert.equal(connect.mock.callCount(), 0)
    assert.equal(connection.isAlive(), false)
})

test('a pending session reconnect gateway request cannot start a receiver after stop', { timeout: 2000 }, async t => {
    const session = createSession(t)
    const start = t.mock.method(session.receiver, 'start', async () => session.receiver.emit('ready'))
    await session.start()
    const late = deferred()
    t.mock.method(session.getBot().request, 'get', () => late.promise)
    await session.connectionManager.connect()
    await flush()
    await session.stop()
    late.resolve({ data: { url: 'ws://late.example' } })
    await flush()
    assert.equal(start.mock.callCount(), 1)
    assert.equal(session.wsUrl, '')
    assert.equal(session.alive, false)
})

test('WebSocket stop cancels its reconnect timer immediately', { timeout: 2000 }, async t => {
    const session = createSession(t)
    const receiver = session.receiver
    receiver.session = session
    receiver._isStarted = true
    const connect = t.mock.method(receiver, 'connect', async () => {})
    const reconnect = receiver.reconnect(false)
    assert.equal(typeof receiver.cancelReconnectDelay, 'function')
    await session.stop()
    await reconnect
    assert.equal(receiver.cancelReconnectDelay, undefined)
    assert.equal(connect.mock.callCount(), 0)
})

test('local WebSocket stop closes the old socket and permits a clean restart', { timeout: 4000 }, async t => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await once(server, 'listening')
    t.after(async () => {
        for (const client of server.clients) client.terminate()
        await new Promise(resolve => server.close(resolve))
    })
    server.on('connection', client => client.send(JSON.stringify({
        op: 0, t: 'READY', s: 1,
        d: { user: { id: 'test-bot', username: 'test-bot' }, session_id: 'test-session' },
    })))
    const session = createSession(t)
    let closes = 0
    session.receiver.on('close', () => { closes++ })
    t.mock.method(session.getBot().request, 'get', async () => ({
        data: { url: `ws://127.0.0.1:${server.address().port}` },
    }))
    await session.start()
    const oldSocket = session.receiver.handler.ws
    assert.equal(session.alive, true)
    await session.stop()
    assert.equal(oldSocket.readyState, WebSocket.CLOSED)
    assert.equal(session.receiver.isStarted, false)
    assert.equal(session.receiver.isReady, false)
    assert.equal(closes, 1)
    await session.start()
    assert.equal(session.alive, true)
    assert.notEqual(session.receiver.handler.ws, oldSocket)
    oldSocket.emit('close', 4001, Buffer.from('late old socket close'))
    await flush()
    assert.equal(session.alive, true)
    assert.equal(closes, 1)
    await session.stop()
    assert.equal(closes, 2)
})

test('stop before token fetch starts cancels startup without making a request', { timeout: 2000 }, async t => {
    const session = createSession(t)
    const post = t.mock.method(session.getBot().request, 'post', async () => tokenResponse('unused'))
    const rejected = assert.rejects(session.start(), /启动已停止/)
    await session.stop()
    await rejected
    assert.equal(post.mock.callCount(), 0)
    assert.equal(session.authManager.refreshTimer, undefined)
})

test('local Webhook server is closed before stop resolves and can start again', { timeout: 2000 }, async t => {
    const session = createSession(t, { mode: ReceiverMode.WEBHOOK, port: 0, path: '/webhook' })
    const server = session.receiver.handler.server
    await session.start()
    assert.equal(server.listening, true)
    await session.stop()
    assert.equal(server.listening, false)
    assert.equal(server.address(), null)
    assert.equal(session.alive, false)
    await session.start()
    assert.equal(server.listening, true)
    assert.equal(session.alive, true)
    await session.stop()
})
