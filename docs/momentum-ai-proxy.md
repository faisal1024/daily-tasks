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

## Local Setup (Claude)

1. Copy `.env.example` to **`.env.local`** (gitignored — never commit a real key).
2. Set:

   ```sh
   MOMENTUM_AI_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-sonnet-4-6        # cheap/fast: claude-haiku-4-5
   EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL=http://localhost:8787/api/momentum/plan
   ```

3. Start the proxy (auto-loads `.env.local`; prints the active provider + model):

   ```sh
   pnpm ai:proxy
   # → Momentum AI proxy listening on http://localhost:8787/... (provider: anthropic:claude-sonnet-4-6)
   ```

4. Start Expo (it also reads `.env.local`, so the proxy URL is picked up):

   ```sh
   pnpm ios
   ```

   For a physical iPhone, replace `localhost` with your Mac's LAN IP in `EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL`.

Once the proxy URL is set, the app **auto-generates the plan with AI** (once per
day per goal) and also on demand via Settings → "Refresh with AI". With no proxy
URL configured, the app silently uses the local template plan.

### Smoke test without the app

```sh
curl -s -X POST http://localhost:8787/api/momentum/plan \
  -H "Content-Type: application/json" \
  -d '{"profile":{"goalTitle":"Run a 5K","timeAvailability":"30_min","experienceLevel":"beginner","struggleType":"consistency"},
       "settings":{"adaptivePlanning":true,"eveningReflection":true,"suggestionTone":"calm"},
       "recentPerformance":{"daysReviewed":0,"completed":0,"total":0,"missed":0,"completionRate":1}}'
```

## Deploying to production

The proxy is a single stateless Node HTTP server. Any host works; set the same
env vars there and store the key in the host's secret manager.

1. Deploy `server/` (entry: `server/momentum-proxy.mjs`, Node 18+).
   - **Render / Railway / Fly / a small VM:** run `node server/momentum-proxy.mjs`.
   - **Vercel/Cloudflare:** wrap the same handler in their function entrypoint
     (the request/response logic is standard `node:http`).
2. Set env in the host (NOT in the repo): `MOMENTUM_AI_PROVIDER=anthropic`,
   `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `CORS_ORIGIN=<app origin>`,
   `PROXY_SHARED_SECRET=<random>`, `RATE_LIMIT_PER_MIN` (optional, default 30).
3. Point the app build at it: set `EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL` to the
   deployed HTTPS URL (e.g. in EAS build env), then build.

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
- Set `CORS_ORIGIN` to the app's origin in production — do **not** ship `*`.
- Set `PROXY_SHARED_SECRET`; the app sends it as the `x-momentum-secret` header.
- The proxy applies a simple per-IP rate limit (`RATE_LIMIT_PER_MIN`, default 30);
  put it behind your host's rate limiting / app attestation for a paid feature.
