// Anthropic (Claude) provider adapter.
//
// Uses tool-use for reliable structured output: the JSON schema is passed as a
// tool input_schema and the model is forced to call it, so `tool_use.input` is
// already a validated object matching the contract.
//
// Implements the provider interface consumed by momentum-proxy.mjs.

import { PLAN_TOOL_DESCRIPTION, PLAN_TOOL_NAME } from "./plan-contract.mjs";

export const id = "anthropic";

// Haiku 5.5: the cheapest current model, and strong at short structured task
// generation. Override with ANTHROPIC_MODEL (e.g. a Sonnet for higher-stakes
// reasoning). Prompt caching below kicks in above the model's minimum cacheable
// prefix (512 tokens on Haiku 5.5, 4096 on Haiku 4.5): shorter prefixes are
// simply not cached, with no error.
const DEFAULT_MODEL = "claude-haiku-5-5";

// Output cap when a route doesn't set its own (`maxTokens`). Sized for the
// newer tokenizer (Haiku 5.5 and later count about 30% more tokens for the same
// text than Haiku 4.5 did): the old cap of 1500 with that headroom and a margin.
const DEFAULT_MAX_TOKENS = 2200;

// Older models take a sampling temperature; Haiku 5.5 and later reject any
// value but the default with a 400, so it is only sent to the models that
// were tuned with it.
const LEGACY_TEMPERATURE = 0.4;
export function acceptsTemperature(modelId) {
  return /^claude-(3|haiku-4|sonnet-4|opus-4-[0-6](?!\d))/.test(String(modelId ?? ""));
}

function model() {
  return process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
}

export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function missingConfigMessage() {
  return "ANTHROPIC_API_KEY is not configured";
}

export function describe() {
  return `anthropic:${model()}`;
}

/**
 * Generate structured output for any route. `toolName`/`toolDescription` name
 * the forced tool call; they default to the plan tool for backward compatibility.
 * `maxTokens` caps the output for routes with short answers.
 */
export async function generatePlan({
  system,
  user,
  schema,
  toolName = PLAN_TOOL_NAME,
  toolDescription = PLAN_TOOL_DESCRIPTION,
  maxTokens = DEFAULT_MAX_TOKENS,
}) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model(),
      max_tokens: maxTokens,
      ...(acceptsTemperature(model()) ? { temperature: LEGACY_TEMPERATURE } : {}),
      // System + tools are identical across every request, so cache that stable
      // prefix; the dynamic per-user content lives in the (uncached) user message.
      // The breakpoint on the system block caches tools + system together.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      tools: [
        {
          name: toolName,
          description: toolDescription,
          input_schema: schema,
        },
      ],
      tool_choice: { type: "tool", name: toolName },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const detail = data?.error?.message ?? "request failed";
    throw new Error(`Anthropic ${response.status}: ${detail}`);
  }

  // A safety refusal, or an answer cut off at the cap, has no usable tool call:
  // say which, so the logs show why the route fell back.
  if (data.stop_reason === "refusal") {
    throw new Error("Anthropic declined the request (stop_reason: refusal)");
  }
  if (data.stop_reason === "max_tokens") {
    throw new Error(`Anthropic response was cut off at max_tokens (${maxTokens})`);
  }

  const toolUse = (data.content ?? []).find(
    (block) => block.type === "tool_use" && block.name === toolName,
  );
  if (!toolUse || typeof toolUse.input !== "object") {
    throw new Error(`Anthropic response did not include the ${toolName} tool call`);
  }

  return toolUse.input;
}
