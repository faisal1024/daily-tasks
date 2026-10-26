// 1.5 D: what the "Share your day" picture says. Names on/off, Hide task
// names always respected (the sheet's switch can never override Settings),
// long names clipped, counts right.
import { describe, expect, it } from "vitest";

import {
  SHARE_CARD_BRAND,
  SHARE_CARD_PURPLE,
  SHARE_CARD_TASK_CHARS,
  shareCardModel,
  shareNamesChoice,
} from "../lib/daily-tasks/share-card";

const tasks = [
  { text: "Call the dentist", done: true },
  { text: "Write the report", done: true },
  { text: "Walk", done: true },
];
const base = { tasks, daysShowedUp: 12, dateLabel: "Monday, 26 October" };

describe("shareCardModel", () => {
  it("with names on: Day N, the date, each task in order with its state, and 'N of N'", () => {
    const model = shareCardModel({ ...base, showNames: true });
    expect(model.dayLabel).toBe("Day 12");
    expect(model.dateLabel).toBe("Monday, 26 October");
    expect(model.summary).toBe("3 of 3");
    expect(model.rows).toEqual(tasks);
  });

  it("with names off: no titles anywhere in the model, only the count", () => {
    const model = shareCardModel({ ...base, showNames: false });
    expect(model.rows).toBeNull();
    expect(JSON.stringify(model)).not.toMatch(/dentist|report|Walk/);
    expect(model.summary).toBe("3 of 3");
  });

  it("counts ticked of planned, not just rows (a partly done day)", () => {
    const model = shareCardModel({ ...base, tasks: [tasks[0], { text: "Read", done: false }], showNames: true });
    expect(model.summary).toBe("1 of 2");
    expect(model.rows?.map((row) => row.done)).toEqual([true, false]);
  });

  it("a Day count below 1 reads Day 1", () => {
    expect(shareCardModel({ ...base, daysShowedUp: 0, showNames: false }).dayLabel).toBe("Day 1");
  });

  it("clips a long name to the limit with an ellipsis, collapsing spaces, by characters not bytes", () => {
    const long = "x".repeat(SHARE_CARD_TASK_CHARS + 20);
    const [row] = shareCardModel({ ...base, tasks: [{ text: `  ${long}  `, done: false }], showNames: true }).rows ?? [];
    expect(Array.from(row.text)).toHaveLength(SHARE_CARD_TASK_CHARS);
    expect(row.text.endsWith("…")).toBe(true);
    const emoji = "🌟".repeat(SHARE_CARD_TASK_CHARS + 5);
    const [emojiRow] = shareCardModel({ ...base, tasks: [{ text: emoji, done: true }], showNames: true }).rows ?? [];
    expect(Array.from(emojiRow.text)).toHaveLength(SHARE_CARD_TASK_CHARS);
    expect(emojiRow.text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    const [spaced] = shareCardModel({ ...base, tasks: [{ text: "a   b\n c", done: false }], showNames: true }).rows ?? [];
    expect(spaced.text).toBe("a b c");
  });

  it("exposes the brand picture constants", () => {
    expect(SHARE_CARD_PURPLE).toBe("#5B52E8");
    expect(SHARE_CARD_BRAND).toBe("Three Today");
  });
});

describe("shareNamesChoice: Hide task names is always respected", () => {
  it("names start on and can be switched when Settings doesn't hide them", () => {
    expect(shareNamesChoice(false)).toEqual({ initial: true, canShow: true });
  });
  it("hidden in Settings: starts off and the switch isn't offered", () => {
    expect(shareNamesChoice(true)).toEqual({ initial: false, canShow: false });
  });
});
