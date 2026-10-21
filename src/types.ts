import {Channel} from "@/entries/channel";
import {Guild} from "@/entries/guild";
import {GuildMember} from "@/entries/guildMember";

export type Dict<T = any, K extends string | symbol = string> = Record<K, T>

export type MaterialImageContentType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export interface MaterialRequestOptions {
    /** 单次请求超时（毫秒）；0 表示不限制。uploadImage 默认每步 30 秒。 */
    timeout?: number
    signal?: AbortSignal
}

export interface MaterialImageUploadOptions extends MaterialRequestOptions {
    /** 本地路径默认取文件名；Buffer 必填。 */
    fileName?: string
    /** 本地路径默认按文件扩展名推导；Buffer 必填。 */
    contentType?: MaterialImageContentType
}

export interface MaterialImagePrepareParams {
    file_name: string
    file_size: number
    content_type: MaterialImageContentType
    /** 32 位十六进制。 */
    md5: string
    /** 40 位十六进制。 */
    sha1: string
}

export interface MaterialImagePrepareResult {
    /** 上传任务有效期 4 小时。 */
    upload_id: string
    presigned_url: string
    /** 预签名地址有效期（秒）。 */
    expires_in: number
}

export interface MaterialImageCompleteParams {
    upload_id: string
    /** COS PUT 响应 ETag 去掉引号后的值。 */
    md5: string
}

export interface MaterialImageResult {
    image_id: string
    /** 用于 Markdown 的 qqbot-media:// 引用，与当前机器人绑定。 */
    url: string
    /** 滑动有效期窗口（秒），成功引用后顺延。 */
    ttl: number
    /** 临时预览链接，不应持久化存储。 */
    preview_url: string
}

export interface MaterialImageInfo {
    image_id: string
    url: string
    file_name: string
    /** 临时预览链接，不应持久化存储。 */
    preview_url: string
    /** Unix 秒；平台可能将 int64 编码为十进制字符串。 */
    created_at: number | string
    /** Unix 秒，成功引用后顺延；平台可能返回十进制字符串。 */
    expires_at: number | string
}

export interface MaterialImageListResult {
    images: MaterialImageInfo[]
    /** 空字符串表示末页。 */
    next_cursor: string
    /** 平台可能将 uint64 编码为十进制字符串。 */
    total: number | string
}

/** 流式私聊消息的输入模式。 */
export type PrivateStreamInputMode = 'append' | 'replace'

/** 流式私聊消息的内容格式。 */
export type PrivateStreamContentType = 'text' | 'markdown'

/** QQ OpenAPI 流式发送单聊消息请求体。 */
export interface PrivateStreamMessagePayload {
    /** append（默认）追加增量内容；replace 传入当前完整正文。 */
    input_mode?: PrivateStreamInputMode
    /** 1=生成中，10=生成结束。 */
    input_state?: 1 | 10
    /** 分片序号，从 0 递增。 */
    index?: number
    content_type?: PrivateStreamContentType
    content_raw?: string
    /** 被动回复事件 ID，与 msg_id 二选一。 */
    event_id?: string
    /** 被动回复消息 ID，与 event_id 二选一。 */
    msg_id?: string
    /** 首片响应返回的消息 ID，后续分片必须携带。 */
    stream_msg_id?: string
    /** 消息序号，用于去重。 */
    msg_seq?: number
    /** 是否为召回消息；为 true 时不校验被动回复凭据有效期。 */
    is_wakeup?: boolean
}

/** QQ OpenAPI 流式发送单聊消息响应体。 */
export interface PrivateStreamMessageResult {
    /** 首片响应时作为后续请求的 stream_msg_id。 */
    id: string
    /** RFC3339 格式的消息发送时间。 */
    timestamp: string
    ext_info?: {
        ref_idx?: string
        [key: string]: unknown
    }
    remain_msg_len?: number
    [key: string]: unknown
}

export interface PrivateStreamSendOptions {
    timeout?: number
}
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off";

// websocket建立成功回包
export interface DataPacket {
    op: number; // opcode ws的类型
    d?: Record<string, any>;
    s: number; // 心跳的唯一标识
    t: string; // 事件类型
    id?: string; // 事件ID
}

export enum AnnounceType {
    Member,
    WelCome
}

export type Announce = {
    guild_id: string
    channel_id: string
    message_id: string
    announces_type: AnnounceType
    recommend_channels: { channel_id: string, introduce: string }[]
}
export type ChannelPermissions = {
    channel_id: string
    permissions: string
}
export type ChannelMemberPermissions = {
    user_id: string
} & ChannelPermissions
export type ChannelRolePermissions = {
    role_id: string
} & ChannelPermissions
export type UpdatePermissionParams = {
    add?: string
    remove?: string
}
export type ChannelUpdateInfo = Partial<Pick<Channel.Info, 'name' | 'position' | 'parent_id' | 'private_type' | 'speak_permission'>>
export type RoleCreateParam = {
    name?: string
    color: number
    hoist: 0 | 1
}
export type RoleUpdateParam = Partial<Pick<Guild.Role, 'id' | 'name' | 'color' | 'hoist'>>

export type PinsMessage = {
    guild_id: string
    channel_id: string
    message_ids: string[]
}

export interface DMS {
    guild_id: string
    channel_id: string
    create_time: number
}
export interface ScheduleInfo{
    id?:string
    name:string
    description?:string
    start_timestamp:string
    end_timestamp:string
    creator?:GuildMember.ApiInfo
    jump_channel_id:string
    remind_type:RemindType
}
export type RemindType=0|1|2|3|4|5|6
export type AudioStatus=0|1|2|3
export interface AudioControl{
    audio_url?:string
    text?:string
    status:AudioStatus
}
export interface AudioAction{
    guild_id:string
    channel_id:string
    audio_url:string
    text:string
}
export interface Thread{
    guild_id:string
    channel_id:string
    author_id:string
    thread_info:ThreadInfo
}
export interface ThreadInfo{
    thread_id:string
    title:string
    content:string
    date_time:number
}
export interface Post{
    guild_id:string
    channel_id:string
    author_id:string
    post_info:PostInfo
}
export interface PostInfo{
    thread_id:string
    post_id:string
    content:string
    date_time:number
}
export interface Reply{
    guild_id:string
    channel_id:string
    author_id:string
    reply_info:ReplyInfo
}
export interface ReplyInfo{
    thread_id:string
    post_id:string
    reply_id:string
    content:string
    date_time:number
}
export type ApiPermissionDemand = {
    guild_id: string
    channel_id: string
    api_identify: ApiBaseInfo
    title: string
    desc: string
}

export type ApiBaseInfo = {
    path: string
    method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT"
}
export type RecommendInfo = {
    channel_id: string
    introduce: string
}
export enum AuditType{
    Thread=1,
    Post,
    Reply
}
export type ReactionTarget={
    id:string
    type:ReactionTargetType
}
export type Emoji={
    id:string
    type:EmojiType
}
export enum EmojiType{
    System=1,
    Emoji
}
export enum ReactionTargetType{
    Message,
    Thread,
    Comment,
    Reply,
    ReactionTargetType_MSG = 'ReactionTargetType_MSG'
}

export interface GatewayInfo {
    url: string;
    shards?: number;
    session_start_limit?: {
        total: number;
        remaining: number;
        reset_after: number;
        max_concurrency: number;
    };
}
