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

// --- Principal tester (PR #90): the rule and the geometry, exhaustively ------

/** The rule, written out another way: the open ids re-sequenced, dealt back into the open slots. */
function expectedOrder(ids: string[], done: string[], id: string, to: number): string[] {
  const openIds = ids.filter((item) => !done.includes(item));
  if (!openIds.includes(id)) return ids;
  const rest = openIds.filter((item) => item !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  const sequence = [...rest.slice(0, at), id, ...rest.slice(at)];
  let next = 0;
  return ids.map((item) => (done.includes(item) ? item : sequence[next++]));
}

/** Every done/open combination of `ids`, as the list of done ids. */
function doneCombinations(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << ids.length; mask += 1) out.push(ids.filter((_, bit) => mask & (1 << bit)));
  return out;
}

describe("moveOpenTask: every list of 1, 2 and 3 tasks, every done/open combination", () => {
  const LISTS = [["A"], ["A", "B"], ["A", "B", "C"]];
  const cases = LISTS.flatMap((ids) => doneCombinations(ids).map((done) => ({ ids, done })));
  // 2 + 4 + 8 combinations.
  it("covers all 14 combinations", () => expect(cases).toHaveLength(14));

  it.each(cases)("[$ids] with [$done] done: every task (and one that isn't there) to every index", ({ ids, done }) => {
    for (const id of [...ids, "nope"]) {
      for (const to of [-2, -1, 0, 1, 2, 3, 4]) {
        const tasks = list(...ids);
        const frozen = tasks.slice();
        const moved = moveOpenTask(tasks, done, id, to);
        const want = expectedOrder(ids, done, id, to);
        const label = `${id} to ${to}`;
        expect(moved.map((task) => task.id), label).toEqual(want);
        // The store's array is never changed in place.
        expect(tasks, label).toEqual(frozen);
        tasks.forEach((task, index) => expect(task, label).toBe(frozen[index]));
        // Nothing to do: the very same array. Something to do: a new one, same task objects.
        if (want.join() === ids.join()) expect(moved, label).toBe(tasks);
        else expect(moved, label).not.toBe(tasks);
        expect([...moved].sort((a, b) => a.id.localeCompare(b.id)), label).toEqual(frozen);
        // A done task keeps its slot (the very same object at the same index): never a landing place.
        ids.forEach((item, index) => {
          if (done.includes(item)) expect(moved[index], label).toBe(tasks[index]);
        });
        // An unknown or done task, or fewer than two open: always a no-op.
        const openCount = ids.length - done.length;
        if (!ids.includes(id) || done.includes(id) || openCount < 2) expect(moved, label).toBe(tasks);
      }
    }
  });

  it.each(cases)("[$ids] with [$done] done: 'next' (index 0) puts the task first among the open ones", ({ ids, done }) => {
    const openIds = ids.filter((item) => !done.includes(item));
    for (const id of openIds) {
      const tasks = list(...ids);
      const moved = moveOpenTask(tasks, done, id, 0);
      // The first open task is now this one; the other open ones keep their order behind it.
      expect(moved.filter((task) => !done.includes(task.id)).map((task) => task.id)).toEqual([
        id,
        ...openIds.filter((item) => item !== id),
      ]);
      expect(reorderOptions(moved, done, id)).toMatchObject({ openIndex: 0, canDoNext: false, canMoveUp: false });
      // Already first: the same array; and doing it twice is the same as once.
      if (openIds[0] === id) expect(moved).toBe(tasks);
      expect(moveOpenTask(moved, done, id, 0)).toBe(moved);
    }
  });

  it.each(cases)("[$ids] with [$done] done: what a row offers is what would change the order", ({ ids, done }) => {
    const tasks = list(...ids);
    for (const id of [...ids, "nope"]) {
      const options = reorderOptions(tasks, done, id);
      const at = options.openIndex;
      const changes = (to: number) => at >= 0 && moveOpenTask(tasks, done, id, to) !== tasks;
      expect(options.canDoNext).toBe(changes(0));
      expect(options.canMoveDown).toBe(changes(at + 1));
      // Up one place, unless that is exactly what "Do this next" does (the second open row).
      expect(options.canMoveUp).toBe(at > 1 && changes(at - 1));
      expect(options.canDrag).toBe(at >= 0 && ids.length - done.length >= 2);
      if (done.includes(id) || !ids.includes(id)) expect(at).toBe(-1);
    }
  });

  it("completedIds that aren't on the list (yesterday's, a removed task's) change nothing", () => {
    const tasks = list("A", "B", "C");
    expect(show(moveOpenTask(tasks, ["gone", "B"], "C", 0), ["B"])).toBe("C B✓ A");
    expect(reorderOptions(tasks, ["gone"], "C")).toMatchObject({ openIndex: 2, canMoveDown: false, canDrag: true });
  });
});

describe("the drag's geometry: 2 and 3 rows, every done/open combination, mixed heights", () => {
  const HEIGHT_SETS = [
    [40, 80, 60],
    [64, 44, 52],
    [30, 30, 30],
    [120, 20, 48],
  ];
  const build = (count: number, heights: number[], done: number[], gap: number, top: number): RowFrame[] => {
    const frames: RowFrame[] = [];
    let y = top;
    for (let i = 0; i < count; i += 1) {
      if (i > 0) y += gap;
      frames.push({ id: "ABC"[i], y, height: heights[i], open: !done.includes(i) });
      y += heights[i];
    }
    return frames;
  };
  const layouts: { name: string; frames: RowFrame[]; gap: number }[] = [];
  for (const count of [2, 3]) {
    for (const heights of HEIGHT_SETS) {
      for (let mask = 0; mask < 1 << count; mask += 1) {
        const done = [0, 1, 2].filter((bit) => bit < count && mask & (1 << bit));
        for (const [gap, top] of [
          [1, 0],
          [0, 12],
        ]) {
          const frames = build(count, heights, done, gap, top);
          layouts.push({
            name: frames.map((frame) => `${frame.id}${frame.open ? "" : "✓"}:${frame.height}`).join(" ") + ` gap ${gap}`,
            frames,
            gap,
          });
        }
      }
    }
  }
  const openOf = (frames: RowFrame[]) => frames.filter((frame) => frame.open);
  const bottom = (frames: RowFrame[]) => frames[frames.length - 1].y + frames[frames.length - 1].height;

  it.each(layouts)("$name: every move restacks into the same card, done rows in their slots", ({ frames, gap }) => {
    const open = openOf(frames);
    const frozen = JSON.stringify(frames);
    for (let from = 0; from < open.length; from += 1) {
      for (let to = 0; to < open.length; to += 1) {
        const stacked = restackRows(frames, from, to, gap);
        const shifts = rowShifts(frames, from, to, gap);
        // The same rows, in the order the store will save.
        const want = expectedOrder(
          frames.map((frame) => frame.id),
          frames.filter((frame) => !frame.open).map((frame) => frame.id),
          open[from].id,
          to,
        );
        expect(stacked.map((row) => row.id)).toEqual(want);
        // The card doesn't grow, shrink or move: same top, same bottom, no gaps or overlaps.
        expect(stacked[0].y).toBe(frames[0].y);
        expect(bottom(stacked)).toBe(bottom(frames));
        for (let i = 1; i < stacked.length; i += 1) {
          expect(stacked[i].y).toBe(stacked[i - 1].y + stacked[i - 1].height + gap);
        }
        // Each row keeps its own height and open/done; a done row keeps its slot.
        frames.forEach((frame, index) => {
          const placed = stacked.find((row) => row.id === frame.id)!;
          expect(placed.height).toBe(frame.height);
          expect(placed.open).toBe(frame.open);
          if (!frame.open) expect(stacked[index].id).toBe(frame.id);
          // The slide is exactly the way from the old place to the new one.
          expect(frame.y + shifts[frame.id]).toBe(placed.y);
        });
        expect(Object.keys(shifts).sort()).toEqual(frames.map((frame) => frame.id).sort());
        // The slides balance: what moves down is paid for by what moves up
        // (each row weighted by the room it takes, hairline included).
        const balance = frames.reduce((sum, frame) => sum + (frame.height + gap) * shifts[frame.id], 0);
        expect(balance).toBe(0);
        // A move to the same place moves nothing at all.
        if (from === to) for (const frame of frames) expect(shifts[frame.id]).toBe(0);
        // Rows above the higher of the two places and below the lower one stay put.
        const fromSlot = frames.indexOf(open[from]);
        const toSlot = frames.indexOf(open[to]);
        frames.forEach((frame, index) => {
          if (index < Math.min(fromSlot, toSlot) || index > Math.max(fromSlot, toSlot)) {
            expect(shifts[frame.id]).toBe(0);
          }
        });
      }
    }
    // Pure: the frames handed in are untouched.
    expect(JSON.stringify(frames)).toBe(frozen);
  });

  it.each(layouts)("$name: the place a dragged row is over is the place it lands in", ({ frames, gap }) => {
    const open = openOf(frames);
    for (const frame of frames) {
      if (!frame.open) {
        expect(dragTargetIndex(frames, frame.id, frame.y, gap)).toBe(-1);
        continue;
      }
      const from = open.indexOf(frame);
      // Not moved at all: where it is.
      expect(dragTargetIndex(frames, frame.id, frame.y, gap)).toBe(from);
      // A point either way (less than the 6pt that picks the row up) is still its own place.
      expect(dragTargetIndex(frames, frame.id, frame.y + 1, gap)).toBe(from);
      expect(dragTargetIndex(frames, frame.id, frame.y - 1, gap)).toBe(from);
      // Held exactly on each resting place: that place, and the ghost's travel there is its slide.
      for (let to = 0; to < open.length; to += 1) {
        const landing = restackRows(frames, from, to, gap).find((row) => row.id === frame.id)!;
        expect(dragTargetIndex(frames, frame.id, landing.y, gap)).toBe(to);
        expect(landing.y - frame.y).toBe(rowShifts(frames, from, to, gap)[frame.id]);
      }
      // Past either end: the first or the last open place, never off the list.
      expect(dragTargetIndex(frames, frame.id, frames[0].y - 10_000, gap)).toBe(0);
      expect(dragTargetIndex(frames, frame.id, bottom(frames) + 10_000, gap)).toBe(open.length - 1);
      // Top to bottom, the place only ever goes up, one open place at a time, and reaches them all.
      const seen: number[] = [];
      for (let top = frames[0].y - 5; top <= bottom(frames) + 5; top += 1) {
        const over = dragTargetIndex(frames, frame.id, top, gap);
        expect(over).toBeGreaterThanOrEqual(0);
        expect(over).toBeLessThan(open.length);
        if (seen.length === 0 || seen[seen.length - 1] !== over) seen.push(over);
      }
      expect(seen).toEqual(open.map((_, index) => index));
    }
  });

  it("one open row among done ones has one place: wherever it is held", () => {
    const frames = build(3, [40, 80, 60], [0, 2], 1, 0);
    for (const top of [-500, 0, 41, 122, 900]) expect(dragTargetIndex(frames, "B", top, 1)).toBe(0);
    expect(rowShifts(frames, 0, 0, 1)).toEqual({ A: 0, B: 0, C: 0 });
    expect(rowShifts(frames, 0, 1, 1)).toEqual({ A: 0, B: 0, C: 0 });
  });

  it("two rows of different heights: each slides by the other's height and the hairline", () => {
    const frames = build(2, [40, 90], [], 1, 0);
    expect(rowShifts(frames, 0, 1, 1)).toEqual({ A: 91, B: -41 });
    expect(rowShifts(frames, 1, 0, 1)).toEqual({ A: 91, B: -41 });
    // A (centre 20) rests first, or last with its centre at 111: halfway is 65.5.
    expect(dragTargetIndex(frames, "A", 45, 1)).toBe(0); // centre 65
    expect(dragTargetIndex(frames, "A", 46, 1)).toBe(1); // centre 66
    // Exactly halfway between two places it stays with the earlier one (no flicker at the midpoint).
    const even = build(2, [40, 40], [], 0, 0);
    expect(dragTargetIndex(even, "A", 20, 0)).toBe(0);
    expect(dragTargetIndex(even, "B", 20, 0)).toBe(0);
  });
});

describe("reorderHandleFits: the edges", () => {
  it("360 wide and anything under 1.5x text keeps the handle; a hair less room loses it", () => {
    expect(reorderHandleFits(360, 1)).toBe(true);
    expect(reorderHandleFits(359.99, 1)).toBe(false);
    expect(reorderHandleFits(360, 1.4999)).toBe(true);
    expect(reorderHandleFits(360, 1.5)).toBe(false);
    expect(reorderHandleFits(359, 1.5)).toBe(false);
    // Smaller than standard text is fine.
    expect(reorderHandleFits(390, 0.85)).toBe(true);
  });
});
