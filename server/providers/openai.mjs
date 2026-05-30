// OpenAI provider adapter.
//
// Implements the provider interface consumed by momentum-proxy.mjs:
//   id, isConfigured(), missingConfigMessage(), describe(),
//   generatePlan({ system, user, schema }) -> Promise<object>

export const id = "openai";

const DEFAULT_MODEL = "gpt-4o-mini";

function model() {
  return process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
}

export function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function missingConfigMessage() {
  return "OPENAI_API_KEY is not configured";
}

export function describe() {
  return `openai:${model()}`;
}

export async function generatePlan({ system, user, schema }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model(),
      temperature: 0.4,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "momentum_plan",
          strict: true,
          schema,
        },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const detail = data?.error?.message ?? "request failed";
    throw new Error(`OpenAI ${response.status}: ${detail}`);
  }

  const text = extractOutputText(data);
  if (!text) {
    throw new Error("OpenAI response did not include structured output");
  }

  return JSON.parse(text);
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return null;
}
