# Momentum AI Proxy

The mobile app must not contain an AI provider API key. AI planning goes through
a small server-side proxy (`server/momentum-proxy.mjs`) that is **provider-agnostic**:
the app always POSTs the same payload to the same URL, and the proxy forwards it
to whichever AI backend is configured.

## Switching the AI backend

Set one environment variable:

```sh
MOMENTUM_AI_PROVIDER=openai      # default
MOMENTUM_AI_PROVIDER=anthropic   # Claude
```

The app does not change and does not need rebuilding to switch providers — the
choice is entirely server-side.

## Local Setup

1. Copy `.env.example` to `.env`.
2. Choose a provider with `MOMENTUM_AI_PROVIDER` and set that provider's key:
   - OpenAI → `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`)
   - Anthropic → `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`)
3. Start the proxy (it prints the active provider + model on boot):

```sh
pnpm ai:proxy
```

4. Start Expo with the proxy URL exposed to the app:

```sh
EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL=http://localhost:8787/api/momentum/plan pnpm ios
```

For a physical iPhone, replace `localhost` with your Mac's local network IP.

## Architecture

```
app  ──POST /api/momentum/plan──▶  momentum-proxy.mjs  ──▶  provider adapter  ──▶  AI API
                                         │                        │
                                   shared contract          openai.mjs / anthropic.mjs
                                  (plan-contract.mjs)      (holds the key, talks to the API)
```

- `server/providers/plan-contract.mjs` — shared system prompt, user-prompt
  builder, JSON schema, and payload validation. Identical across providers.
- `server/providers/<name>.mjs` — one adapter per backend. Each exports the same
  interface: `id`, `isConfigured()`, `missingConfigMessage()`, `describe()`,
  and `generatePlan({ system, user, schema }) -> Promise<object>`.
- `server/providers/index.mjs` — the registry that maps `MOMENTUM_AI_PROVIDER`
  to an adapter.
- `server/momentum-proxy.mjs` — the generic HTTP server. It never references a
  specific provider.

### Adding a new provider

1. Create `server/providers/<name>.mjs` implementing the interface above
   (use `openai.mjs` / `anthropic.mjs` as templates). Structured output is
   recommended — OpenAI uses `json_schema`, Anthropic uses a forced tool call.
2. Import it in `server/providers/index.mjs` and add it to `PROVIDERS`.
3. Set `MOMENTUM_AI_PROVIDER=<name>` and the provider's key. No app changes.

## Request Shape

The app sends only:

- Active goal.
- Time availability.
- Experience level.
- Main struggle.
- Momentum settings.
- Recent completion summary.
- Latest reflection.

The app does not send full daily task history or private task text for AI planning.

## Production Notes

- Deploy the proxy to a serverless host or small Node server before shipping AI.
- Store the provider key only in the hosting provider's secret manager.
- Set `EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL` to the production HTTPS endpoint for EAS builds.
- Add rate limiting before public launch.
- Add authentication or app attestation before making AI a paid feature.
