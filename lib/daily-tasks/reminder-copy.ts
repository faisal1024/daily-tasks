// What a reminder says (1.4): built on the phone from today's tasks, never
// sent anywhere. Pure: no clock, no storage, no notifications API.
//
// Tone: calm, no guilt. Something unfinished is "still open", never "missed"
// or "overdue".

export type ReminderKind = "morning" | "progress" | "evening";

export interface ReminderCopy {
  title: string;
  body: string;
}

/** One of the day's tasks, in the order Today shows them. */
export interface ReminderTask {
  text: string;
  done: boolean;
}

export interface ReminderCopyInput {
  kind: ReminderKind;
  /** The day the reminder is delivered on (yyyy-MM-dd). */
  dayKey: string;
  /**
   * The slot's place in its kind's schedule for the day (0 for the first
   * hour, whether or not that hour has passed), so a slot keeps its wording
   * when the day is rescheduled and neighbours never repeat it.
   */
  slotIndex: number;
  /** The delivery day's tasks, in order; empty when nothing is picked. */
  tasks: ReminderTask[];
  /** The day is set (locked): nothing can be added to it. */
  locked: boolean;
  /** Task texts still open from the day before the delivery day, in order. */
  yesterdayOpen: string[];
  /** Settings › Reminders › "Hide task names in notifications". */
  hideNames: boolean;
  /**
   * False when the reminder is written well ahead of its delivery (a later
   * slot today, or tomorrow morning's from the evening before). A task can be
   * ticked from the widget without the app running, so those leave counts out
   * and hedge ("Anything still open? Next up was: …").
   */
  certain: boolean;
}

/** Longest task name shown in a reminder, in visible characters. */
export const MAX_REMINDER_TASK_CHARS = 60;

/**
 * The general wording: what every reminder said before 1.4, and what they
 * all say with "Hide task names in notifications" on.
 */
export const GENERIC_REMINDER_COPY: Record<ReminderKind, ReminderCopy> = {
  morning: {
    title: "A calm start",
    body: "Choose Today's Three.",
  },
  progress: {
    title: "A small nudge",
    body: "Today's Three still need a little attention.",
  },
  evening: {
    title: "Still time today",
    body: "A small finish is still a finish.",
  },
};

type GraphemeSegmenter = { segment(text: string): Iterable<{ segment: string }> };
type SegmenterCtor = new (locale?: string, options?: { granularity: "grapheme" }) => GraphemeSegmenter;

const ZERO_WIDTH_JOINER = 0x200d;

/** Code points that belong to the character before them (accents, skin tones, variation selectors, joiners, tags). */
function extendsPrevious(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    cp === ZERO_WIDTH_JOINER ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
    (cp >= 0xe0020 && cp <= 0xe007f)
  );
}

function isRegionalIndicator(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

/**
 * Without Intl.Segmenter (Hermes): code points, with the common joining
 * cases kept whole (combining accents, skin tones, ZWJ sequences such as a
 * family emoji, flags).
 */
function fallbackGraphemes(text: string): string[] {
  const out: string[] = [];
  let joinNext = false;
  // A flag is two regional indicators: true while the last cluster is the first half.
  let openFlag = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const regional = isRegionalIndicator(cp);
    const closesFlag: boolean = regional && openFlag;
    const attach: boolean = out.length > 0 && (joinNext || extendsPrevious(cp) || closesFlag);
    if (attach) out[out.length - 1] += ch;
    else out.push(ch);
    openFlag = regional && !closesFlag;
    joinNext = cp === ZERO_WIDTH_JOINER;
  }
  return out;
}

/** The visible characters of `text` (an emoji, a flag or an accented letter is one). */
export function reminderGraphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (typeof Segmenter === "function") {
    return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  }
  return fallbackGraphemes(text);
}

// Newlines, tabs, other control characters, line/paragraph separators and
// text-direction overrides: none belong in a one-line notification.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028-\u2029\u202a-\u202e\u2066-\u2069]+/g;

/**
 * A task's words made safe for a notification: one line, no control
 * characters, at most `max` visible characters (the last one an ellipsis
 * when cut; never half an emoji). "" when nothing readable is left.
 */
export function reminderTaskName(text: unknown, max: number = MAX_REMINDER_TASK_CHARS): string {
  if (typeof text !== "string") return "";
  const clean = text.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const chars = reminderGraphemes(clean);
  if (chars.length <= max) return clean;
  return `${chars.slice(0, Math.max(1, max - 1)).join("").trimEnd()}…`;
}

/** The name as the end of a sentence: no second full stop after "Call mom." or a cut "…". */
function sentence(name: string): string {
  return /[.!?…]$/.test(name) ? name : `${name}.`;
}

type NameLine = (name: string) => string;
type CountLine = (name: string, done: number, total: number) => string;

// None done yet.
const FIRST_UP: NameLine[] = [
  (n) => `First up: ${sentence(n)} Five minutes is a start.`,
  (n) => `First up: ${sentence(n)} A small start counts.`,
  (n) => `Today's first: ${sentence(n)} Begin anywhere.`,
  (n) => `Up first: ${sentence(n)} Just the first step.`,
];

// Some done, more than one still open.
const SOME_DONE: CountLine[] = [
  (n, done, total) => `${done} of ${total} done. Next: ${sentence(n)}`,
  (n, done, total) => `${done} of ${total} done. Next up: ${sentence(n)}`,
  (n, done, total) => `${done} done, ${total - done} to go. Next: ${sentence(n)}`,
  (n, done, total) => `${done} of ${total} done. Whenever you're ready: ${sentence(n)}`,
];

// Some done, one still open.
const ONE_LEFT: NameLine[] = [
  (n) => `One to go: ${sentence(n)}`,
  (n) => `One to go: ${sentence(n)} Five minutes is a start.`,
  (n) => `Just one left: ${sentence(n)}`,
  (n) => `One to go: ${sentence(n)} A small finish is still a finish.`,
];

// Written well ahead (see `certain`): true even if it was ticked since.
const LATER_TODAY: NameLine[] = [
  (n) => `Anything still open? Next up was: ${sentence(n)}`,
  (n) => `If it's still open: ${sentence(n)} Five minutes is a start.`,
  (n) => `Checking in. Next up was: ${sentence(n)}`,
  (n) => `Anything still open? Last time, next was: ${sentence(n)}`,
];

// Nothing picked today, something still open from the day before.
const FROM_YESTERDAY: NameLine[] = [
  (n) => `Still open from yesterday: ${sentence(n)} Want it in today's three?`,
  (n) => `Still open from yesterday: ${sentence(n)} It could be one of today's three.`,
  (n) => `From yesterday, still open: ${sentence(n)} Want it in today's three?`,
  (n) => `Nothing picked yet. Still open from yesterday: ${sentence(n)}`,
];

// The same, written the evening before.
const FROM_YESTERDAY_AHEAD: NameLine[] = [
  (n) => `Anything still open from yesterday? Next up was: ${sentence(n)} Want it in today's three?`,
  (n) => `If it's still open from yesterday: ${sentence(n)} It could be one of today's three.`,
  (n) => `Yesterday's next was: ${sentence(n)} Still open? It could be one of today's three.`,
];

// Nothing picked, nothing left over.
const NOTHING_PICKED: string[] = [
  "Nothing picked yet. What are today's three?",
  "Nothing picked yet. Three small things is plenty.",
  "A fresh page. What are today's three?",
  "Nothing picked yet. One is enough to begin.",
];

/** A small stable hash (FNV-1a), so a day's wording doesn't depend on the engine. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Which variant a slot uses: fixed for a day + kind + slot, and one step on
 * from the slot before it, so two reminders in a row never read the same.
 */
export function reminderVariantIndex(dayKey: string, kind: ReminderKind, slotIndex: number, count: number): number {
  if (count <= 1) return 0;
  const slot = Number.isFinite(slotIndex) ? Math.max(0, Math.floor(slotIndex)) : 0;
  return ((hash(`${dayKey}:${kind}`) % count) + slot) % count;
}

/**
 * The words for one reminder, or null when there is nothing to remind about
 * (everything picked is done).
 */
export function buildReminderCopy(input: ReminderCopyInput): ReminderCopy | null {
  const { kind, dayKey, slotIndex, tasks, locked, yesterdayOpen, hideNames, certain } = input;
  const generic = GENERIC_REMINDER_COPY[kind];
  const open = tasks.filter((task) => !task.done);
  if (tasks.length > 0 && open.length === 0) return null;
  if (hideNames) return generic;

  const pick = <T,>(variants: T[]): T => variants[reminderVariantIndex(dayKey, kind, slotIndex, variants.length)];
  const withBody = (body: string): ReminderCopy => ({ title: generic.title, body });

  if (tasks.length === 0) {
    // A set day takes nothing more, so there is nothing to offer.
    if (locked) return generic;
    const fromYesterday = yesterdayOpen.map((text) => reminderTaskName(text)).find((name) => name.length > 0);
    if (fromYesterday) return withBody(pick(certain ? FROM_YESTERDAY : FROM_YESTERDAY_AHEAD)(fromYesterday));
    return withBody(pick(NOTHING_PICKED));
  }

  // The next one: the first still open, in Today's order.
  const next = open.map((task) => reminderTaskName(task.text)).find((name) => name.length > 0);
  if (!next) return generic;
  if (!certain) return withBody(pick(LATER_TODAY)(next));

  const done = tasks.length - open.length;
  if (done === 0) return withBody(pick(FIRST_UP)(next));
  if (open.length === 1) return withBody(pick(ONE_LEFT)(next));
  return withBody(pick(SOME_DONE)(next, done, tasks.length));
}
