import type { MessageElem, Sendable } from "@/elements";
import { Bot } from "@";
import type { Dict } from "@/types";
import { trimQuote } from "@/utils/string";
import type { User } from "@/entries/user";
import type { ApplicationPlatform } from "@/receivers/middleware";
import { ReceiverMode } from "@/receivers/base";

export class Message {
    message_type: Message.Type
    sub_type: Message.SubType = 'normal'

    get self_id() {
        return this.bot.self_id
    }

    guild_id?: string
    channel_id?: string
    group_id?: string
    id: string
    message_id: string
    sender: Message.Sender
    user_id: string

    constructor(public readonly bot: Bot<ReceiverMode, ApplicationPlatform>, attrs: Dict) {
        const { message_reference, ...otherAttrs } = attrs;
        Object.assign(this, otherAttrs);
        if (message_reference) {
            this.source = {
                id: message_reference.message_id,
                message_id: message_reference.message_id,
            };
        }
    }

    readonly raw_message: string;
    readonly source?: { message_id: string; id: string };
    readonly message: Sendable;


    get [Symbol.unscopables]() {
        return {
            bot: true
        }
    }


    toJSON() {
        return Object.fromEntries(Object.keys(this)
            .filter(key => {
                return typeof this[key] !== "function" && !(this[key] instanceof Bot)
            })
            .map(key => [key, this[key]])
        )
    }
}

export namespace Message {
    export interface Sender {
        user_id: string
        user_name: string
        permissions: User.Permission[]
    }
    export type Ret = MessageRet | FileInfo
    export type MessageRet = {
        id: string
        timestamp: number
    }
    export type Audit = {
        message_audit: {
            audit_id: string
        }
    }
    export type FileInfo = {
        file_uuid: string
        file_info: string
        ttl: number
    }
    export type Type = 'private' | 'group' | 'guild'
    export type SubType = 'direct' | 'friend' | 'temp' | 'normal'

    export function parse(this: Bot<ReceiverMode>, payload: Dict) {
        let template = (payload.content || '').trimStart();
        let result: MessageElem[] = []
        let brief: string = ''
        // 1. 处理文字表情混排
        const regex = /("[^"]*?"|'[^']*?'|`[^`]*?`|“[^”]*?”|‘[^’]*?’|<[^>]+?>)/;
        if (payload.message_reference) {
            result.push({
                type: 'reply',
                data: {
                    id: payload.message_reference.message_id
                }
            })
            brief += `<reply,id=${payload.message_reference.message_id}>`
        }
        while (template.length) {
            const [match] = template.match(regex) || [];
            if (!match) break;
            const index = template.indexOf(match);
            const prevText = template.slice(0, index);
            if (prevText) {
                result.push({
                    type: 'text',
                    data: { text: prevText }
                })
                brief += prevText
            }
            template = template.slice(index + match.length);
            if (match.startsWith('<')) {
                let [type, ...attrs] = match.slice(1, -1).split(',');
                if (type.startsWith('faceType')) {
                    type = 'face'
                    attrs = attrs.map((attr: string) => attr.replace('faceId', 'id'))
                } else if (type.startsWith('@')) {
                    const id = type.replace(/^@!?/, '')
                    const isAll = id === 'all' || id === 'everyone'
                    const mentions = Array.isArray(payload.mentions) ? payload.mentions : []
                    const mention = isAll
                        ? mentions.find((u: Dict) => u.scope === 'all')
                        : mentions.find((u: Dict) =>
                            [u.id, u.member_openid, u.user_openid].includes(id)
                        )
                    const mentionData = { ...(mention || {}) }
                    delete mentionData.id
                    mentionData.user_id = isAll
                        ? 'all'
                        : mention?.id || mention?.member_openid || mention?.user_openid || id
                    type = 'at'
                    attrs = Object.entries(mentionData)
                        .map(([key, value]) => `${key}=${value}`)
                } else if (/^[a-z]+:[0-9]+$/.test(type)) {
                    attrs = ['id=' + type.split(':')[1]]
                    type = 'face'
                }
                if ([
                    'text',
                    'face',
                    'at',
                    'image',
                    'video',
                    'audio',
                    'markdown',
                    'button',
                    'link',
                    'reply',
                    'ark',
                    'embed'
                ].includes(type)) {
                    result.push({
                        type,
                        data:Object.fromEntries(attrs.map((attr: string) => {
                            const [key, ...values] = attr.split('=')
                            return [key.toLowerCase(), trimQuote(values.join('='))]
                        })
                    )
                    })
                    brief += `<${type},${attrs.join(',')}>`
                } else {
                    result.push({
                        type: 'text',
                        data: { text: match }
                    })
                }
            } else {
                result.push({
                    type: "text",
                    data: { text: match }
                });
                brief += match;
            }
        }
        if (template) {
            result.push({
                type: 'text',
                data: { text: template }
            })
            brief += template
        }
        // 2. 将附件添加到消息中
        if (payload.attachments) {
            for (const attachment of payload.attachments) {
                let { content_type, ...data } = attachment
                const [type] = content_type.split('/')
                if (!data.url.startsWith('http'))
                    data.url = `https://${data.url}`
                if (data.filename) {
                    data.name = data.filename
                    delete data.filename
                }
                result.push({
                    type,
                    data,
                })
                brief += `<${type},${Object.entries(data).map(([key, value]) => `${key}=${value}`).join(',')}>`
            }
        }
        delete payload.attachments
        return [result, brief]
    }
}

