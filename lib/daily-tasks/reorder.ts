// Reordering today's tasks (1.4): pure, so the store, the Today screen and the
// drag's UI-thread code all share one rule.
//
// THE RULE
// - Only open (not done) tasks move, and only among themselves.
// - A done task keeps its slot: its index in the list never changes.
// - The "open slots" are the indexes the open tasks hold, in ascending order.
//   A move takes the task out of the open tasks' sequence, puts it back at
//   `toIndex` (0 = the first open task, the one everything calls "next"), and
//   writes the sequence back into the same open slots, top to bottom.
// - `toIndex` counts open tasks only, and is clamped to what exists.
// - Nothing to do (unknown or done task, fewer than two open tasks, or the
//   task is already there) gives back the very same array.
//
// Example: [A, B✓, C, D] with D made next becomes [D, B✓, A, C].

/**
 * `items` with the open item at `from` (counting open items only) moved to
 * `to` (same counting); done items keep their indexes. A worklet, so the drag
 * can preview the same order on the UI thread. Out of range gives `items` back.
 */
export function moveAmongOpen<T>(items: T[], open: boolean[], from: number, to: number): T[] {
  "worklet";
  const slots: number[] = [];
  for (let i = 0; i < items.length; i += 1) if (open[i]) slots.push(i);
  if (from < 0 || from >= slots.length) return items;
  const target = Math.max(0, Math.min(to, slots.length - 1));
  if (target === from) return items;
  const sequence: T[] = [];
  for (let i = 0; i < slots.length; i += 1) if (i !== from) sequence.push(items[slots[i]]);
  sequence.splice(target, 0, items[slots[from]]);
  const out = items.slice();
  for (let i = 0; i < slots.length; i += 1) out[slots[i]] = sequence[i];
  return out;
}

/** Where a task stands among the open ones (0 = next), or -1 if done or gone. */
export function openTaskIndex(tasks: { id: string }[], completedIds: string[], taskId: string): number {
  let position = 0;
  for (const task of tasks) {
    if (completedIds.includes(task.id)) continue;
    if (task.id === taskId) return position;
    position += 1;
  }
  return -1;
}

/** How many of today's tasks are still open. */
export function openTaskCount(tasks: { id: string }[], completedIds: string[]): number {
  return tasks.filter((task) => !completedIds.includes(task.id)).length;
}

/**
 * Today's list with the open task `taskId` moved to `toIndex` among the open
 * tasks (see THE RULE above). The same array when nothing changes.
 */
export function moveOpenTask<T extends { id: string }>(
  tasks: T[],
  completedIds: string[],
  taskId: string,
  toIndex: number,
): T[] {
  if (!Number.isFinite(toIndex)) return tasks;
  const from = openTaskIndex(tasks, completedIds, taskId);
  if (from < 0) return tasks;
  return moveAmongOpen(
    tasks,
    tasks.map((task) => !completedIds.includes(task.id)),
    from,
    Math.trunc(toIndex),
  );
}

export interface ReorderOptions {
  /** Its place among the open tasks (0 = next); -1 when it can't move. */
  openIndex: number;
  /** "Do this next": open, and not already the first open task. */
  canDoNext: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** There's somewhere to drag it: at least two open tasks. */
  canDrag: boolean;
}

/** What reordering a row can offer. A done task offers nothing. */
export function reorderOptions(tasks: { id: string }[], completedIds: string[], taskId: string): ReorderOptions {
  const openIndex = openTaskIndex(tasks, completedIds, taskId);
  if (openIndex < 0) return { openIndex, canDoNext: false, canMoveUp: false, canMoveDown: false, canDrag: false };
  const count = openTaskCount(tasks, completedIds);
  return {
    openIndex,
    canDoNext: openIndex > 0,
    canMoveUp: openIndex > 0,
    canMoveDown: openIndex < count - 1,
    canDrag: count > 1,
  };
}

/** What VoiceOver hears after a move: "<task> is next", or where it went. */
export function reorderAnnouncement(text: string, openIndex: number, direction: "up" | "down"): string {
  return openIndex === 0 ? `${text} is next` : `Moved ${direction}: ${text}`;
}

/** A row's place in the card: its top and height, without the hairline above it. */
export interface RowFrame {
  id: string;
  y: number;
  height: number;
  open: boolean;
}

/**
 * Where each row sits once the open row `from` is moved to `to` (both counted
 * among open rows): the rows restacked from the top in their new order, with
 * `gap` (the hairline) between them. Rows differ in height, so a done row can
 * shift on screen while keeping its slot.
 */
export function restackRows(frames: RowFrame[], from: number, to: number, gap: number): RowFrame[] {
  "worklet";
  const open: boolean[] = [];
  for (let i = 0; i < frames.length; i += 1) open.push(frames[i].open);
  const order = moveAmongOpen(frames, open, from, to);
  const out: RowFrame[] = [];
  let y = frames.length > 0 ? frames[0].y : 0;
  for (let i = 0; i < order.length; i += 1) {
    if (i > 0) y += gap;
    out.push({ id: order[i].id, y, height: order[i].height, open: order[i].open });
    y += order[i].height;
  }
  return out;
}

/**
 * Which open position a dragged row is over: the one whose resting place is
 * nearest to where the row's centre is now (`top` is its current top edge).
 * -1 when the row isn't an open one.
 */
export function dragTargetIndex(frames: RowFrame[], id: string, top: number, gap: number): number {
  "worklet";
  let from = -1;
  let openCount = 0;
  let height = 0;
  for (let i = 0; i < frames.length; i += 1) {
    if (!frames[i].open) continue;
    if (frames[i].id === id) {
      from = openCount;
      height = frames[i].height;
    }
    openCount += 1;
  }
  if (from < 0) return -1;
  const centre = top + height / 2;
  let best = from;
  let bestDistance = Infinity;
  for (let k = 0; k < openCount; k += 1) {
    const stacked = restackRows(frames, from, k, gap);
    for (let i = 0; i < stacked.length; i += 1) {
      if (stacked[i].id !== id) continue;
      const distance = Math.abs(stacked[i].y + stacked[i].height / 2 - centre);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = k;
      }
    }
  }
  return best;
}
