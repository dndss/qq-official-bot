/**
 * 群服务类 - 负责群基本信息相关 API
 */
import { AxiosInstance } from 'axios'
import { Group } from '@/entries'

export class GroupService {
    constructor(private request: AxiosInstance) {}

    /**
     * 获取群基本信息
     */
    async getInfo(groupOpenid: string): Promise<Group.ApiInfo> {
        const { data: result } = await this.request.get<Group.ApiInfo>(
            `/v2/groups/${groupOpenid}/info`
        )
        return result
    }
}
