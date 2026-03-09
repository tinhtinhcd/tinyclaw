import { Settings } from '../types';

export type ProviderInvokeRequest = {
    prompt: string;
    systemPrompt?: string;
    workingDirectory?: string;
    model?: string;
    conversationId?: string;
    resetConversation?: boolean;
    metadata?: Record<string, unknown>;
    providerOptions?: Record<string, unknown>;
};

export type ProviderInvokeResult = {
    text: string;
    raw?: unknown;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
};

export interface AIProvider {
    name: string;
    invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult>;
}

export interface ProviderFactoryContext {
    settings: Settings;
    agentId: string;
}
