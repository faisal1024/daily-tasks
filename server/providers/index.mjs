// Provider registry. To add a new AI backend:
//   1. Create server/providers/<name>.mjs implementing the provider interface
//      (id, isConfigured, missingConfigMessage, describe, generatePlan).
//   2. Import it here and add it to PROVIDERS.
// Switching providers at runtime is then just MOMENTUM_AI_PROVIDER=<name>.

import * as anthropic from "./anthropic.mjs";
import * as openai from "./openai.mjs";

const PROVIDERS = {
  [openai.id]: openai,
  [anthropic.id]: anthropic,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export const DEFAULT_PROVIDER_ID = openai.id;

export function getProvider(name = DEFAULT_PROVIDER_ID) {
  const key = String(name).toLowerCase();
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(
      `Unknown MOMENTUM_AI_PROVIDER "${name}". Available providers: ${PROVIDER_IDS.join(", ")}.`,
    );
  }
  return provider;
}
