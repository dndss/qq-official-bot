import { EventEmitter } from "events";
import { Client } from "@/client";
import {ReceiverMode, ApplicationPlatform, ResolveConfig, ReceiverConfigBuilder} from "@/receivers";
import { Intends, SessionEvents } from "@/constants";
import { DataPacket } from "@/types";
import { BaseReceiver } from "@/receivers/base";

// 导入重构后的管理器
import { Connection } from "./connection";
import { Auth } from "@/core/auth";

import { ReceiverFactory,ResolveReceiver } from "@/receivers";

export const MAX_RETRY = 10;

/**
 * 重构后的会话管理器
 * 现在作为连接管理、认证管理和接收器管理的协调者
 */
export class Session<T extends ReceiverMode, M extends ApplicationPlatform = never> extends EventEmitter {
    // 保持向后兼容的公共属性
    public get access_token(): string {
        return this.authManager.getCurrentTokenInfo()?.access_token || "";
    }

    public get wsUrl(): string {
        return this._wsUrl || "";
    }

    public get retry(): number {
        return this.connectionManager.getConnectionState().retry;
    }

    public get alive(): boolean {
        return this.connectionManager.isAlive();
    }

    public get sessionRecord() {
        const state = this.connectionManager.getConnectionState();
        return {
            sessionID: state.sessionID,
            seq: state.seq
        };
    }

    public get heartbeatParam() {
        return this._heartbeatParam;
    }

    public readonly receiver: ResolveReceiver<T, M>;

    // 公共方法访问 bot 实例（用于 receiver）
    public getBot(): Client<T, M> {
        return this.bot;
    }

    // 私有属性
    private readonly bot: Client<T, M>;
    private readonly connectionManager: Connection;
    private readonly authManager: Auth;
    private startPromise?: Promise<void>;
    private rejectStart?: (error: Error) => void;
    private stopPromise?: Promise<void>;
    private receiverStopPromise?: Promise<void>;
    private lifecycleGeneration: number = 0;
    private _wsUrl: string = "";
    private _heartbeatParam = {
        op: 1, // OpCode.HEARTBEAT
        d: null
    };

    // 废弃属性
    public heartbeatInterval: number = 30000;
    public isReconnect: boolean = false;
    public userClose: boolean = false;

    constructor(bot: Client<T, M>) {
        super();
        this.bot = bot;
        // 初始化认证管理器
        const authOptions: ConstructorParameters<typeof Auth>[0] = {
            appid: bot.config.appid,
            secret: bot.config.secret,
            maxRetries: 3,
            tokenRefreshBuffer: 45
        };
        if (bot.config.mode === ReceiverMode.WEBSOCKET) {
            const wsConfig = bot.config as Client.Config<ReceiverMode.WEBSOCKET, M>;
            if (wsConfig.accessTokenUrl) authOptions.accessTokenUrl = wsConfig.accessTokenUrl;
            if (wsConfig.gatewayUrl) authOptions.gatewayUrl = wsConfig.gatewayUrl;
        }
        this.authManager = new Auth(authOptions, bot);

        // 初始化连接管理器
        this.connectionManager = new Connection(bot, {
            maxRetry: bot.config.maxRetry || MAX_RETRY,
            heartbeatInterval: 30000,
            reconnectDelay: 5000
        });

        // 创建接收器
        this.receiver = this.createReceiver();

        // 设置事件处理
        this.setupEventHandlers();
    }

    /**
     * 创建对应模式的接收器
     */
    private createReceiver(){
        if (this.bot.config.mode === ReceiverMode.WEBSOCKET) {
            const config = this.bot.config as Client.Config<ReceiverMode.WEBSOCKET, M>;
            const websocketConfig = ReceiverConfigBuilder.websocket({
                heartbeatInterval: config.heartbeatInterval,
                maxRetries: config.maxRetries ?? config.maxRetry,
                reconnectDelay: config.reconnectDelay
            });
            return ReceiverFactory.createReceiver(this.bot.config.appid, this.bot.config.mode, websocketConfig as unknown as ResolveConfig<T, M>);
        }
        return ReceiverFactory.createReceiver(this.bot.config.appid,this.bot.config.mode,this.bot.config as unknown as ResolveConfig<T, M>)
    }

    /**
     * 设置事件处理器
     */
    private setupEventHandlers(): void {
        // 接收器事件处理
        this.receiver.on("packet", (packet: DataPacket) => {
            this.bot.dispatchEvent(packet.t, packet);
        });

        // 连接管理器事件转发
        this.connectionManager.on(SessionEvents.EVENT_WS, (data) => {
            this.emit(SessionEvents.EVENT_WS, data);
        });

        this.connectionManager.on(SessionEvents.ERROR, (code, message) => {
            this.emit(SessionEvents.ERROR, code, message);
        });

        this.connectionManager.on(SessionEvents.DEAD, (data) => {
            this.emit(SessionEvents.DEAD, data);
        });

        // 连接事件处理
        this.connectionManager.on('connecting', () => {
            this.bot.logger.debug("[SESSION] 开始连接");
        });

        this.connectionManager.on('connect', async () => {
            const generation = this.lifecycleGeneration;
            try {
                await this.receiverStopPromise;
                if (this.userClose || generation !== this.lifecycleGeneration) return;
                // 获取网关地址
                const url = await this.authManager.getGatewayUrl();
                if (this.userClose || generation !== this.lifecycleGeneration) return;
                this._wsUrl = url;

                // 启动接收器
                const receiver: BaseReceiver = this.receiver;
                await receiver.start(this);
            } catch (error) {
                if (this.userClose || generation !== this.lifecycleGeneration) return;
                this.bot.logger.error("[SESSION] 连接准备失败:", error);
                this.connectionManager.emit(SessionEvents.ERROR, -1, `连接准备失败: ${error}`);
            }
        });

        this.connectionManager.on('disconnect', () => {
            void this.stopReceiver().catch(error => {
                this.bot.logger.error("[SESSION] 接收器停止失败:", error);
                this.connectionManager.emit(SessionEvents.ERROR, -1, `接收器停止失败: ${error}`);
            });
        });

        this.connectionManager.on('heartbeat', (heartbeatData) => {
            this._heartbeatParam = heartbeatData;
        });

        // 接收器事件处理
        this.receiver.on('ready', () => {
            if (this.userClose || this.receiverStopPromise) return;
            this.connectionManager.emit(SessionEvents.EVENT_WS, {
                eventType: SessionEvents.READY
            });
        });

        this.receiver.on('error', (error) => {
            this.connectionManager.emit(SessionEvents.ERROR, -1, error.message || error);
        });

        this.receiver.on('close', (code, reason) => {
            if (this.userClose || this.receiverStopPromise || !this.receiver.isStarted) return;
            this.connectionManager.emit(SessionEvents.EVENT_WS, {
                eventType: SessionEvents.DISCONNECT,
                code,
                eventMsg: this.sessionRecord
            });
        });
    }

    /**
     * 获取访问令牌
     */
    async getAccessToken(): Promise<Client.Token> {
        const tokenInfo = await this.authManager.refreshAccessToken();

        return {
            access_token: tokenInfo.access_token,
            expires_in: tokenInfo.expires_in,
        };
    }

    /**
     * 获取WebSocket连接地址
     */
    async getWsUrl(): Promise<string> {
        const generation = this.lifecycleGeneration;
        const url = await this.authManager.getGatewayUrl();
        if (this.userClose || generation !== this.lifecycleGeneration) {
            throw new Error('网关连接操作已取消');
        }
        this._wsUrl = url;
        return this._wsUrl;
    }

    /**
     * 获取有效的意图值
     */
    getValidIntends(): number {
        return (this.bot.config.intents || []).reduce((result, item) => {
            const value = Intends[item as keyof typeof Intends];
            if (value === undefined) {
                this.bot.logger.warn(`无效的意图(${item})，已跳过...`);
                return result;
            }
            return value | result;
        }, 0);
    }

    start(): Promise<void> {
        if (this.stopPromise) return this.stopPromise.then(() => this.start());
        if (this.startPromise) return this.startPromise;

        const generation = ++this.lifecycleGeneration;
        this.userClose = false;
        const receiver: BaseReceiver = this.receiver;
        const startup = new Promise<void>((resolve, reject) => {
            let settled = false;

            const cleanup = () => {
                receiver.off('ready', onReady);
                receiver.off('error', onError);
                receiver.off('close', onClose);
                if (this.rejectStart === onError) this.rejectStart = undefined;
            };

            const onReady = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
            };

            const onError = (error: Error) => {
                if (settled) return;
                settled = true;
                cleanup();
                this.userClose = true;
                this.lifecycleGeneration++;
                this.authManager.clearAuth();
                // 先标记关闭，防止 close 事件触发新的连接尝试。
                // 此时尚未就绪，直接回收接收器，保留连接管理器的可重试状态。
                void this.stopReceiver().catch(stopError => {
                    this.bot.logger.error("[SESSION] 启动失败后的接收器清理失败:", stopError);
                });
                reject(error);
            };

            const onClose = (code?: number, reason?: string) => {
                const detail = [code, reason].filter(value => value !== undefined && value !== '').join(': ');
                onError(new Error(`接收器在启动就绪前关闭${detail ? ` (${detail})` : ''}`));
            };

            this.rejectStart = onError;
            receiver.once('ready', onReady);
            // 在常驻处理器之前终止启动，避免失败期间进入自动重连。
            receiver.prependOnceListener('error', onError);
            receiver.prependOnceListener('close', onClose);

            void (async () => {
                try {
                    await this.receiverStopPromise;
                    if (settled || generation !== this.lifecycleGeneration) return;
                    await this.getAccessToken();
                    if (settled || generation !== this.lifecycleGeneration) return;
                    await receiver.start(this);
                } catch (error) {
                    onError(error instanceof Error ? error : new Error(String(error)));
                }
            })();
        });

        this.startPromise = startup;
        const clearStartup = () => {
            if (this.startPromise === startup) this.startPromise = undefined;
        };
        void startup.then(clearStartup, clearStartup);
        return startup;
    }

    private stopReceiver(): Promise<void> {
        if (this.receiverStopPromise) return this.receiverStopPromise;
        const receiver: BaseReceiver = this.receiver;
        const stopping = Promise.resolve().then(() => receiver.stop(this));
        this.receiverStopPromise = stopping;
        const clearStopping = () => {
            if (this.receiverStopPromise === stopping) this.receiverStopPromise = undefined;
        };
        void stopping.then(clearStopping, clearStopping);
        return stopping;
    }

    stop(): Promise<void> {
        if (this.stopPromise) return this.stopPromise;
        this.userClose = true;
        this.lifecycleGeneration++;
        this.authManager.clearAuth();
        this._wsUrl = '';
        this.rejectStart?.(new Error('机器人启动已停止'));

        const stopping = Promise.all([
            this.connectionManager.disconnect(),
            this.stopReceiver()
        ]).then(() => undefined);
        this.stopPromise = stopping;
        const clearStopping = () => {
            if (this.stopPromise === stopping) this.stopPromise = undefined;
        };
        void stopping.then(clearStopping, clearStopping);
        return stopping;
    }

    /**
     * 更新会话记录（用于WebSocket接收器）
     */
    public updateSessionRecord(record: { sessionID?: string; seq?: number }): void {
        this.connectionManager.updateSessionRecord(record);
    }

}
