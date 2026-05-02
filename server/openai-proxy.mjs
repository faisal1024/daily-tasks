import http from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["milestones", "todaySuggestions", "taskPool"],
  properties: {
    milestones: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "description", "completedAt"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          completedAt: { type: ["string", "null"] },
        },
      },
    },
    todaySuggestions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: generatedTaskSchema(),
    },
    taskPool: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: generatedTaskSchema(),
    },
  },
};

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/momentum/plan") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (!OPENAI_API_KEY) {
    sendJson(res, 500, { error: "OPENAI_API_KEY is not configured" });
    return;
  }

  try {
    const payload = await readJson(req);
    const validationError = validatePayload(payload);
    if (validationError) {
      sendJson(res, 400, { error: validationError });
      return;
    }

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        input: [
          {
            role: "system",
            content:
              "You generate calm, concrete daily momentum plans. Never create a backlog. Never use shame, guilt, urgency, streak pressure, medical advice, financial advice, or unsafe instructions. Keep every task achievable today.",
          },
          {
            role: "user",
            content: buildPrompt(payload),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "momentum_plan",
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      }),
    });

    const data = await openAiResponse.json();
    if (!openAiResponse.ok) {
      console.error("[momentum-ai] OpenAI error", data);
      sendJson(res, 502, { error: "OpenAI request failed" });
      return;
    }

    const text = extractOutputText(data);
    if (!text) {
      console.error("[momentum-ai] Missing structured output", data);
      sendJson(res, 502, { error: "OpenAI response did not include a plan" });
      return;
    }

    sendJson(res, 200, JSON.parse(text));
  } catch (error) {
    console.error("[momentum-ai] Proxy error", error);
    sendJson(res, 500, { error: "Momentum AI proxy failed" });
  }
});

server.listen(PORT, () => {
  console.log(`Momentum AI proxy listening on http://localhost:${PORT}/api/momentum/plan`);
});

function generatedTaskSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "text", "estimatedMinutes", "difficulty", "reason", "source"],
    properties: {
      id: { type: "string" },
      text: { type: "string" },
      estimatedMinutes: { type: "integer", minimum: 5, maximum: 60 },
      difficulty: { type: "string", enum: ["easy", "medium", "stretch"] },
      reason: { type: "string" },
      source: { type: "string", enum: ["ai"] },
    },
  };
}

function buildPrompt(payload) {
  return [
    "Create a Momentum plan for a daily app limited to exactly three tasks per day.",
    `Goal: ${payload.profile.goalTitle}`,
    `Time available: ${payload.profile.timeAvailability}`,
    `Experience level: ${payload.profile.experienceLevel}`,
    `Main struggle: ${payload.profile.struggleType}`,
    `Suggestion tone: ${payload.settings.suggestionTone}`,
    `Adaptive planning enabled: ${payload.settings.adaptivePlanning}`,
    `Recent completion: ${payload.recentPerformance.completed}/${payload.recentPerformance.total} tasks across ${payload.recentPerformance.daysReviewed} active days`,
    `Recent missed tasks: ${payload.recentPerformance.missed}`,
    `Recent reflection: ${payload.recentReflection ?? "none"}`,
    `Recent reflection result: ${payload.recentReflectionResult ?? "none"}`,
    "Return three milestones and exactly three todaySuggestions.",
    "Tasks must be short verb phrases, 64 characters or fewer, specific enough to do today, and sized to the user's time.",
    "If recent completion is weak, make tasks easier. If recent completion is strong, make tasks a gentle step up.",
  ].join("\n");
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") return "Invalid JSON payload";
  const { profile, settings, recentPerformance } = payload;
  if (!profile || typeof profile.goalTitle !== "string") return "Missing profile";
  if (!settings || typeof settings.suggestionTone !== "string") return "Missing settings";
  if (!recentPerformance || typeof recentPerformance.completed !== "number") {
    return "Missing recent performance";
  }
  return null;
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 20_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
