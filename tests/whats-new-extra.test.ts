// What's new (1.4), the principal tester's additions (PR #93): the saved
// `whatsNewSeen` is cleaned as the state LOADS (not only by its own helper),
// so a damaged save can neither hide the sheet for good nor crash the rule.
import { describe, expect, it } from "vitest";

import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import { FEATURES_16_ID, NAG_ANNOUNCEMENT_ID, whatsNewDecision } from "../lib/daily-tasks/whats-new";

const saved = (whatsNewSeen: unknown) =>
  JSON.parse(JSON.stringify({ ...buildInitialState(new Date(2026, 9, 12)), hasSeenOnboarding: true, whatsNewSeen }));

describe("whatsNewSeen as the state loads", () => {
  it("a damaged list is cleaned on load: only well-formed ids, each once", () => {
    const loaded = normalizeState(saved([NAG_ANNOUNCEMENT_ID, 7, null, NAG_ANNOUNCEMENT_ID, "has space", { id: "x" }]))!;
    expect(loaded.whatsNewSeen).toEqual([NAG_ANNOUNCEMENT_ID]);
    // 1.4's is seen; 1.6's is still to come.
    expect(whatsNewDecision(loaded).show?.id).toBe(FEATURES_16_ID);
  });

  it.each([
    ["a string holding the id", NAG_ANNOUNCEMENT_ID],
    ["an object", { [NAG_ANNOUNCEMENT_ID]: true }],
    ["a number", 14],
    ["true", true],
    ["null", null],
  ])("%s is none seen (never 'seen' by accident), and the rule still runs", (_name, value) => {
    const loaded = normalizeState(saved(value))!;
    expect(loaded.whatsNewSeen).toEqual([]);
    // An updater: 1.6's sheet (it covers 1.4's Nag mode).
    expect(whatsNewDecision(loaded).show?.id).toBe(FEATURES_16_ID);
  });

  it("a text someone could have typed is never kept as an id", () => {
    const loaded = normalizeState(saved(["Call the dentist today", "1.4-nag\n", " 1.4-nag"]))!;
    expect(loaded.whatsNewSeen).toEqual([]);
  });
});
