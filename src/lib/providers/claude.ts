import { resolveClaudeModel } from '../config';
import { runCommand } from './command';
import { AIProvider, ProviderInvokeRequest, ProviderInvokeResult } from './types';

export class ClaudeProvider implements AIProvider {
    name = 'anthropic';

    constructor(private readonly envOverrides: Record<string, string> = {}) { }

    async invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
        const continueConversation = !request.resetConversation;
        const modelId = resolveClaudeModel(request.model || '');
        const claudeArgs = ['--dangerously-skip-permissions'];

        if (modelId) claudeArgs.push('--model', modelId);
        if (continueConversation) claudeArgs.push('-c');

        const prompt = request.systemPrompt
            ? `${request.systemPrompt}\n\n------\n\n${request.prompt}`
            : request.prompt;
        claudeArgs.push('-p', prompt);

        const text = await runCommand('claude', claudeArgs, request.workingDirectory, this.envOverrides);
        return { text };
    }
}
