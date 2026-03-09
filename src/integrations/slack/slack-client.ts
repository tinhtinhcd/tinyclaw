#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { App } from '@slack/bolt';
import { createSSEClient } from '../../channels/sse-client';
import { buildSlackQueuePayload } from './slack-router';
import { SlackReplyBridge } from './slack-reply';
import { ResolvedSlackBotConfig, resolveSlackConfig } from './slack-config';

const API_PORT = parseInt(process.env.TINYCLAW_API_PORT || '3777', 10);
const API_BASE = `http://localhost:${API_PORT}`;

const SCRIPT_DIR = path.resolve(__dirname, '..', '..', '..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
const TINYCLAW_HOME = process.env.TINYCLAW_HOME
    || (fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
        ? _localTinyclaw
        : path.join(require('os').homedir(), '.tinyclaw'));
const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/slack.log');

[path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}\n`;
    console.log(line.trim());
    fs.appendFileSync(LOG_FILE, line);
}

const slackConfig = resolveSlackConfig();
for (const warn of slackConfig.validationWarnings) {
    log('WARN', warn);
}
for (const err of slackConfig.validationErrors) {
    log('ERROR', err);
}
if (slackConfig.inboundBots.length === 0 || slackConfig.validationErrors.length > 0) {
    console.error('Slack startup aborted due to invalid bot configuration.');
    process.exit(1);
}
const defaultBot = slackConfig.defaultInboundBot || slackConfig.inboundBots[0]!;
const replyBridge = new SlackReplyBridge(defaultBot.botToken, API_BASE, log, slackConfig.roleTokenByAgentId);

async function enqueueSlackMessage(payload: ReturnType<typeof buildSlackQueuePayload>): Promise<void> {
    if (!payload) return;
    const res = await fetch(`${API_BASE}/api/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        throw new Error(`API enqueue failed with status ${res.status}`);
    }
    replyBridge.rememberThread(payload.messageId, {
        channelId: payload.sourceMetadata.channelId,
        threadTs: payload.sourceMetadata.threadTs,
    });
}

function attachHandlers(app: App, bot: ResolvedSlackBotConfig): void {
    app.event('message', async ({ event }) => {
        if (event.channel_type !== 'im') return;
        if ('subtype' in event && event.subtype) return;
        if (!('user' in event) || !event.user) return;
        if (!('text' in event) || !event.text) return;

        try {
            const payload = buildSlackQueuePayload({
                text: event.text,
                channelId: event.channel,
                userId: event.user,
                messageTs: event.ts,
                threadTs: event.thread_ts || event.ts,
                inboundBotId: bot.botId,
            });
            await enqueueSlackMessage(payload);
            log('INFO', `Queued Slack DM ${event.ts} via bot '${bot.botId}'`);
        } catch (err) {
            log('ERROR', `Slack DM handling failed (bot '${bot.botId}'): ${(err as Error).message}`);
        }
    });

    app.event('app_mention', async ({ event }) => {
        if (!event.user || !event.text) return;
        try {
            const payload = buildSlackQueuePayload({
                text: event.text,
                channelId: event.channel,
                userId: event.user,
                messageTs: event.ts,
                threadTs: event.thread_ts || event.ts,
                inboundBotId: bot.botId,
            });
            await enqueueSlackMessage(payload);
            log('INFO', `Queued Slack mention ${event.ts} via bot '${bot.botId}'`);
        } catch (err) {
            log('ERROR', `Slack mention handling failed (bot '${bot.botId}'): ${(err as Error).message}`);
        }
    });
}

createSSEClient({
    port: API_PORT,
    onEvent: (eventType, data) => {
        if (eventType === 'response_ready' && data.channel === 'slack') {
            replyBridge.processOutgoingQueue().catch((err) => {
                log('ERROR', `Slack outgoing queue check failed: ${(err as Error).message}`);
            });
        }
    },
    onConnect: () => {
        log('INFO', 'Slack client SSE connected');
        replyBridge.processOutgoingQueue().catch((err) => {
            log('ERROR', `Slack initial outgoing queue check failed: ${(err as Error).message}`);
        });
    },
});

replyBridge.start(API_PORT).catch((err) => {
    log('ERROR', `Failed to start Slack reply bridge: ${(err as Error).message}`);
});

async function main(): Promise<void> {
    const apps: App[] = [];
    for (const bot of slackConfig.inboundBots) {
        const app = new App({
            token: bot.botToken,
            appToken: bot.appToken,
            signingSecret: bot.signingSecret,
            socketMode: true,
        });
        attachHandlers(app, bot);
        await app.start();
        apps.push(app);
        log('INFO', `Slack bot '${bot.botId}' started (Socket Mode inbound)`);
    }
    log('INFO', `Slack multi-bot client started (${apps.length} bot app(s))`);
}

main().catch((err) => {
    log('ERROR', `Slack startup failed: ${(err as Error).message}`);
    process.exit(1);
});
