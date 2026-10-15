const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { Bot, ReceiverMode, ReceiverFactory } = require('../lib')

const root = path.resolve(__dirname, '..')
const packet = () => ({ op: 0, t: 'C2C_MESSAGE_CREATE', id: 'test-event', s: 1, d: {} })

function createBot(t) {
    const bot = new Bot({ appid: 'error-boundary-test', secret: 'test-secret', mode: ReceiverMode.WEBSOCKET, logLevel: 'off' })
    bot.logger = Object.fromEntries(['debug', 'info', 'mark', 'warn', 'error'].map(level => [level, t.mock.fn()]))
    t.after(async () => {
        await bot.stop()
        bot.sessionManager.connectionManager.destroy()
        ReceiverFactory.clearAll()
    })
    return bot
}

function runChild(source) {
    return spawnSync(process.execPath, ['-e', source], {
        cwd: root, encoding: 'utf8', timeout: 5000,
    })
}

test('multiple bots and lifecycle changes preserve host process listeners', () => {
    const child = runChild(`
        const assert = require('node:assert/strict');
        const { Bot, ReceiverMode, ReceiverFactory } = require('./lib');
        const events = ['uncaughtException', 'unhandledRejection'];
        const handlers = events.map(() => () => {});
        events.forEach((event, index) => process.on(event, handlers[index]));
        const before = events.map(event => process.rawListeners(event));
        const verify = () => events.forEach((event, index) => assert.deepEqual(process.rawListeners(event), before[index]));
        (async () => {
            const bots = [0, 1, 2].map(index => new Bot({
                appid: 'process-listener-test-' + index, secret: 'test-secret', mode: ReceiverMode.WEBSOCKET, logLevel: 'off'
            }));
            verify();
            for (const bot of bots) {
                bot.request.post = async () => ({ status: 200, data: { access_token: 'test-token', expires_in: 3600 } });
                bot.receiver.start = async () => bot.receiver.emit('ready');
                for (let cycle = 0; cycle < 2; cycle++) {
                    await bot.start();
                    verify();
                    await bot.stop();
                    verify();
                }
                bot.sessionManager.connectionManager.destroy();
            }
            ReceiverFactory.clearAll();
        })().catch(error => { console.error(error); process.exit(1); });
    `)
    assert.equal(child.error, undefined)
    assert.equal(child.status, 0, child.stderr || child.stdout)
})

for (const [name, fail] of [
    ['uncaught exception', "throw new Error('HOST_UNCAUGHT_TEST')"],
    ['unhandled rejection', "Promise.reject(new Error('HOST_REJECTION_TEST'))"],
]) {
    test(`SDK construction preserves Node failure behavior for ${name}`, () => {
        const child = runChild(`
            const { Bot, ReceiverMode } = require('./lib');
            new Bot({ appid: 'fatal-boundary-test', secret: 'test-secret', mode: ReceiverMode.WEBSOCKET, logLevel: 'off' });
            ${fail};
        `)
        assert.equal(child.error, undefined)
        assert.notEqual(child.status, 0)
        assert.match(child.stderr, /HOST_(?:UNCAUGHT|REJECTION)_TEST/)
    })
}

test('protocol parser failure logs the original error and does not prevent the next event', async t => {
    const bot = createBot(t)
    const failure = new Error('malformed protocol payload')
    let first = true
    t.mock.method(bot, 'processPayload', () => {
        if (first) { first = false; throw failure }
        return { message_id: 'valid-message' }
    })
    const received = t.mock.fn()
    bot.on('message.private.friend', received)
    assert.doesNotThrow(() => bot.dispatchEvent('C2C_MESSAGE_CREATE', packet()))
    assert.equal(received.mock.callCount(), 0)
    assert.equal(bot.logger.error.mock.callCount(), 1)
    assert.equal(bot.logger.error.mock.calls[0].arguments[2], failure)
    bot.dispatchEvent('C2C_MESSAGE_CREATE', packet())
    assert.equal(received.mock.callCount(), 1)
})

test('protocol preprocessing failures are handled before application callbacks', async t => {
    const bot = createBot(t)
    const failure = new Error('invalid mention payload')
    t.mock.method(bot, 'completeGroupAtMention', () => { throw failure })
    const parse = t.mock.method(bot, 'processPayload', () => ({}))
    assert.doesNotThrow(() => bot.dispatchEvent('GROUP_AT_MESSAGE_CREATE', packet()))
    assert.equal(parse.mock.callCount(), 0)
    assert.equal(bot.logger.error.mock.calls[0].arguments[2], failure)
})

test('filtered payloads do not invoke application callbacks or report an exception', async t => {
    const bot = createBot(t)
    t.mock.method(bot, 'processPayload', () => null)
    const received = t.mock.fn()
    bot.on('message', received)
    bot.dispatchEvent('C2C_MESSAGE_CREATE', packet())
    assert.equal(received.mock.callCount(), 0)
    assert.equal(bot.logger.error.mock.callCount(), 0)
})

test('synchronous host callback failure propagates without being logged as a parsing failure', async t => {
    const bot = createBot(t)
    t.mock.method(bot, 'processPayload', () => ({ message_id: 'test-message' }))
    const failure = new Error('host business failure')
    bot.on('message', () => { throw failure })
    assert.throws(() => bot.dispatchEvent('C2C_MESSAGE_CREATE', packet()), error => error === failure)
    assert.equal(bot.logger.error.mock.callCount(), 0)
    assert.equal(bot.logger.debug.mock.calls.some(call => call.arguments[0] === 'Failed to parse event:'), false)
})

test('event hierarchy is preserved when a specific host callback throws', async t => {
    const bot = createBot(t)
    t.mock.method(bot, 'processPayload', () => ({}))
    const events = []
    const failure = new Error('friend handler failed')
    bot.on('message', () => events.push('message'))
    bot.on('message.private', () => events.push('message.private'))
    bot.on('message.private.friend', () => { events.push('message.private.friend'); throw failure })
    assert.throws(() => bot.dispatchEvent('C2C_MESSAGE_CREATE', packet()), error => error === failure)
    assert.deepEqual(events, ['message', 'message.private', 'message.private.friend'])
    assert.equal(bot.logger.error.mock.callCount(), 0)
})

test('host can catch asynchronous message failure at its own callback boundary', async t => {
    const bot = createBot(t)
    t.mock.method(bot, 'processPayload', () => ({}))
    const failure = new Error('host asynchronous failure')
    let resolveFailure
    const observed = new Promise(resolve => { resolveFailure = resolve })
    bot.on('message.private.friend', event => {
        void (async () => {
            assert.equal(event.post_type, 'message')
            throw failure
        })().catch(resolveFailure)
    })
    bot.dispatchEvent('C2C_MESSAGE_CREATE', packet())
    assert.equal(await observed, failure)
    assert.equal(bot.logger.error.mock.callCount(), 0)
})
