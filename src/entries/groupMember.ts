import {User} from "@/entries/user";

export namespace GroupMember {
    export type Role = 'owner' | 'admin' | 'member'

    export interface Info {
        user: User.Info
        group_id: string
    }

    export interface ApiInfo {
        member_id: string
        member_openid: string
        username: string
        role: Role
        member_role: Role
        bot: boolean
        join_time: number
        joined_at: string
        union_openid?: string
    }
}
