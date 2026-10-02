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

### Render (one blueprint, ~3 clicks)

A `render.yaml` blueprint is included.

1. Push the repo to GitHub (done).
2. render.com → **New → Blueprint** → connect this repo. It reads `render.yaml`
   and creates the `momentum-ai-proxy` web service.
3. In the service's **Environment**, set `ANTHROPIC_API_KEY` (marked `sync: false`,
   so it's never in git). The other vars come from the blueprint.
4. Deploy. The public URL is `https://momentum-ai-proxy.onrender.com` (or similar);
   the app's endpoint is that URL + `/api/momentum/plan`. Verify with
   `curl https://<your-service>.onrender.com/health` → `{"ok":true,...}`.

Note: Render's free plan sleeps on idle, so the first request after a quiet
period has a cold-start delay. Use a paid instance to avoid that.

### Cloudflare Workers (live from 1.3.0: free, no cold starts)

Deployed 2026-10-02 at `https://three-today-ai.faisal1024.workers.dev`, with
`ANTHROPIC_API_KEY` (a workspace-scoped key: an unscoped org key fails with
"must include the anthropic-workspace-id header"), `PROXY_SHARED_SECRET` (same as
Render) and `REVENUECAT_SECRET_KEY` set as secrets. 1.3.0 is the first build that
calls it; Render stays up for older builds.

`server/worker.mjs` runs the same routes as the Node server (both use
`server/handler.mjs`). Limits live in one Durable Object (`Limits`): per-minute
counts in memory, daily counts in its storage (they survive restarts).

**First deploy** (free Cloudflare account needed), from the repo:

```sh
cd server
npx wrangler@4 login
npx wrangler@4 deploy            # first time: pick a workers.dev subdomain when asked
npx wrangler@4 secret put ANTHROPIC_API_KEY      # console.anthropic.com → API keys
npx wrangler@4 secret put PROXY_SHARED_SECRET    # the SAME value as on Render and as EAS EXPO_PUBLIC_MOMENTUM_PROXY_SECRET
curl https://three-today-ai.<your-subdomain>.workers.dev/health   # expect {"ok":true,"provider":"anthropic","entitlements":"off"}
npx wrangler@4 tail              # live logs (also in the dashboard: observability is on)
```

**Settings live in `server/wrangler.toml`.** Change them there and run
`npx wrangler@4 deploy` again. A value changed only in the Cloudflare dashboard
is overwritten by the next deploy.

**Moving the app over (keep Render running):**
1. In EAS, set the proxy URL for the next build:
   `eas env:create --name EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL --environment production --visibility plaintext --value https://three-today-ai.<your-subdomain>.workers.dev/api/momentum/plan`
2. Build, test on TestFlight, then release that version on the App Store.
3. **Keep Render running.** Every build already on people's phones still
   calls Render. Only when Render's logs show almost no traffic (most people
   have updated) suspend the Render service. Suspend, don't delete, so it can
   be switched back on.

Local try-out without an account: `cd server && npx wrangler@4 dev --local`.
The client IP comes from `CF-Connecting-IP` (no `TRUST_PROXY_HOPS` needed).

### Plus check (all hosts)

The app (paywall builds) sends RevenueCat's anonymous app user id as
`x-rc-user`. The server asks RevenueCat whether Plus is active and caches the
answer (Plus: 1 hour; not Plus: 1 minute, and Plus routes always re-check a
"not Plus" answer so a new subscriber is never refused). Plan, break-down,
evening and coach-note are Plus-only (**402** when refused); brain dumps stay open to free
users up to `FREE_BRAIN_DUMPS_PER_DAY` per user (and 3× that per network).
If RevenueCat can't answer (down, rate-limited, or our key is wrong) requests
are allowed for a moment and a warning is logged: paying users are never
locked out by an outage.

Requests **without** an id (older app versions, and early supporters before
their grant, below) are allowed, share one daily ceiling (`NO_ID_DAILY_LIMIT`,
250), and are counted in the logs as "without an app user id".
**Until `ENTITLEMENT_REQUIRE_ID=1`, `enforce` only refuses requests that carry
a non-Plus id**: a client that leaves the id out is limited only by the
per-network, no-id and global caps.

**Early supporters** have Plus for free on their device but not in RevenueCat.
On a paywall build their install asks the proxy once
(`POST /api/momentum/grandfather`, needs the shared secret) to grant it a
lifetime promotional Plus in RevenueCat; after that it sends its id. The
proxy only grants while `GRANDFATHER_GRANTS_UNTIL` (a date, e.g. `2026-12-31`)
is in the future, at most 3 per network per day. Keep the window open for a
few weeks after the paywall release, then let it close. Trade-off: the server
can't prove a caller was an early supporter (the shared secret ships in the
app), so while the window is open someone who extracts it could claim Plus
for made-up ids, a few per network per day. A short window keeps that small.

**Don't set `ENTITLEMENT_REQUIRE_ID=1` until** the grant window has closed and
the "without an app user id" count in the logs is close to zero; setting it
earlier refuses supporters who haven't updated yet.

**Turning it on, step by step:**
0. With the paywall release, set `GRANDFATHER_GRANTS_UNTIL` a few weeks out
   (a key is needed for grants; step 1).
1. RevenueCat → Project settings → API keys → create a **V1 secret key**
   (starts `sk_`). Set it on the host: Render dashboard `REVENUECAT_SECRET_KEY`,
   or `npx wrangler@4 secret put REVENUECAT_SECRET_KEY`.
   (With a mode set but no key, the check stays off and a warning is logged.)
2. App Store Connect → App → App Information → App Store Server Notifications:
   paste RevenueCat's URL (RevenueCat → App settings → Apple Server
   Notifications), so renewals reach RevenueCat right away.
3. Set `ENTITLEMENT_MODE=log` and deploy. Watch the logs for about a week:
   "from an id without Plus on a Plus route" should be close to zero, and
   `/health` should say `"entitlements":"log"`.
4. Set `ENTITLEMENT_MODE=enforce` and deploy. If support messages or 402s
   jump, set it back to `log`.

### Cost guard (Anthropic)

In console.anthropic.com → Settings → Limits, set a monthly spend limit and
email alerts at 50% and 80%. `GLOBAL_DAILY_LIMIT` (500 by default here, about
$2/day on Haiku) keeps one bad day from using the whole month; that's roughly
100–150 active users, so raise it as usage grows (about $0.004 per call).
`DAILY_LIMIT_PER_CLIENT` (40) means a handful of networks can't use it all. If the provider
refuses for credit or quota, the app gets the calm "taking a break for today"
message.

### Any other host

1. Deploy `server/` (entry: `server/momentum-proxy.mjs`, Node 18+).
   - **Render / Railway / Fly / a small VM:** run `node server/momentum-proxy.mjs`.
   - **Vercel/Cloudflare:** wrap the same handler in their function entrypoint
     (the request/response logic is standard `node:http`).
2. Set env in the host (NOT in the repo): `MOMENTUM_AI_PROVIDER=anthropic`,
   `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `CORS_ORIGIN=<app origin>`,
   `PROXY_SHARED_SECRET=<random>`, and optionally the limits below.
3. Point the app build at it: set `EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL` to the
   deployed HTTPS URL and `EXPO_PUBLIC_MOMENTUM_PROXY_SECRET` to the same secret
   as EAS environment variables (not in `eas.json`), then build.

## Routes

All POST routes share the same auth (`x-momentum-secret`), rate limits and
daily budgets. The route table lives in `server/routes.mjs`; each route has a
payload validator, prompt, structured-output schema and response validator.

| Route | Payload | Returns |
|---|---|---|
| `/api/momentum/plan` | goal profile, recent performance, recent task titles, reflection | milestones, today's suggestions, task pool |
| `/api/momentum/brain-dump` | `text` (≤2000 chars), `openSlots` (1–3), `goalTitle?`, `agenda?` (≤12 strings ≤120 chars; also accepted by `/plan`) | `picks` (≤ openSlots), `parked` (≤10) |
| `/api/momentum/break-down` | `task` (≤120 chars), `goalTitle?` | `steps` (3–5 tiny steps) |
| `/api/momentum/evening` | `result` (easy/good/hard/missed), `tasks` (≤3 `{text, done}`), `note?`, `goalTitle?`, `memory?` (≤500) | `note` (≤160), `because` (≤100), `tomorrow` (1–3 tasks), `memory` (≤500, the coach's rolling summary) |
| `/api/momentum/coach-note` | `tasks` (1–3 strings ≤120 chars), `goalTitle?`, `tone?` (calm/friendly/direct) | `notes`: one `{start, momentum}` per task, in order (control characters become spaces; `""` where a line was empty, over 140 chars, or held a real link (`http(s)://`, `www.`) or an email: dropped whole, never spliced; `README.md` / `Node.js` are kept) |

The app derives sibling route URLs from `EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL`
(which points at `/plan`). Brain dump falls back to a simple on-device split
when the proxy is unreachable; break-down has no offline fallback. The coach's
note falls back to built-in lines on any failure.

## Architecture

```
app  ──POST /api/momentum/plan──▶  app.mjs (via momentum-proxy.mjs)  ──▶  provider adapter  ──▶  AI API
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
- The user's own recent task texts (last ~12, with done/skipped) so suggestions
  build on what they actually chose.

The app sends recent task text (last few days) but not the full history, and no
account/PII. This is the minimum needed for the AI to tailor suggestions to the
user's own tasks.

## Production Notes

- Deploy the proxy to a serverless host or small Node server before shipping AI.
- Store the provider key only in the hosting provider's secret manager.
- Set `EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL` to the production HTTPS endpoint for EAS builds.
- Set `CORS_ORIGIN` to the app's origin in production — do **not** ship `*`.
- Set `PROXY_SHARED_SECRET`; the app sends it as the `x-momentum-secret` header
  (compared in constant time). The server logs a warning on Render if it's unset.
  The secret ships inside the app binary, so treat it as a speed bump, not auth.
- **Rollout order** (so live builds don't lose AI suggestions):
  1. Add `EXPO_PUBLIC_MOMENTUM_PROXY_SECRET` as an EAS environment variable for
     **every** environment the build profiles use (production, preview, and the
     `simulator` profile), then ship a build that sends it.
  2. Set `PROXY_SHARED_SECRET` on Render with `SECRET_MODE=log`: requests without
     the header still work and each one is logged.
  3. When those log lines are rare (most active users updated), set
     `SECRET_MODE=enforce`. Builds without the header then get 401: builds from
     this change onward say "Smart suggestions need the latest version of the
     app."; older builds (1.0.1, 1.0.10) silently keep built-in suggestions.
- **Verify the client IP once per host** before trusting per-client limits: set
  `DEBUG_CLIENT_IP=1`, call
  `curl -H "x-momentum-secret: $SECRET" https://<host>/debug/client-ip` from your
  own network, and check `resolvedClientIp` is your public IP. If it shows a
  Render/edge address, raise `TRUST_PROXY_HOPS` until it's correct. Then unset
  `DEBUG_CLIENT_IP`.
- Limits (0 disables one), fixed windows keyed on the client network (IP; IPv6
  by /64) and, when the app sends its id, on the user too:
  | Env var | Default | Response when hit |
  |---|---|---|
  | `RATE_LIMIT_PER_MIN` | 30 | 429, `Retry-After: 60` |
  | `DAILY_LIMIT_PER_CLIENT` | 200 in code; 40 in `render.yaml`/`wrangler.toml` | 429, `Retry-After: 3600` |
  | `GLOBAL_DAILY_LIMIT` | 5000 in code; 500 in `render.yaml`/`wrangler.toml` | 503 for everyone (spend circuit breaker) |
  | `FREE_BRAIN_DUMPS_PER_DAY` | 8 (0 = no free AI) | 402 "Free limit reached" (enforce only) |
  | `ENTITLEMENT_MODE` | off | `log` counts, `enforce` answers 402 on Plus routes |
  | `REVENUECAT_SECRET_KEY` | unset | needed for `log`/`enforce` (V1 secret key) |
  | `ENTITLEMENT_REQUIRE_ID` | unset | `1` = requests without an app user id count as free (see "Early supporters") |
  | `NO_ID_DAILY_LIMIT` | 250 | shared daily ceiling for requests without an id (enforce: 402) |
  | `GRANDFATHER_GRANTS_UNTIL` | unset (closed) | date until which early supporters can claim lifetime Plus |
- `TRUST_PROXY_HOPS` (default 0 = trust no forwarding header; Render needs 1) picks the client IP from the right of
  `X-Forwarded-For`, so a client can't dodge limits by sending its own header.
- Daily limits reset at **UTC midnight**, not the user's local midnight.
- Only requests that actually call the AI spend the daily/global budgets; bad
  payloads (400/413) only count toward the per-minute limit.
- Bodies over 20 KB get 413 and the connection is closed. Malformed AI output is logged by shape only (field
  names), never content, to keep user task titles out of logs.
- Still set an Anthropic console spend limit; the caps above bound request count,
  not token size.
- Server behaviour is covered end-to-end in `tests/proxy-server.test.ts`.
