const assert = require('node:assert/strict')
const { test } = require('node:test')
const { MessageEvent } = require('../lib')

function parse(attachments, content = '') {
    const bot = { removeAt() {}, logger: { info() {} } }
    return MessageEvent.parse.call(bot, 'message.group', {
        id: 'voice-event', group_id: 'group', author: { id: 'sender', username: 'Sender' },
        message_type: 0, timestamp: '2026-10-14T23:04:09+08:00', content, attachments,
    })
}

test('official voice events preserve AMR originals and optional WAV copies as audio', () => {
    const event = parse([{
        content_type: 'voice', filename: 'sample.amr', size: 5818,
        url: 'https://media.example/original', voice_wav_url: 'https://media.example/copy.wav',
    }])
    assert.deepEqual(event.message, [{ type: 'audio', data: {
        name: 'sample.amr', size: 5818,
        url: 'https://media.example/original', voice_wav_url: 'https://media.example/copy.wav',
    } }])
})

test('audio MIME types and voice events without WAV keep their original URLs', () => {
    for (const content_type of ['voice', 'audio/amr', 'audio/ogg', 'Audio/mpeg']) {
        const event = parse([{ content_type, filename: 'voice.amr', url: 'media.example/original' }])
        assert.equal(event.message[0].type, 'audio')
        assert.equal(event.message[0].data.url, 'https://media.example/original')
        assert.equal(event.message[0].data.voice_wav_url, undefined)
    }
    const event = parse([{ content_type: 'voice', url: 'media.example/original', voice_wav_url: 'media.example/copy.wav' }])
    assert.equal(event.message[0].data.voice_wav_url, 'https://media.example/copy.wav')
})

test('inline voice markers preserve order and consume the attachment only once', () => {
    const event = parse([
        { content_type: 'voice', filename: 'first.amr', url: 'https://media.example/first' },
        { content_type: 'audio/ogg', filename: 'second.ogg', url: 'https://media.example/second' },
    ], 'before <attachmentType=voice,attachmentIndex=0> after')
    assert.deepEqual(event.message.map((part) => part.type), ['text', 'audio', 'text', 'audio'])
    assert.deepEqual(event.message.filter((part) => part.type === 'audio').map((part) => part.data.name), ['first.amr', 'second.ogg'])
})

test('video, images and ordinary AMR files retain their existing classifications', () => {
    const event = parse([
        { content_type: 'video/mp4', filename: 'video.mp4', url: 'https://media.example/video' },
        { content_type: 'image/png', filename: 'image.png', url: 'https://media.example/image' },
        { content_type: 'application/octet-stream', filename: 'file.amr', url: 'https://media.example/file' },
    ])
    assert.deepEqual(event.message.map((part) => part.type), ['video', 'image', 'file'])
})
