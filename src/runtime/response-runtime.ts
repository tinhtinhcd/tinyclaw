import { collectFiles, handleLongResponse } from '../lib/response';
import { enqueueResponse } from '../lib/db';
import { runOutgoingHooks } from '../lib/plugins';
import { emitEvent } from '../lib/logging';

export async function enqueueDirectResponse(params: {
    response: string;
    channel: string;
    sender: string;
    senderId?: string;
    rawMessage: string;
    messageId: string;
    agentId: string;
    linkedTaskId?: string;
    runOutgoingHooksFn?: typeof runOutgoingHooks;
    log: (level: string, msg: string) => void;
}): Promise<void> {
    let finalResponse = params.response.trim();

    const outboundFilesSet = new Set<string>();
    collectFiles(finalResponse, outboundFilesSet);
    const outboundFiles = Array.from(outboundFilesSet);
    if (outboundFiles.length > 0) {
        finalResponse = finalResponse.replace(/\[send_file:\s*[^\]]+\]/g, '').trim();
    }

    const outgoingHooksFn = params.runOutgoingHooksFn || runOutgoingHooks;
    const { text: hookedResponse, metadata } = await outgoingHooksFn(finalResponse, {
        channel: params.channel,
        sender: params.sender,
        messageId: params.messageId,
        originalMessage: params.rawMessage,
    });

    const { message: responseMessage, files: allFiles } = handleLongResponse(hookedResponse, outboundFiles);
    enqueueResponse({
        channel: params.channel,
        sender: params.sender,
        senderId: params.senderId,
        message: responseMessage,
        originalMessage: params.rawMessage,
        messageId: params.messageId,
        agent: params.agentId,
        files: allFiles.length > 0 ? allFiles : undefined,
        metadata: {
            ...metadata,
            agentId: params.agentId,
            ...(params.linkedTaskId ? { taskId: params.linkedTaskId } : {}),
        },
    });

    params.log('INFO', `✓ Response ready [${params.channel}] ${params.sender} via agent:${params.agentId} (${finalResponse.length} chars)`);
    emitEvent('response_ready', {
        channel: params.channel,
        sender: params.sender,
        agentId: params.agentId,
        responseLength: finalResponse.length,
        responseText: finalResponse,
        messageId: params.messageId,
    });
}

