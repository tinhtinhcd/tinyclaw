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

function normalizeInlineSlackMentions(text: string): string {
    // Slack may send mentions as <@U12345> or <@U12345|display_name>.
    // Convert to @token form so mention routing can parse explicit mentions.
    return text
        .replace(/<@([A-Z0-9]+)\|([^>]+)>/gi, (_match, _id: string, label: string) => `@${label}`)
        .replace(/<@([A-Z0-9]+)>/gi, (_match, id: string) => `@${id}`);
}

export function normalizeSlackMessageText(input: string): string {
    const withoutLeadingAppMention = stripLeadingAppMention(input || '');
    return normalizeInlineSlackMentions(withoutLeadingAppMention);
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
