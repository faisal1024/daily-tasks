// Nag mode (1.4, Plus, opt-in): reminder lines about today's open tasks in a
// persona's voice. Once a day the app asks the proxy for a batch
// (requestNagLines); when that fails or the phone is offline it uses the
// built-in lines below (builtInNagLines). Scheduling and the settings UI live
// elsewhere: this file is the contract and the fallback only.
//
// Pure except requestNagLines (fetch only), so it's unit-tested.

import { getMomentumAiProxyUrl, postToProxy, proxyRouteUrl } from "./ai-client";
import { MomentumAiError } from "./ai-status";
import { quoteTask } from "./coach-note";

export const NAG_PERSONAS = ["mom", "spouse", "coach", "drill"] as const;
export type NagPersona = (typeof NAG_PERSONAS)[number];
export const NAG_LEVELS = ["gentle", "firm", "relentless"] as const;
export type NagLevel = (typeof NAG_LEVELS)[number];

export const NAG_PERSONA_LABELS: Record<NagPersona, string> = {
  mom: "Mom",
  spouse: "Spouse",
  coach: "Coach",
  drill: "Drill sergeant",
};
export const NAG_LEVEL_LABELS: Record<NagLevel, string> = {
  gentle: "Gentle",
  firm: "Firm",
  relentless: "Relentless",
};

/** One reminder. `step` is 1 for the first nudge of the day, rising through the day. */
export interface NagLine {
  step: number;
  /** Index into the tasks given, or null for a line about the list in general. */
  taskIndex: number | null;
  text: string;
}

/** A task as nag lines see it (a store Task fits). */
export interface NagTask {
  text: string;
}

// The proxy's limits (server/providers/nag-contract.mjs); a test keeps them equal.
export const MAX_NAG_TASKS = 3;
export const MAX_NAG_TASK_CHARS = 120;
export const MAX_NAG_NAME_CHARS = 40;
export const MIN_NAG_COUNT = 4;
export const MAX_NAG_COUNT = 16;
/** A line over this is dropped whole (the proxy's cap too). */
export const MAX_NAG_LINE = 140;
/** Built-in lines stay within this, task name included. */
export const NAG_BUILT_IN_MAX_CHARS = 110;
/** Fewer usable AI lines than this counts as a failed answer. */
export const MIN_NAG_LINES = 3;

// C0/C1 control characters (newlines included) and the Unicode line separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
// Real links only (same pattern as the coach's note): a scheme URL, a "www."
// host, or an email.
const LINK_PATTERN = /\bhttps?:\/\/|\bwww\.|[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/** One line of text: control characters become spaces, one space between words. */
function oneLine(value: string): string {
  return value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

function cut(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("").trim();
}

function clampCount(count: number): number {
  const whole = Number.isFinite(count) ? Math.floor(count) : MIN_NAG_COUNT;
  return Math.min(Math.max(whole, MIN_NAG_COUNT), MAX_NAG_COUNT);
}

/**
 * The proxy's answer, checked again on the phone (never trust the wire):
 * control characters become spaces; a line is dropped when its shape is
 * wrong, its text is empty, over MAX_NAG_LINE or holds a link, its taskIndex
 * isn't null or an index below `taskCount`, or the same text was already
 * kept. What's left is ordered by step, renumbered 1..n and capped at `count`.
 */
export function parseNagResponse(data: unknown, { taskCount, count }: { taskCount: number; count: number }): NagLine[] {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(record.lines) ? record.lines : [];
  const candidates: { step: number; position: number; taskIndex: number | null; text: string }[] = [];
  list.forEach((item: unknown, position: number) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const { step, taskIndex, text: rawText } = item as { step?: unknown; taskIndex?: unknown; text?: unknown };
    if (typeof step !== "number" || !Number.isFinite(step) || typeof rawText !== "string") return;
    if (taskIndex !== null && !(typeof taskIndex === "number" && Number.isInteger(taskIndex) && taskIndex >= 0 && taskIndex < taskCount)) {
      return;
    }
    const text = oneLine(rawText);
    if (!text || Array.from(text).length > MAX_NAG_LINE || LINK_PATTERN.test(text)) return;
    candidates.push({ step, position, taskIndex: taskIndex as number | null, text });
  });
  candidates.sort((a, b) => a.step - b.step || a.position - b.position);
  const limit = clampCount(count);
  const seen = new Set<string>();
  const lines: NagLine[] = [];
  for (const candidate of candidates) {
    if (lines.length >= limit) break;
    const key = candidate.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ step: lines.length + 1, taskIndex: candidate.taskIndex, text: candidate.text });
  }
  return lines;
}

export interface NagRequestInput {
  persona: NagPersona;
  level: NagLevel;
  /** Today's open tasks; the first three with any text are sent. */
  tasks: NagTask[];
  /** How many lines to ask for (4 to 16; clamped). */
  count: number;
  firstName?: string | null;
}

/**
 * Ask the proxy for the day's lines. Throws MomentumAiError on any failure
 * (no proxy, offline, timeout, 402, 5xx, or fewer than MIN_NAG_LINES usable
 * lines): the caller then uses builtInNagLines. `taskIndex` in the result
 * points into the `tasks` passed in.
 */
export async function requestNagLines({
  persona,
  level,
  tasks,
  count,
  firstName = null,
  planUrl = getMomentumAiProxyUrl(),
  proxySecret,
  timeoutMs,
  fetchImpl,
}: NagRequestInput & {
  planUrl?: string | null;
  proxySecret?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ lines: NagLine[] }> {
  const url = proxyRouteUrl(planUrl, "nag-lines");
  if (!url) throw new MomentumAiError("unavailable", "Nag lines aren't available.");
  // Tasks with no text are left out, so remember where each sent one came from.
  const sent: { text: string; from: number }[] = [];
  tasks.forEach((task, from) => {
    const text = cut(oneLine(typeof task?.text === "string" ? task.text : ""), MAX_NAG_TASK_CHARS);
    if (text && sent.length < MAX_NAG_TASKS) sent.push({ text, from });
  });
  if (sent.length === 0) throw new MomentumAiError("unavailable", "No open tasks to remind about.");
  const wanted = clampCount(count);
  const name = cut(oneLine(firstName ?? ""), MAX_NAG_NAME_CHARS);
  const data = await postToProxy({
    url,
    payload: {
      persona,
      level,
      tasks: sent.map(({ text }) => ({ text })),
      count: wanted,
      ...(name ? { firstName: name } : {}),
    },
    ...(proxySecret !== undefined ? { proxySecret } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const lines = parseNagResponse(data, { taskCount: sent.length, count: wanted }).map((line) => ({
    ...line,
    taskIndex: line.taskIndex === null ? null : sent[line.taskIndex].from,
  }));
  if (lines.length < MIN_NAG_LINES) {
    throw new MomentumAiError("invalid_response", "Nag lines came back empty.");
  }
  return { lines };
}

// ---------------------------------------------------------------------------
// Built-in lines
// ---------------------------------------------------------------------------

/**
 * Built-in lines per persona, by time of day (early / mid / late) and by how
 * hard they push. Everyone gets `early`; `gentle` lines are all a Gentle day
 * uses; Firm adds the `firm` ones from the middle of the day; Relentless adds
 * `relentless` ones at the end.
 *
 * Same rules as the AI lines: needling with affection, about the task and the
 * nagging, never about the person. No insults, shame, threats, profanity,
 * fake urgency, advice, emoji or em dashes. {task} is the quoted task name
 * (at most 40 characters), so a line with it is 74 characters or fewer and
 * every line fits in NAG_BUILT_IN_MAX_CHARS.
 */
export interface NagTemplates {
  early: readonly string[];
  mid: { gentle: readonly string[]; firm: readonly string[] };
  late: { gentle: readonly string[]; firm: readonly string[]; relentless: readonly string[] };
}

export const NAG_TEMPLATES: Record<NagPersona, NagTemplates> = {
  mom: {
    early: [
      "Morning, sweetheart. Just checking on {task}. No rush.",
      "Hi honey, it's me. Did {task} happen yet? Only asking.",
      "I'm not mad, I'm just asking. How's the list going?",
      "Have you eaten? Also, {task}. In that order is fine.",
      "Good morning! Your list and I are both thinking of you.",
      "Sweetheart, {task} is on today's list. I'm sure you knew.",
    ],
    mid: {
      gentle: [
        "Me again. {task} is still on your list, that's all.",
        "No pressure, sweetie. I just happened to think of {task}.",
        "I'm sure you're busy. A little time for the list, maybe?",
      ],
      firm: [
        "I don't want to nag, but {task} isn't going to do itself.",
        "It's your mother. I notice {task} is still open.",
        "I'm not saying anything. I'm just looking at your list. Hm.",
      ],
    },
    late: {
      gentle: [
        "Day's winding down, honey. Still a little time for {task}.",
        "One small thing before you rest: {task}. Then I'll hush.",
        "Whatever you get done tonight is fine by me. Truly.",
      ],
      firm: [
        "I've asked nicely all day. {task}, please, sweetheart.",
        "It's getting late and {task} is still sitting there.",
        "You know what would make my evening? One more tick.",
      ],
      relentless: [
        "I carried you for nine months. Carry {task} for ten minutes.",
        "I'm lighting a candle for {task}. That's where we are now.",
        "I'll just sit here in the dark, thinking about {task}.",
        "This is my ninth message. I counted. Your list is still open.",
      ],
    },
  },
  spouse: {
    early: [
      "Hey you. Loving reminder from your better half: {task}.",
      "Morning, love. {task} is on today's list. Just saying.",
      "Not nagging. Reminding. With love. How's the list?",
      "Today's the day for {task}. I believe in you.",
      "Coffee first, then {task}. I know how you work.",
      "Today's list looks doable. Says me, your biggest fan.",
    ],
    mid: {
      gentle: [
        "Thinking of you. Also thinking of {task}.",
        "Me again, with love. {task} is still waiting for you.",
        "Small reminder, big hug. The list is still open.",
      ],
      firm: [
        "Babe. {task}. We talked about this. Well, I talked.",
        "I love you. {task} is still not done. Both things are true.",
        "This is reminder number several. The list hasn't moved.",
      ],
    },
    late: {
      gentle: [
        "Evening, love. Still time for {task} if you're up for it.",
        "One quick thing before we call it a day: {task}.",
        "However today went, I'm on your team. One more tick?",
      ],
      firm: [
        "I'm running out of cute ways to say {task}.",
        "Love of my life. Light of my days. {task}. Please.",
        "The day's nearly done and the list is still open, dear.",
      ],
      relentless: [
        "I've started telling the cat about {task}. The cat is concerned.",
        "I'm writing a ballad about {task}. It has nine verses so far.",
        "Picture me in the doorway, arms folded, saying {task}.",
        "At this point your list is basically our third housemate.",
      ],
    },
  },
  coach: {
    early: [
      "Good morning, champ. First play of the day: {task}.",
      "Warm-up's over. {task} is up. You've got this.",
      "New day, fresh start. Pick one thing and go.",
      "Game plan's simple today. Start with {task}.",
      "Good to see you. Let's get an early point on the board.",
      "Lace up. {task} is a great place to start.",
    ],
    mid: {
      gentle: [
        "Nice and steady. {task} is your next rep.",
        "Quick huddle: you're doing fine. {task} is still open.",
        "Halftime check. One small push on the list?",
      ],
      firm: [
        "Clock's running. {task} needs you on the field.",
        "No more stretching. Time to move on {task}.",
        "Eyes up. The list is still open and you're still in this.",
      ],
    },
    late: {
      gentle: [
        "Late in the game, still time. {task}, nice and easy.",
        "One good rep on {task} and today counts.",
        "Whatever's left, finish at your own pace. Proud of the effort.",
      ],
      firm: [
        "Fourth quarter. {task}. Leave it all out there.",
        "I need one more push. {task}. Right now.",
        "Whistle's about to blow. One more tick on the board.",
      ],
      relentless: [
        "I'm on the sideline waving both arms. {task}! Go, go, go!",
        "I've lost my voice yelling about {task}. Worth it. GO.",
        "Overtime. Crowd on its feet. All for {task}. Bring it home.",
        "I'm doing laps around your list. Please tick something.",
      ],
    },
  },
  drill: {
    early: [
      "Rise and shine, recruit. Today's mission: {task}.",
      "Recruit! {task} is on the board. Carry on.",
      "Morning inspection. The list is waiting, recruit.",
      "Mission briefing: {task}. Simple. Doable. Yours.",
      "Fall in, recruit. {task} reports for duty.",
      "Boots on, recruit. That list won't march itself.",
    ],
    mid: {
      gentle: [
        "At ease, recruit. Just a reminder: {task}.",
        "Status check, recruit. {task} is still on the board.",
        "Steady march. One item at a time, recruit.",
      ],
      firm: [
        "Recruit! {task} is still standing. Fix that.",
        "That list is not going to clear itself. MOVE, recruit.",
        "I want {task} done, and I want it done today.",
      ],
    },
    late: {
      gentle: [
        "Evening roll call. {task} is still present, recruit.",
        "One last patrol, recruit: {task}. Then stand down.",
        "Good effort today, recruit. Anything left can be quick.",
      ],
      firm: [
        "RECRUIT. {task}. Double time.",
        "Sun's going down and {task} is STILL on my board.",
        "I did not get up this early to watch a list sit there. MOVE.",
      ],
      relentless: [
        "{task}! DROP AND GIVE ME TEN MINUTES, RECRUIT!",
        "I am YELLING at a to-do list. That's what {task} has done to me.",
        "That list is LAUGHING at us, recruit. Are we going to stand for that?",
        "I have saluted {task} for the last time. FINISH IT.",
      ],
    },
  },
};

type NagStage = "early" | "mid" | "late";
const STAGES: readonly NagStage[] = ["early", "mid", "late"];

/**
 * The pools a level may draw from at a stage, hottest first. A level never
 * reaches above itself: Gentle only ever sees `early` and `gentle` lines.
 */
export function nagPools(persona: NagPersona, level: NagLevel, stage: NagStage): (readonly string[])[] {
  const templates = NAG_TEMPLATES[persona];
  if (stage === "early") return [templates.early];
  if (stage === "mid") return level === "gentle" ? [templates.mid.gentle] : [templates.mid.firm, templates.mid.gentle];
  if (level === "gentle") return [templates.late.gentle];
  if (level === "firm") return [templates.late.firm, templates.late.gentle];
  return [templates.late.relentless, templates.late.firm, templates.late.gentle];
}

/** Small seeded generator (mulberry32 over a string hash): same seed, same lines. */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619) >>> 0;
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

/** The task's name inside a built-in line: one clean line, quoted, 40 characters at most. */
export function nagTaskName(text: string): string {
  return quoteTask(oneLine(text));
}

/**
 * The day's lines without the AI: the same lines for the same seed (use the
 * date, so a day's reminders don't change between launches), a different mix
 * for another seed. Steps go early, mid, late in thirds; within a third the
 * mildest lines come first. Lines with {task} take the open tasks in turn.
 *
 * No line is used twice, so a long Gentle day can return fewer than `count`
 * (10 or more once `count` passes 10; Firm and Relentless always have
 * `count`). With no usable task only the general lines are used, which is
 * fewer still.
 */
export function builtInNagLines({
  persona,
  level,
  tasks,
  count,
  seed,
}: {
  persona: NagPersona;
  level: NagLevel;
  tasks: NagTask[];
  count: number;
  seed: string | number;
}): NagLine[] {
  const wanted = clampCount(count);
  const random = seededRandom(`${seed}|${persona}|${level}`);
  const open: { name: string; from: number }[] = [];
  tasks.forEach((task, from) => {
    const text = oneLine(typeof task?.text === "string" ? task.text : "");
    if (text && open.length < MAX_NAG_TASKS) open.push({ name: nagTaskName(text), from });
  });
  const usable = (template: string) => open.length > 0 || !template.includes("{task}");

  // How many steps fall in each third of the day.
  const perStage = [0, 0, 0];
  for (let step = 0; step < wanted; step += 1) perStage[Math.min(2, Math.floor((3 * step) / wanted))] += 1;

  const picked: string[] = [];
  STAGES.forEach((stage, stageIndex) => {
    const pools = nagPools(persona, level, stage).map((pool) => shuffled(pool.filter(usable), random));
    let need = perStage[stageIndex];
    // Hottest pool first, so the level shows; then the mildest goes first in
    // the stage. A stage short of lines stays short: a morning line is never
    // borrowed for the evening.
    const byHeat = pools.map((pool) => {
      const taken = pool.slice(0, need);
      need -= taken.length;
      return taken;
    });
    picked.push(...byHeat.reverse().flat());
  });

  let turn = open.length > 0 ? Math.floor(random() * open.length) : 0;
  return picked.map((template, index) => {
    if (!template.includes("{task}")) return { step: index + 1, taskIndex: null, text: template };
    const task = open[turn % open.length];
    turn += 1;
    return { step: index + 1, taskIndex: task.from, text: template.replace("{task}", task.name) };
  });
}
