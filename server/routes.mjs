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
  validateBrainDumpPayload,
  validateBreakDownPayload,
} from "./providers/helpers-contract.mjs";
import {
  PLAN_TOOL_DESCRIPTION,
  PLAN_TOOL_NAME,
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  buildPrompt,
  isValidPlan,
  validatePayload,
} from "./providers/plan-contract.mjs";

export const PLAN_ROUTE = "/api/momentum/plan";
export const BRAIN_DUMP_ROUTE = "/api/momentum/brain-dump";
export const BREAK_DOWN_ROUTE = "/api/momentum/break-down";

export const ROUTES = {
  [PLAN_ROUTE]: {
    name: "plan",
    system: SYSTEM_PROMPT,
    buildPrompt,
    schema: RESPONSE_SCHEMA,
    toolName: PLAN_TOOL_NAME,
    toolDescription: PLAN_TOOL_DESCRIPTION,
    validatePayload,
    isValidResult: isValidPlan,
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
  },
  [BREAK_DOWN_ROUTE]: {
    name: "break-down",
    system: BREAK_DOWN_SYSTEM_PROMPT,
    buildPrompt: buildBreakDownPrompt,
    schema: BREAK_DOWN_SCHEMA,
    toolName: BREAK_DOWN_TOOL_NAME,
    toolDescription: BREAK_DOWN_TOOL_DESCRIPTION,
    validatePayload: validateBreakDownPayload,
    isValidResult: isValidBreakDown,
  },
};
