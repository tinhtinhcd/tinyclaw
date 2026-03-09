import { resolveCodexModel } from '../config';
import { runCommand } from './command';
import { AIProvider, ProviderInvokeRequest, ProviderInvokeResult } from './types';

export class CodexProvider implements AIProvider {
    name = 'openai';

    constructor(private readonly envOverrides: Record<string, string> = {}) { }

    async invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
        const shouldResume = !request.resetConversation;
        const modelId = resolveCodexModel(request.model || '');
        const codexArgs = ['exec'];

        if (shouldResume) codexArgs.push('resume', '--last');
        if (modelId) codexArgs.push('--model', modelId);

        const prompt = request.systemPrompt
            ? `${request.systemPrompt}\n\n------\n\n${request.prompt}`
            : request.prompt;
        codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', prompt);

        const output = await runCommand('codex', codexArgs, request.workingDirectory, this.envOverrides);

        let response = '';
        const lines = output.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                    response = json.item.text;
                }
            } catch {
                // ignore non-json line
            }
        }

        return { text: response || 'Sorry, I could not generate a response from Codex.', raw: output };
    }
}
