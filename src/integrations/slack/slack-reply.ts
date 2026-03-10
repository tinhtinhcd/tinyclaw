import { WebClient } from '@slack/web-api';
import { createSSEClient } from '../../channels/sse-client';

interface ThreadContext {
    channelId: string;
    threadTs: string;
}

interface PendingResponse {
    id: number;
    messageId: string;
    message: string;
    sender?: string;
    agent?: string;
    metadata?: Record<string, unknown>;
}

function stageStatus(agentId: string, agentName?: string): string {
    const hay = `${agentId} ${agentName || ''}`.toLowerCase();
    if (hay.includes('ba') || hay.includes('business')) return 'BA is clarifying requirements';
    if (hay.includes('scrum') || hay.includes('pm') || hay.includes('product')) return 'Scrum Master is analyzing';
    if (hay.includes('architect') || hay.includes('design')) return 'Architect is designing';
    if (hay.includes('coder') || hay.includes('dev') || hay.includes('engineer')) return 'Coder is implementing';
    if (hay.includes('review')) return 'Reviewer is reviewing';
    if (hay.includes('test') || hay.includes('qa')) return 'Tester is testing';
    return `${agentName || agentId} is working`;
}

export class SlackReplyBridge {
    private readonly defaultWeb: WebClient;
    private readonly webByToken = new Map<string, WebClient>();
    private readonly apiBase: string;
    private readonly pendingThreads = new Map<string, ThreadContext>();
    private readonly postedStatuses = new Set<string>();
    private processing = false;

    constructor(
        slackBotToken: string,
        apiBase: string,
        private readonly log: (level: string, msg: string) => void,
        private readonly roleTokenByAgentId: Record<string, string> = {},
    ) {
        this.defaultWeb = new WebClient(slackBotToken);
        this.apiBase = apiBase;
    }

    rememberThread(messageId: string, thread: ThreadContext): void {
        this.pendingThreads.set(messageId, thread);
    }

    async start(apiPort: number): Promise<void> {
        createSSEClient({
            port: apiPort,
            onEvent: (eventType, data) => {
                if (eventType !== 'chain_step_start') return;
                if (data.channel !== 'slack') return;

                const messageId = typeof data.messageId === 'string' ? data.messageId : '';
                const agentId = typeof data.agentId === 'string' ? data.agentId : '';
                const agentName = typeof data.agentName === 'string' ? data.agentName : undefined;
                if (!messageId || !agentId) return;

                this.postStatus(messageId, stageStatus(agentId, agentName), agentId).catch((err) => {
                    this.log('ERROR', `Slack status post failed: ${(err as Error).message}`);
                });
            },
            onConnect: () => {
                this.log('INFO', 'Slack reply SSE connected');
                this.processOutgoingQueue().catch((err) => {
                    this.log('ERROR', `Slack initial response check failed: ${(err as Error).message}`);
                });
            },
        });
    }

    async processOutgoingQueue(): Promise<void> {
        if (this.processing) return;
        this.processing = true;
        try {
            const res = await fetch(`${this.apiBase}/api/responses/pending?channel=slack`);
            if (!res.ok) return;
            const responses = await res.json() as PendingResponse[];

            for (const resp of responses) {
                try {
                    const context = this.pendingThreads.get(resp.messageId);
                    if (!context) {
                        this.log('WARN', `Missing Slack thread context for ${resp.messageId}, acking`);
                        await this.ack(resp.id);
                        continue;
                    }

                    const responseAgentId = resp.agent
                        || (typeof resp.metadata?.agentId === 'string' ? resp.metadata.agentId : undefined);
                    const web = this.getClientForAgent(responseAgentId);

                    if (resp.message) {
                        await web.chat.postMessage({
                            channel: context.channelId,
                            thread_ts: context.threadTs,
                            text: resp.message,
                        });
                    }

                    await this.ack(resp.id);
                    this.pendingThreads.delete(resp.messageId);
                    this.log('INFO', `Posted Slack response for ${resp.messageId}`);
                } catch (err) {
                    this.log('ERROR', `Failed Slack response ${resp.id}: ${(err as Error).message}`);
                }
            }
        } finally {
            this.processing = false;
        }
    }

    private async postStatus(messageId: string, statusText: string, agentId: string): Promise<void> {
        const context = this.pendingThreads.get(messageId);
        if (!context) return;

        const statusKey = `${messageId}:${agentId}:${statusText}`;
        if (this.postedStatuses.has(statusKey)) return;
        this.postedStatuses.add(statusKey);

        const web = this.getClientForAgent(agentId);
        await web.chat.postMessage({
            channel: context.channelId,
            thread_ts: context.threadTs,
            text: statusText,
        });
    }

    private getClientForAgent(agentId?: string): WebClient {
        if (!agentId) return this.defaultWeb;
        const token = this.roleTokenByAgentId[agentId];
        if (!token) return this.defaultWeb;
        const existing = this.webByToken.get(token);
        if (existing) return existing;
        const web = new WebClient(token);
        this.webByToken.set(token, web);
        return web;
    }

    private async ack(responseId: number): Promise<void> {
        await fetch(`${this.apiBase}/api/responses/${responseId}/ack`, { method: 'POST' });
    }
}
