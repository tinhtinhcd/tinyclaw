# OpenRouter Provider Notes

## What changed

Added provider abstraction and OpenRouter support while preserving existing provider behavior.

### New files

- `src/lib/providers/types.ts`
- `src/lib/providers/index.ts`
- `src/lib/providers/command.ts`
- `src/lib/providers/claude.ts`
- `src/lib/providers/codex.ts`
- `src/lib/providers/opencode.ts`
- `src/lib/providers/openrouter.ts`
- `config/providers.example.json`
- `config/agents.example.json`

### Updated files

- `src/lib/invoke.ts`
- `src/lib/config.ts`
- `src/lib/types.ts`
- `src/queue-processor.ts`
- `src/server/routes/agents.ts`

## Provider abstraction

`invokeAgent()` now resolves runtime config and delegates to a provider instance via:

- `createProvider(providerName, context)` in `src/lib/providers/index.ts`
- `AIProvider.invoke(request)` in provider implementations

All providers return a normalized `ProviderInvokeResult` with `text` and optional `raw`/`usage`.

## OpenRouter provider

`src/lib/providers/openrouter.ts` uses OpenRouter's OpenAI-compatible API:

- Endpoint: `POST /chat/completions`
- API key: `OPENROUTER_API_KEY`
- Optional base URL override: `OPENROUTER_BASE_URL`
- Default base URL: `https://openrouter.ai/api/v1`

## Configuration model

Settings now support:

- `defaults.provider`
- `defaults.models[provider]`
- `defaults.providerOptions[provider]`
- `agentDefaults`
- `roleDefaults[role]`
- per-agent `provider`, `model`, `providerOptions`, `role`

Legacy `models.*` config is still supported and mapped into defaults when needed.

## Configuration Resolution Order

Runtime resolution for provider/model/options is:

1. agent explicit config
2. roleDefaults
3. defaults
4. env fallbacks

Specifically in `resolveAgentRuntimeConfig()`:

- provider: `agent.provider -> roleDefaults.provider -> agentDefaults.provider -> defaults.provider -> DEFAULT_PROVIDER -> anthropic`
- model: `agent.model -> roleDefaults.model -> agentDefaults.model -> defaults.models[provider] -> legacy models section -> provider env default`
- providerOptions: merged from `defaults.providerOptions[provider] -> agentDefaults.providerOptions -> roleDefaults.providerOptions -> agent.providerOptions`

## Required environment variables

For OpenRouter:

- `OPENROUTER_API_KEY` (required)
- `OPENROUTER_BASE_URL` (optional)

Optional provider/model fallback vars:

- `DEFAULT_PROVIDER`
- `OPENROUTER_DEFAULT_MODEL`
- `CLAUDE_DEFAULT_MODEL`
- `CODEX_DEFAULT_MODEL`
- `OPENCODE_DEFAULT_MODEL`

## Example OpenRouter agent config

```json
{
  "agents": {
    "coder": {
      "name": "Coder",
      "role": "coder",
      "provider": "openrouter",
      "model": "anthropic/claude-3.7-sonnet",
      "providerOptions": { "temperature": 0.1 },
      "working_directory": "coder"
    }
  }
}
```

## Future improvements

- Add typed validation for settings schema before runtime.
- Add retry/backoff policy per provider.
- Add token/cost tracking surfaced via SSE and API.
