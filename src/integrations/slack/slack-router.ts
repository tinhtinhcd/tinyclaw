export interface SlackInboundMessage {
    text: string;
    channelId: string;
    userId: string;
    messageTs: string;
    threadTs?: string;
    inboundBotId?: string;
}

export interface SlackQueuePayload {
    channel: 'slack';
    sender: string;
    senderId: string;
    message: string;
    messageId: string;
    source: 'slack';
    sourceMetadata: {
        channelId: string;
        threadTs: string;
        userId: string;
        messageTs: string;
        inboundBotId?: string;
    };
}

function stripLeadingAppMention(text: string): string {
    return text.replace(/^\s*<@[A-Z0-9]+>\s*/i, '').trim();
}

export function normalizeSlackMessageText(input: string): string {
    return stripLeadingAppMention(input || '');
}

export function buildSlackQueuePayload(event: SlackInboundMessage): SlackQueuePayload | null {
    const text = normalizeSlackMessageText(event.text);
    if (!text) return null;

    const messageId = `slack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const threadTs = event.threadTs || event.messageTs;

    return {
        channel: 'slack',
        sender: `slack:${event.userId}`,
        senderId: event.userId,
        message: text,
        messageId,
        source: 'slack',
        sourceMetadata: {
            channelId: event.channelId,
            threadTs,
            userId: event.userId,
            messageTs: event.messageTs,
            inboundBotId: event.inboundBotId,
        },
    };
}
