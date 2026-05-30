import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROVIDER_ID,
  PROVIDER_IDS,
  getProvider,
} from "../server/providers/index.mjs";

const REQUIRED_METHODS = [
  "isConfigured",
  "missingConfigMessage",
  "describe",
  "generatePlan",
] as const;

describe("AI provider registry", () => {
  it("registers the known providers", () => {
    expect(PROVIDER_IDS).toContain("openai");
    expect(PROVIDER_IDS).toContain("anthropic");
  });

  it("defaults to openai", () => {
    expect(getProvider().id).toBe(DEFAULT_PROVIDER_ID);
    expect(getProvider().id).toBe("openai");
  });

  it("resolves providers case-insensitively", () => {
    expect(getProvider("anthropic").id).toBe("anthropic");
    expect(getProvider("ANTHROPIC").id).toBe("anthropic");
  });

  it("throws a helpful error for an unknown provider", () => {
    expect(() => getProvider("gemini")).toThrowError(/Unknown MOMENTUM_AI_PROVIDER/);
    expect(() => getProvider("gemini")).toThrowError(/openai, anthropic/);
  });

  it("every provider implements the common interface", () => {
    for (const id of PROVIDER_IDS) {
      const provider = getProvider(id);
      expect(provider.id).toBe(id);
      for (const method of REQUIRED_METHODS) {
        expect(typeof provider[method]).toBe("function");
      }
      // describe() must work without any API key configured.
      expect(typeof provider.describe()).toBe("string");
      expect(typeof provider.isConfigured()).toBe("boolean");
    }
  });
});
