import { resolveOpenCodeModel } from '../config';
import { runCommand } from './command';
import { AIProvider, ProviderInvokeRequest, ProviderInvokeResult } from './types';

export class OpenCodeProvider implements AIProvider {
    name = 'opencode';

    constructor(private readonly envOverrides: Record<string, string> = {}) { }

    async invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
        const continueConversation = !request.resetConversation;
        const modelId = resolveOpenCodeModel(request.model || '');

        const opencodeArgs = ['run', '--format', 'json'];
        if (modelId) opencodeArgs.push('--model', modelId);
        if (continueConversation) opencodeArgs.push('-c');

        const prompt = request.systemPrompt
            ? `${request.systemPrompt}\n\n------\n\n${request.prompt}`
            : request.prompt;
        opencodeArgs.push(prompt);

        const output = await runCommand('opencode', opencodeArgs, request.workingDirectory, this.envOverrides);

        let response = '';
        const lines = output.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'text' && json.part?.text) {
                    response = json.part.text;
                }
            } catch {
                // ignore non-json line
            }
        }

        return { text: response || 'Sorry, I could not generate a response from OpenCode.', raw: output };
    }
}
