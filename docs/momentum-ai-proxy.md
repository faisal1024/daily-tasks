# Momentum AI Proxy

The iOS app must not contain an OpenAI API key. AI planning goes through a tiny server-side proxy in `server/openai-proxy.mjs`.

## Local Setup

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY` in the shell that runs the proxy.
3. Start the proxy:

```sh
pnpm ai:proxy
```

4. Start Expo with the proxy URL exposed to the app:

```sh
EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL=http://localhost:8787/api/momentum/plan pnpm ios
```

For a physical iPhone, replace `localhost` with your Mac's local network IP address.

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
- Store `OPENAI_API_KEY` only in the hosting provider's secret manager.
- Set `EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL` to the production HTTPS endpoint for EAS builds.
- Add rate limiting before public launch.
- Add authentication or app attestation before making AI a paid feature.
