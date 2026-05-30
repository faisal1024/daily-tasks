// Anthropic (Claude) provider adapter.
//
// Uses tool-use for reliable structured output: the JSON schema is passed as a
// tool input_schema and the model is forced to call it, so `tool_use.input` is
// already a validated object matching the contract.
//
// Implements the provider interface consumed by momentum-proxy.mjs.

import { PLAN_TOOL_DESCRIPTION, PLAN_TOOL_NAME } from "./plan-contract.mjs";

export const id = "anthropic";

// Override with ANTHROPIC_MODEL. Per the master plan: a stronger model for the
// one-time plan, a cheaper one (e.g. claude-haiku-4-5) once a separate /daily
// endpoint exists.
const DEFAULT_MODEL = "claude-sonnet-4-6";

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

export async function generatePlan({ system, user, schema }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model(),
      max_tokens: 1500,
      temperature: 0.4,
      system,
      messages: [{ role: "user", content: user }],
      tools: [
        {
          name: PLAN_TOOL_NAME,
          description: PLAN_TOOL_DESCRIPTION,
          input_schema: schema,
        },
      ],
      tool_choice: { type: "tool", name: PLAN_TOOL_NAME },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const detail = data?.error?.message ?? "request failed";
    throw new Error(`Anthropic ${response.status}: ${detail}`);
  }

  const toolUse = (data.content ?? []).find(
    (block) => block.type === "tool_use" && block.name === PLAN_TOOL_NAME,
  );
  if (!toolUse || typeof toolUse.input !== "object") {
    throw new Error("Anthropic response did not include the plan tool call");
  }

  return toolUse.input;
}
