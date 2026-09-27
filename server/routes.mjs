// Route table for the Momentum AI proxy. Each POST route pairs a payload
// validator, a prompt, a structured-output schema/tool, and a response
// validator. server/app.mjs applies auth, rate limits and budgets to all of
// them the same way.

import {
  BRAIN_DUMP_SCHEMA,
  BRAIN_DUMP_SYSTEM_PROMPT,
  BRAIN_DUMP_TOOL_DESCRIPTION,
  BRAIN_DUMP_TOOL_NAME,
  BREAK_DOWN_SCHEMA,
  BREAK_DOWN_SYSTEM_PROMPT,
  BREAK_DOWN_TOOL_DESCRIPTION,
  BREAK_DOWN_TOOL_NAME,
  buildBrainDumpPrompt,
  buildBreakDownPrompt,
  isValidBrainDump,
  isValidBreakDown,
  sanitizeBrainDump,
  sanitizeBreakDown,
  validateBrainDumpPayload,
  validateBreakDownPayload,
} from "./providers/helpers-contract.mjs";
import {
  EVENING_SCHEMA,
  EVENING_SYSTEM_PROMPT,
  EVENING_TOOL_DESCRIPTION,
  EVENING_TOOL_NAME,
  buildEveningPrompt,
  isValidEvening,
  sanitizeEvening,
  validateEveningPayload,
} from "./providers/evening-contract.mjs";
import {
  PLAN_TOOL_DESCRIPTION,
  PLAN_TOOL_NAME,
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  buildPrompt,
  isValidPlan,
  sanitizePlan,
  validatePayload,
} from "./providers/plan-contract.mjs";

export const PLAN_ROUTE = "/api/momentum/plan";
export const BRAIN_DUMP_ROUTE = "/api/momentum/brain-dump";
export const BREAK_DOWN_ROUTE = "/api/momentum/break-down";
export const EVENING_ROUTE = "/api/momentum/evening";

export const ROUTES = {
  [PLAN_ROUTE]: {
    name: "plan",
    // Plus only (checked server-side when ENTITLEMENT_MODE is on).
    plusOnly: true,
    system: SYSTEM_PROMPT,
    buildPrompt,
    schema: RESPONSE_SCHEMA,
    toolName: PLAN_TOOL_NAME,
    toolDescription: PLAN_TOOL_DESCRIPTION,
    validatePayload,
    isValidResult: isValidPlan,
    sanitizeResult: sanitizePlan,
  },
  [BRAIN_DUMP_ROUTE]: {
    name: "brain-dump",
    system: BRAIN_DUMP_SYSTEM_PROMPT,
    buildPrompt: buildBrainDumpPrompt,
    schema: BRAIN_DUMP_SCHEMA,
    toolName: BRAIN_DUMP_TOOL_NAME,
    toolDescription: BRAIN_DUMP_TOOL_DESCRIPTION,
    validatePayload: validateBrainDumpPayload,
    isValidResult: isValidBrainDump,
    sanitizeResult: sanitizeBrainDump,
  },
  [BREAK_DOWN_ROUTE]: {
    name: "break-down",
    // Plus only (checked server-side when ENTITLEMENT_MODE is on).
    plusOnly: true,
    system: BREAK_DOWN_SYSTEM_PROMPT,
    buildPrompt: buildBreakDownPrompt,
    schema: BREAK_DOWN_SCHEMA,
    toolName: BREAK_DOWN_TOOL_NAME,
    toolDescription: BREAK_DOWN_TOOL_DESCRIPTION,
    validatePayload: validateBreakDownPayload,
    isValidResult: isValidBreakDown,
    sanitizeResult: sanitizeBreakDown,
  },
  [EVENING_ROUTE]: {
    name: "evening",
    // Plus only (checked server-side when ENTITLEMENT_MODE is on).
    plusOnly: true,
    system: EVENING_SYSTEM_PROMPT,
    buildPrompt: buildEveningPrompt,
    schema: EVENING_SCHEMA,
    toolName: EVENING_TOOL_NAME,
    toolDescription: EVENING_TOOL_DESCRIPTION,
    validatePayload: validateEveningPayload,
    isValidResult: isValidEvening,
    sanitizeResult: sanitizeEvening,
  },
};
