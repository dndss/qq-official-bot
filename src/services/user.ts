/**
 * 用户服务类 - 负责用户基本信息相关 API
 */
import { AxiosInstance } from 'axios'
import { User } from '@/entries/user'

export class UserService {
    constructor(private request: AxiosInstance) {}

    /**
     * 获取用户基本信息，需要用户与机器人存在好友关系
     */
    async getInfo(userOpenid: string): Promise<User.ApiInfo> {
        if (typeof userOpenid !== 'string' || !userOpenid.trim()) {
            throw new TypeError('userOpenid 必须是非空字符串')
        }
        const { data: result } = await this.request.get<User.ApiInfo>(
            `/v2/users/${userOpenid}/info`
        )
        return result
    }
}
