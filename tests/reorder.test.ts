// Reordering today's tasks (1.4, PR #90): the ordering rule and the drag's
// geometry, both pure (lib/daily-tasks/reorder.ts).
import { describe, expect, it } from "vitest";

import {
  dragTargetIndex,
  moveOpenTask,
  REORDER_HANDLE_OPACITY,
  reorderAnnouncement,
  reorderHandleFits,
  reorderOptions,
  restackRows,
  rowShifts,
  type RowFrame,
} from "../lib/daily-tasks/reorder";
import { themeColors } from "../theme.config";

const list = (...ids: string[]) => ids.map((id) => ({ id }));
/** "A B✓ C": the order, with done tasks marked. */
const show = (tasks: { id: string }[], done: string[]) =>
  tasks.map((task) => (done.includes(task.id) ? `${task.id}✓` : task.id)).join(" ");

describe("moveOpenTask: the ordering rule", () => {
  // docs/2026-10-v1.4.md, "The ordering rule", example table.
  it.each([
    { done: [], id: "C", to: 0, after: "C A B" },
    { done: [], id: "A", to: 2, after: "B C A" },
    { done: ["B"], id: "C", to: 0, after: "C B✓ A" },
    { done: ["A"], id: "C", to: 0, after: "A✓ C B" },
  ])("[A, B, C] with $done done: $id to open index $to gives $after", ({ done, id, to, after }) => {
    const tasks = list("A", "B", "C");
    const moved = moveOpenTask(tasks, done, id, to);
    expect(show(moved, done)).toBe(after);
    // The input is never changed in place (it's the store's state).
    expect(show(tasks, done)).toBe(show(list("A", "B", "C"), done));
  });

  it("the table's last row: a done task asked to be next changes nothing (the same array)", () => {
    const tasks = list("A", "B", "C", "D");
    expect(moveOpenTask(tasks, ["B"], "B", 0)).toBe(tasks);
    // And with a fourth, open, task the rule is the same: D next goes around B.
    expect(show(moveOpenTask(tasks, ["B"], "D", 0), ["B"])).toBe("D B✓ A C");
  });

  it("a done task keeps its index whichever open task moves, and wherever to", () => {
    const tasks = list("A", "B", "C", "D", "E");
    const done = ["B", "D"];
    for (const id of ["A", "C", "E"]) {
      for (const to of [0, 1, 2]) {
        const moved = moveOpenTask(tasks, done, id, to);
        expect(moved[1].id).toBe("B");
        expect(moved[3].id).toBe("D");
        // Open tasks only swap among themselves: the same three, in the open slots.
        expect([moved[0].id, moved[2].id, moved[4].id].sort()).toEqual(["A", "C", "E"]);
        expect(moved[[0, 2, 4][to]].id).toBe(id);
      }
    }
  });

  it("toIndex counts open tasks only, and is clamped to what exists", () => {
    const tasks = list("A", "B", "C", "D");
    const done = ["B"];
    // Below the range: first. Above it: last.
    expect(show(moveOpenTask(tasks, done, "D", -5), done)).toBe("D B✓ A C");
    expect(show(moveOpenTask(tasks, done, "A", 99), done)).toBe("C B✓ D A");
    expect(show(moveOpenTask(tasks, done, "A", Number.MAX_SAFE_INTEGER), done)).toBe("C B✓ D A");
    // A fraction is cut to its whole part.
    expect(show(moveOpenTask(tasks, done, "A", 1.9), done)).toBe("C B✓ A D");
  });

  it("gives back the very same array when there's nothing to do", () => {
    const tasks = list("A", "B", "C");
    // Already there (and already there once clamped).
    expect(moveOpenTask(tasks, [], "A", 0)).toBe(tasks);
    expect(moveOpenTask(tasks, [], "B", 1)).toBe(tasks);
    expect(moveOpenTask(tasks, [], "A", -3)).toBe(tasks);
    expect(moveOpenTask(tasks, [], "C", 50)).toBe(tasks);
    // A done task, an unknown one, an empty list.
    expect(moveOpenTask(tasks, ["B"], "B", 0)).toBe(tasks);
    expect(moveOpenTask(tasks, [], "nope", 0)).toBe(tasks);
    const empty: { id: string }[] = [];
    expect(moveOpenTask(empty, [], "A", 0)).toBe(empty);
    // Fewer than two open tasks.
    expect(moveOpenTask(tasks, ["A", "B"], "C", 0)).toBe(tasks);
    // Not a number at all.
    expect(moveOpenTask(tasks, [], "C", Number.NaN)).toBe(tasks);
    expect(moveOpenTask(tasks, [], "C", Number.POSITIVE_INFINITY)).toBe(tasks);
    expect(moveOpenTask(tasks, [], "C", Number.NEGATIVE_INFINITY)).toBe(tasks);
  });
});

describe("reorderOptions: what a row can offer", () => {
  it("first open: no Do this next / Move up; last open: no Move down; done: nothing", () => {
    const tasks = list("A", "B", "C");
    expect(reorderOptions(tasks, [], "A")).toEqual({
      openIndex: 0,
      canDoNext: false,
      canMoveUp: false,
      canMoveDown: true,
      canDrag: true,
    });
    // Second: one place up IS "Do this next", so only that is offered.
    expect(reorderOptions(tasks, [], "B")).toMatchObject({ canDoNext: true, canMoveUp: false, canMoveDown: true });
    expect(reorderOptions(tasks, [], "C")).toMatchObject({ canDoNext: true, canMoveUp: true, canMoveDown: false });
    // With a done task in between, C is still the third open one.
    expect(reorderOptions(list("A", "B", "X", "C"), ["X"], "C")).toMatchObject({ openIndex: 2, canMoveUp: true });
    // Two open tasks: the second has Do this next and nothing else.
    expect(reorderOptions(tasks, ["A"], "C")).toEqual({
      openIndex: 1,
      canDoNext: true,
      canMoveUp: false,
      canMoveDown: false,
      canDrag: true,
    });
    // "First" and "last" are among the open ones: A is done, so B is first.
    expect(reorderOptions(tasks, ["A"], "B")).toMatchObject({ openIndex: 0, canDoNext: false, canMoveUp: false });
    expect(reorderOptions(tasks, ["C"], "B")).toMatchObject({ openIndex: 1, canMoveDown: false });
    const nothing = { canDoNext: false, canMoveUp: false, canMoveDown: false, canDrag: false };
    expect(reorderOptions(tasks, ["B"], "B")).toEqual({ openIndex: -1, ...nothing });
    expect(reorderOptions(tasks, [], "nope")).toEqual({ openIndex: -1, ...nothing });
    // The only open task has nowhere to go.
    expect(reorderOptions(tasks, ["A", "C"], "B")).toEqual({ openIndex: 0, ...nothing });
  });
});

// A card with rows of different heights, a done one between two open ones,
// and a 1pt hairline between rows: A 0..40, B✓ 41..121, C 122..182.
const GAP = 1;
const FRAMES: RowFrame[] = [
  { id: "A", y: 0, height: 40, open: true },
  { id: "B", y: 41, height: 80, open: false },
  { id: "C", y: 122, height: 60, open: true },
];
const places = (frames: RowFrame[]) => frames.map((frame) => `${frame.id}@${frame.y}+${frame.height}`).join(" ");

describe("restackRows: where rows sit once an open row moves", () => {
  it("swaps the open rows around the done one and restacks by each row's own height", () => {
    // A (40 tall) and C (60 tall) trade slots; B keeps slot 2 but sits 20 lower.
    expect(places(restackRows(FRAMES, 0, 1, GAP))).toBe("C@0+60 B@61+80 A@142+40");
    expect(places(restackRows(FRAMES, 1, 0, GAP))).toBe("C@0+60 B@61+80 A@142+40");
    expect(restackRows(FRAMES, 0, 1, GAP).map((frame) => frame.open)).toEqual([true, false, true]);
  });

  it("leaves the places as they are for a move to the same place or from nowhere", () => {
    const still = "A@0+40 B@41+80 C@122+60";
    expect(places(restackRows(FRAMES, 0, 0, GAP))).toBe(still);
    expect(places(restackRows(FRAMES, 1, 1, GAP))).toBe(still);
    expect(places(restackRows(FRAMES, -1, 0, GAP))).toBe(still);
    expect(places(restackRows(FRAMES, 5, 0, GAP))).toBe(still);
    // A target past the end is the last open place.
    expect(places(restackRows(FRAMES, 0, 9, GAP))).toBe("C@0+60 B@61+80 A@142+40");
  });

  it("stacks from the first row's top, wherever the rows start in the card", () => {
    const lower = FRAMES.map((frame) => ({ ...frame, y: frame.y + 12 }));
    expect(places(restackRows(lower, 0, 1, GAP))).toBe("C@12+60 B@73+80 A@154+40");
    expect(restackRows([], 0, 1, GAP)).toEqual([]);
  });
});

describe("rowShifts: how far each row slides while a drag previews its drop", () => {
  it("is each row's distance from its own place, by id (mixed heights, a done row in the middle)", () => {
    // A (40) and C (60) trade places; the done row B keeps its slot and sits 20 lower.
    expect(rowShifts(FRAMES, 0, 1, GAP)).toEqual({ A: 142, B: 20, C: -122 });
    expect(rowShifts(FRAMES, 1, 0, GAP)).toEqual({ A: 142, B: 20, C: -122 });
  });

  it("is nothing for a row that stays, and for a move to the same place", () => {
    expect(rowShifts(FRAMES, 0, 0, GAP)).toEqual({ A: 0, B: 0, C: 0 });
    expect(rowShifts(FRAMES, 7, 0, GAP)).toEqual({ A: 0, B: 0, C: 0 });
    expect(rowShifts([], 0, 1, GAP)).toEqual({});
    // Three open rows of different heights: moving the first to the middle leaves the last alone.
    const three: RowFrame[] = [
      { id: "A", y: 0, height: 40, open: true },
      { id: "B", y: 41, height: 70, open: true },
      { id: "C", y: 112, height: 50, open: true },
    ];
    expect(rowShifts(three, 0, 1, GAP)).toEqual({ A: 71, B: -41, C: 0 });
    expect(rowShifts(three, 2, 0, GAP)).toEqual({ A: 51, B: 51, C: -112 });
  });

  it("puts every row exactly where the saved order will lay it out (so the drop moves nothing)", () => {
    const frames: RowFrame[] = [
      { id: "A", y: 0, height: 64, open: true },
      { id: "B", y: 65, height: 44, open: false },
      { id: "C", y: 110, height: 52, open: true },
      { id: "D", y: 163, height: 58, open: true },
    ];
    for (let from = 0; from < 3; from += 1) {
      for (let to = 0; to < 3; to += 1) {
        const shifts = rowShifts(frames, from, to, GAP);
        const stacked = restackRows(frames, from, to, GAP);
        // No overlaps and no gaps: each row starts a hairline under the one before.
        for (let i = 1; i < stacked.length; i += 1) {
          expect(stacked[i].y).toBe(stacked[i - 1].y + stacked[i - 1].height + GAP);
        }
        for (const frame of frames) {
          const placed = stacked.find((row) => row.id === frame.id)!;
          expect(frame.y + shifts[frame.id]).toBe(placed.y);
        }
        // The done row never leaves its slot.
        expect(stacked[1].id).toBe("B");
      }
    }
  });
});

describe("dragTargetIndex: which open place a dragged row is over", () => {
  it("picks the place whose resting centre is nearest the dragged row's centre", () => {
    // A rests centred at 20 (first) or 162 (last, under C and B): halfway is 91.
    expect(dragTargetIndex(FRAMES, "A", 0, GAP)).toBe(0);
    expect(dragTargetIndex(FRAMES, "A", 70, GAP)).toBe(0); // centre 90
    expect(dragTargetIndex(FRAMES, "A", 72, GAP)).toBe(1); // centre 92
    expect(dragTargetIndex(FRAMES, "A", 142, GAP)).toBe(1);
    // C rests centred at 30 (first) or 152 (where it is): halfway is 91 too.
    expect(dragTargetIndex(FRAMES, "C", 122, GAP)).toBe(1);
    expect(dragTargetIndex(FRAMES, "C", 62, GAP)).toBe(1); // centre 92
    expect(dragTargetIndex(FRAMES, "C", 60, GAP)).toBe(0); // centre 90
    expect(dragTargetIndex(FRAMES, "C", 0, GAP)).toBe(0);
  });

  it("counts open rows only: the done row in between is never a place to land", () => {
    // Held right over the done row B (centre 81): still one of the two open places.
    expect([0, 1]).toContain(dragTargetIndex(FRAMES, "A", 61, GAP));
    expect(dragTargetIndex(FRAMES, "A", 61, GAP)).toBe(0);
    // Far outside the card clamps to an end.
    expect(dragTargetIndex(FRAMES, "A", -500, GAP)).toBe(0);
    expect(dragTargetIndex(FRAMES, "A", 5000, GAP)).toBe(1);
  });

  it("is -1 for a done row or one that isn't there", () => {
    expect(dragTargetIndex(FRAMES, "B", 41, GAP)).toBe(-1);
    expect(dragTargetIndex(FRAMES, "nope", 0, GAP)).toBe(-1);
    expect(dragTargetIndex([], "A", 0, GAP)).toBe(-1);
  });
});

describe("reorderHandleFits: room for the drag handle", () => {
  it("not on a narrow window or at a large text size (the menu moves the row instead)", () => {
    expect(reorderHandleFits(390, 1)).toBe(true);
    expect(reorderHandleFits(360, 1.49)).toBe(true);
    expect(reorderHandleFits(359, 1)).toBe(false);
    expect(reorderHandleFits(320, 1)).toBe(false);
    expect(reorderHandleFits(430, 1.5)).toBe(false);
    expect(reorderHandleFits(1024, 2)).toBe(false);
  });
});

describe("reorderAnnouncement: what VoiceOver hears", () => {
  it("says a task is next when it becomes the first open one, and where it went otherwise", () => {
    expect(reorderAnnouncement("Walk", 0, "up")).toBe("Walk is next");
    expect(reorderAnnouncement("Walk", 1, "up")).toBe("Moved up: Walk");
    expect(reorderAnnouncement("Walk", 2, "down")).toBe("Moved down: Walk");
  });
});

describe("the drag handle's glyph", () => {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it.each(["light", "dark"] as const)("is quieter than muted but at least 3:1 on the card (%s)", (scheme) => {
    const muted = rgb(themeColors.muted[scheme]);
    const surface = rgb(themeColors.surface[scheme]);
    const glyph = muted.map((value, i) => value * REORDER_HANDLE_OPACITY + surface[i] * (1 - REORDER_HANDLE_OPACITY));
    expect(REORDER_HANDLE_OPACITY).toBeLessThan(1);
    expect(contrast(glyph, surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(glyph, surface)).toBeLessThan(contrast(muted, surface));
  });
});
