// What a reminder says (1.4): built on the phone from today's tasks. This
// builder sends nothing anywhere. Pure: no clock, no storage, no
// notifications API.
//
// Tone: calm, no guilt. Something unfinished is "still open", never "missed"
// or "overdue".

export type ReminderKind = "morning" | "progress" | "evening";

export interface ReminderCopy {
  title: string;
  body: string;
  /** The id of the one task these words name, when they name exactly one of the day's (never its text). */
  taskId?: string;
}

/** One of the day's tasks, in the order Today shows them. */
export interface ReminderTask {
  text: string;
  done: boolean;
  /** The task's id, passed on in the notification's data (so a tap can find it). */
  id?: string;
}

export interface ReminderCopyInput {
  kind: ReminderKind;
  /** The day the reminder is delivered on (yyyy-MM-dd). */
  dayKey: string;
  /**
   * The slot's place in the whole day's schedule (0 for the day's first
   * time, whether or not it has passed; kinds are not counted apart). A slot
   * keeps its wording when the day is rescheduled, and each slot is one step
   * on from the one before, so two in a row never read the same.
   */
  slotIndex: number;
  /** The delivery day's tasks, in order; empty when nothing is picked. */
  tasks: ReminderTask[];
  /** The day is set (locked): nothing can be added to it. */
  locked: boolean;
  /** Task texts still open from the day before the delivery day, in order. */
  yesterdayOpen: string[];
  /** Settings > Reminders > "Hide task names in notifications". */
  hideNames: boolean;
  /**
   * False when the reminder is written well ahead of its delivery (a later
   * slot today, or tomorrow morning's from the evening before). A task can be
   * ticked from the widget without the app running, so those leave counts out
   * and are worded to be true either way ("Walk. Still open? ...").
   */
  certain: boolean;
  /**
   * Delivered in the evening (17:00 on): evening wording, whatever the kind
   * ("Every hour" sends progress reminders into the evening). Defaults to
   * `kind === "evening"`.
   */
  evening?: boolean;
}

/** Longest task name shown in a reminder, in visible characters. */
export const MAX_REMINDER_TASK_CHARS = 60;

/**
 * The general wording: what every reminder said before 1.4. Still each
 * kind's title, and the words whenever there is nothing better to say (a set
 * day with nothing on it, a task with no readable name).
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

/** Longest title and body a scheduled reminder may carry, in visible characters. */
export const MAX_REMINDER_TITLE_CHARS = 90;
export const MAX_REMINDER_BODY_CHARS = 240;

/**
 * Any strategy's title or body made safe to schedule: one line, no control
 * characters or text-direction overrides, cut to `max` visible characters.
 * The scheduler runs every plan's words through this (fitPlanToLimit).
 */
export function cleanReminderText(text: unknown, max: number): string {
  return reminderTaskName(text, max);
}

/**
 * The name as the end of a sentence: no second full stop after "Call mom."
 * or a cut "…", and none after a trailing comma, semicolon or colon either
 * ("Buy milk," reads "Buy milk.").
 */
function sentence(name: string): string {
  if (/[.!?…]$/.test(name)) return name;
  const bare = name.replace(/[\s,;:]+$/u, "");
  return `${bare || name}.`;
}

/** A shorter cut for a name that shares a line with others. */
const LIST_NAME_CHARS = 28;

interface Named {
  name: string;
  id?: string;
}

/** What a line is written from. */
interface Words {
  /** The slot's own title ("A small nudge"). */
  slotTitle: string;
  /** The task named (cleaned). */
  name: string;
  /** The whole list, shortened and joined: "A · B · C". */
  list: string;
  /** "Today's three" when there are three, else "On today's list". */
  listLead: string;
  done: number;
  total: number;
}

type Line = (w: Words) => { title: string; body: string };

// The pools that have a whole-list line keep it at the same place (index 2)
// and are the same length, so two reminders in a row never both read out the
// list (see WHOLE_LIST).

// None done yet, more than one task.
const FIRST_UP: Line[] = [
  (w) => ({ title: w.name, body: "First up today. Five minutes is a start." }),
  (w) => ({ title: w.slotTitle, body: `First up: ${sentence(w.name)} A small start counts.` }),
  (w) => ({ title: w.slotTitle, body: `${w.listLead}: ${sentence(w.list)} Begin anywhere.` }),
  (w) => ({ title: w.slotTitle, body: `First up: ${sentence(w.name)} Just the first step.` }),
];

// None done yet, and it is the day's only task: never "first".
const ONE_THING: Line[] = [
  (w) => ({ title: w.slotTitle, body: `Today's one thing: ${sentence(w.name)} Five minutes is a start.` }),
  (w) => ({ title: w.slotTitle, body: `Just one today: ${sentence(w.name)} Begin anywhere.` }),
  (w) => ({ title: w.name, body: "Today's one thing. A small start counts." }),
];

// Some done, more than one still open.
const SOME_DONE: Line[] = [
  (w) => ({ title: `Next: ${w.name}`, body: `${w.done} of ${w.total} done.` }),
  (w) => ({ title: w.slotTitle, body: `${w.done} of ${w.total} done. Next: ${sentence(w.name)}` }),
  (w) => ({ title: `Next: ${w.name}`, body: `${w.done} done, ${w.total - w.done} to go.` }),
];

// Some done, one still open.
const ONE_LEFT: Line[] = [
  (w) => ({ title: `One to go: ${w.name}`, body: "A small finish is still a finish." }),
  (w) => ({ title: w.slotTitle, body: `One to go: ${sentence(w.name)} Five minutes is a start.` }),
  (w) => ({ title: w.slotTitle, body: `Just one left: ${sentence(w.name)}` }),
];

// The next reminder, in the evening.
const TONIGHT: Line[] = [
  (w) => ({ title: w.slotTitle, body: `Still open tonight: ${sentence(w.name)} Five minutes still counts.` }),
  (w) => ({ title: w.slotTitle, body: `Still open: ${sentence(w.name)} A small finish is still a finish.` }),
  (w) => ({ title: w.slotTitle, body: `No rush. If there's five minutes left today: ${sentence(w.name)}` }),
  (w) => ({ title: w.name, body: "Still open tonight. Five minutes still counts." }),
];

// Written well ahead (see `certain`): task first, present tense, and true
// whether or not it has been ticked since. The whole-list lines need two
// names or more (see WHOLE_LIST).
const LATER_TODAY: Line[] = [
  (w) => ({ title: w.name, body: "Still open? A small start counts." }),
  (w) => ({ title: w.slotTitle, body: `${sentence(w.name)} Still open? Five minutes is a start.` }),
  (w) => ({ title: w.slotTitle, body: `${w.listLead}: ${sentence(w.list)} Anything still open?` }),
  (w) => ({ title: w.slotTitle, body: `${sentence(w.name)} If it's still open, a small start counts.` }),
];

// The same, in the evening.
const LATER_TONIGHT: Line[] = [
  (w) => ({ title: w.slotTitle, body: `${sentence(w.name)} Still open tonight? Five minutes still counts.` }),
  (w) => ({ title: w.name, body: "No rush. If it's still open, a small finish is still a finish." }),
  (w) => ({ title: w.slotTitle, body: `${w.listLead}: ${sentence(w.list)} Anything still open tonight?` }),
  (w) => ({ title: w.slotTitle, body: `If there's five minutes left today: ${sentence(w.name)} No rush.` }),
];

/** The lines that say the whole list rather than one task. */
const WHOLE_LIST = new Set<Line>([FIRST_UP[2], LATER_TODAY[2], LATER_TONIGHT[2]]);

// Nothing picked today, something still open from the day before. `list` is
// those tasks ("A and B"), `total` how many.
const FROM_YESTERDAY: Line[] = [
  (w) => ({ title: "Still open from yesterday", body: `${sentence(w.name)} Want it in today's three?` }),
  (w) => ({ title: w.slotTitle, body: `Still open from yesterday: ${sentence(w.name)} It could be one of today's three.` }),
  (w) => ({ title: w.slotTitle, body: `${w.total} still open from yesterday: ${sentence(w.list)} Want them in today's three?` }),
  (w) => ({ title: "Still open from yesterday", body: `${sentence(w.name)} A small start today counts.` }),
];

// The same, written the evening before. `list` is "A · B".
const FROM_YESTERDAY_AHEAD: Line[] = [
  (w) => ({ title: w.slotTitle, body: `From yesterday: ${sentence(w.name)} Still open? It could be one of today's three.` }),
  (w) => ({ title: w.slotTitle, body: `From yesterday's list: ${sentence(w.name)} Want it in today's three?` }),
  (w) => ({ title: w.slotTitle, body: `Yesterday's list: ${sentence(w.list)} Anything to bring into today?` }),
];

/** The from-yesterday lines that say all of them (two or more). */
const ALL_OF_YESTERDAY = new Set<Line>([FROM_YESTERDAY[2], FROM_YESTERDAY_AHEAD[2]]);

// Nothing picked, nothing left over.
const NOTHING_PICKED: string[] = [
  "Nothing picked yet. What are today's three?",
  "Nothing picked yet. Three small things is plenty.",
  "A fresh page. What are today's three?",
  "Nothing picked yet. One is enough to begin.",
];

/**
 * With "Hide task names in notifications" on and something still open: lines
 * that name no task, a few for the day and a few for the evening, so a day's
 * reminders don't all read the same. Each slot takes the next one in turn.
 */
export const NAME_FREE_REMINDER_BODIES: { day: string[]; evening: string[] } = {
  day: [
    "Today's three are waiting when you are.",
    "A small start still counts.",
    "Five minutes is a start.",
    "Pick one of today's three and begin anywhere.",
  ],
  evening: [
    "A small finish is still a finish.",
    "No rush. Five minutes still counts.",
    "Still time for one of today's three.",
    "Today's three are here if there's time tonight.",
  ],
};

/** A small stable hash (FNV-1a), so a day's wording doesn't depend on the engine. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function slotNumber(slotIndex: number): number {
  return Number.isFinite(slotIndex) ? Math.max(0, Math.floor(slotIndex)) : 0;
}

/**
 * Which variant a slot uses: fixed for a day and the slot's place in that
 * day's whole schedule, and one step on from the slot before it, so two
 * reminders in a row never read the same.
 */
export function reminderVariantIndex(dayKey: string, slotIndex: number, count: number): number {
  if (count <= 1) return 0;
  return ((hash(dayKey) % count) + slotNumber(slotIndex)) % count;
}

/** "A", "A and B", "A, B and C". */
function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function readable(tasks: { text: string; id?: string }[]): Named[] {
  return tasks.map((task) => ({ name: reminderTaskName(task.text), id: task.id })).filter((task) => task.name.length > 0);
}

function shortNames(tasks: { text: string }[]): string[] {
  return tasks.map((task) => reminderTaskName(task.text, LIST_NAME_CHARS)).filter((name) => name.length > 0);
}

/**
 * The words for one reminder, or null when there is nothing to remind about
 * (everything picked is done). With `hideNames` no task text is in them:
 * the slot's own title over a name-free line (see NAME_FREE_REMINDER_BODIES).
 */
export function buildReminderCopy(input: ReminderCopyInput): ReminderCopy | null {
  const { kind, dayKey, slotIndex, tasks, locked, yesterdayOpen, hideNames, certain } = input;
  const evening = input.evening ?? kind === "evening";
  const generic = GENERIC_REMINDER_COPY[kind];
  const open = tasks.filter((task) => !task.done);
  if (tasks.length > 0 && open.length === 0) return null;

  const slot = slotNumber(slotIndex);
  const slotTitle = evening ? GENERIC_REMINDER_COPY.evening.title : generic.title;
  const pick = <T,>(variants: T[]): T => variants[reminderVariantIndex(dayKey, slot, variants.length)];

  if (tasks.length === 0) {
    // A set day takes nothing more, so there is nothing to offer.
    if (locked) return generic;
    // With names hidden, yesterday's tasks aren't named either.
    const left = hideNames ? [] : readable(yesterdayOpen.map((text) => ({ text })));
    if (left.length === 0) return { title: generic.title, body: pick(NOTHING_PICKED) };
    const pool = (certain ? FROM_YESTERDAY : FROM_YESTERDAY_AHEAD).filter(
      (line) => left.length > 1 || !ALL_OF_YESTERDAY.has(line),
    );
    const short = shortNames(yesterdayOpen.map((text) => ({ text })));
    // Each slot that names one of them takes the next in turn (the slots
    // that say them all don't use up a turn), starting from a different one
    // on different days.
    const first = reminderVariantIndex(dayKey, 0, pool.length);
    let turn = hash(dayKey) >>> 8;
    for (let earlier = 0; earlier < slot; earlier++) {
      if (!ALL_OF_YESTERDAY.has(pool[(first + earlier) % pool.length])) turn++;
    }
    turn %= left.length;
    return pick(pool)({
      slotTitle,
      name: left[turn].name,
      list: certain ? andList(short) : short.join(" · "),
      listLead: "",
      done: 0,
      total: left.length,
    });
  }

  if (hideNames) {
    return { title: slotTitle, body: pick(evening ? NAME_FREE_REMINDER_BODIES.evening : NAME_FREE_REMINDER_BODIES.day) };
  }
  const named = readable(open);
  if (named.length === 0) return generic;
  const list = shortNames(tasks);
  const done = tasks.length - open.length;
  // The next reminder names the next task (the first still open, in Today's
  // order); the ones written ahead take the open ones in turn.
  const task = certain ? named[0] : named[slot % named.length];
  const words: Words = {
    slotTitle,
    name: task.name,
    list: list.join(" · "),
    listLead: tasks.length === 3 ? "Today's three" : "On today's list",
    done,
    total: tasks.length,
  };
  const from = (lines: Line[]): ReminderCopy => {
    const pool = lines.filter((line) => list.length > 1 || !WHOLE_LIST.has(line));
    const line = pick(pool);
    const copy: ReminderCopy = line(words);
    // The whole-list lines name no single task.
    if (task.id && !WHOLE_LIST.has(line)) copy.taskId = task.id;
    return copy;
  };

  if (!certain) return from(evening ? LATER_TONIGHT : LATER_TODAY);
  if (evening) return from(TONIGHT);
  if (done === 0) return from(tasks.length === 1 ? ONE_THING : FIRST_UP);
  if (open.length === 1) return from(ONE_LEFT);
  return from(SOME_DONE);
}
