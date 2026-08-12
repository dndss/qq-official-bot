export namespace Group {
    export interface Info {
        id: string
        name: string
    }

    /** QQ OpenAPI 群基本信息响应 */
    export interface ApiInfo {
        group_openid: string
        group_name: string
        group_finger_memo: string
        group_class_text: string
        group_tags: string[]
        group_member_num: number
    }
}
