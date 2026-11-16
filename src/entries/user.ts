export namespace User {
    /** QQ OpenAPI 用户基本信息响应，不包含群身份或群名片 */
    export interface ApiInfo {
        /** 跨应用关联用户 OpenID，仅绑定了第三方应用时有效 */
        union_openid?: string
        username: string
        /** 用户头像原图 URL */
        avatar: string
        /** 是否接收主动推送 */
        allow_proactive_msg: boolean
    }

    export interface Info {
        id: string
        username: string
        avatar: string
        bot: boolean
        public_flag: number
    }

    export enum Permission {
        normal = 1,
        admin = 2,
        owner = 4,
        channelAdmin = 5,
    }
}
