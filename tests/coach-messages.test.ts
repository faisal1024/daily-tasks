import { describe, expect, it } from "vitest";

import {
  COACH_MESSAGES,
  selectCoachMessage,
} from "../lib/daily-tasks/coach-messages";

describe("coach messages", () => {
  it("keeps a broad library of tagged coach copy", () => {
    expect(COACH_MESSAGES.length).toBeGreaterThanOrEqual(30);
    expect(COACH_MESSAGES.every((message) => message.tags.length > 0)).toBe(
      true,
    );
  });

  it("selects empty-state copy before tasks exist", () => {
    const message = selectCoachMessage({
      dateKey: "2026-05-02",
      total: 0,
      completedCount: 0,
      locked: false,
      adaptationRecommendation: null,
    });

    expect(message.tags).toContain("empty");
  });

  it("selects locked follow-through copy for unfinished locked days", () => {
    const message = selectCoachMessage({
      dateKey: "2026-05-02",
      total: 3,
      completedCount: 2,
      locked: true,
      adaptationRecommendation: null,
    });

    expect(message.tags).toContain("locked");
  });

  it("selects reflection copy when all tasks are done", () => {
    const message = selectCoachMessage({
      dateKey: "2026-05-02",
      total: 2,
      completedCount: 2,
      locked: true,
      adaptationRecommendation: "simplify",
    });

    expect(message.tags).toContain("complete");
  });

  it("prioritizes recovery copy when Momentum is simplifying tomorrow", () => {
    const message = selectCoachMessage({
      dateKey: "2026-05-02",
      total: 0,
      completedCount: 0,
      locked: false,
      adaptationRecommendation: "simplify",
    });

    expect(message.tags).toContain("recovery");
  });

  it("is stable for the same day and state", () => {
    const input = {
      dateKey: "2026-05-02",
      total: 1,
      completedCount: 0,
      locked: false,
      adaptationRecommendation: null,
    };

    expect(selectCoachMessage(input).id).toBe(selectCoachMessage(input).id);
  });
});
