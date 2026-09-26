// Momentum AI proxy — provider-agnostic.
//
// The mobile app never holds an API key; it POSTs a minimal payload here and
// this server forwards it to whichever AI backend is configured. The provider
// is selected with one env var:
//
//   MOMENTUM_AI_PROVIDER=openai     (default)
//   MOMENTUM_AI_PROVIDER=anthropic
//
// Adding a provider does not touch this file — see server/providers/index.mjs.

import { loadLocalEnv } from "./load-env.mjs";
import { PLAN_ROUTE, createProxyServer, readConfig } from "./app.mjs";
import { DEFAULT_PROVIDER_ID, getProvider } from "./providers/index.mjs";

// Pick up .env.local / .env for local dev before reading any config.
loadLocalEnv();

const config = readConfig(process.env);
const providerName = config.providerName ?? DEFAULT_PROVIDER_ID;

let provider;
try {
  provider = getProvider(providerName);
} catch (error) {
  console.error(`[momentum-ai] ${error.message}`);
  process.exit(1);
}

// Hosted deploys (Render sets RENDER=true) should always require the shared
// secret; without it the endpoint is open to anyone who finds the URL.
if (!config.sharedSecret && (process.env.RENDER || process.env.NODE_ENV === "production")) {
  console.warn(
    "[momentum-ai] WARNING: PROXY_SHARED_SECRET is not set; the AI endpoint is open to anyone.",
  );
}

createProxyServer({ provider, config }).listen(config.port, () => {
  console.log(
    `Momentum AI proxy listening on http://localhost:${config.port}${PLAN_ROUTE} (provider: ${provider.describe()})`,
  );
});
