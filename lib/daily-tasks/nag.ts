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
/**
 * A nag's notification title: the app's name first, so "Mom" on a lock screen
 * can't be taken for a message from the user's mother.
 */
export function nagTitle(persona: NagPersona): string {
  return `Three Today \u00b7 ${NAG_PERSONA_LABELS[persona]}`;
}
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

// Invisible format characters: zero-width spaces and joiners, left-to-right
// and right-to-left marks, the bidi embeddings, overrides and isolates, the
// word joiner and its neighbours, the byte order mark and the soft hyphen.
// They can hide a word from a check or reverse how a line is drawn.
const FORMAT = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g;
// The zero-width non-joiner and joiner are part of how Persian and the Indic
// scripts are written, so between two letters of those scripts they stay in
// the text that is shown (Arabic to Sinhala, and the Arabic presentation
// forms; plain ranges, so the pattern runs on every engine). A joiner inside
// an emoji (a family, a flag with a rainbow) stays too. Anywhere else they
// go, and the checks never see them (withoutJoiners).
const JOINERS = /[\u200C\u200D]/g;
const JOINED_SCRIPT = /[\u0600-\u0DFF\uFB50-\uFDFF\uFE70-\uFEFC]/;
const EMOJI_START = /[\uD83C-\uD83E\u2600-\u27BF]/;

function withoutStrayJoiners(value: string): string {
  return value.replace(JOINERS, (joiner, at: number) => {
    const before = value.charAt(at - 1);
    const after = value.charAt(at + 1);
    if (JOINED_SCRIPT.test(before) && JOINED_SCRIPT.test(after)) return joiner;
    return joiner === "\u200D" && EMOJI_START.test(after) ? joiner : "";
  });
}

/** `value` as the checks read it: no joiners at all, so one can't hide a link. */
function withoutJoiners(value: string): string {
  return value.replace(JOINERS, "");
}

const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

/** One line of text: invisible format characters go, control characters become spaces, one space between words. */
function oneLine(value: string): string {
  return withoutStrayJoiners(value.replace(FORMAT, "")).replace(CONTROL, " ").replace(/\s+/g, " ").trim();
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
    // A bidi override or isolate in a line is dropped with the line, as on the proxy.
    if (BIDI.test(rawText)) return;
    const text = oneLine(rawText);
    if (!text || Array.from(text).length > MAX_NAG_LINE || LINK_PATTERN.test(withoutJoiners(text))) return;
    candidates.push({ step, position, taskIndex: taskIndex as number | null, text });
  });
  candidates.sort((a, b) => a.step - b.step || a.position - b.position);
  const limit = clampCount(count);
  const seen = new Set<string>();
  const lines: NagLine[] = [];
  for (const candidate of candidates) {
    if (lines.length >= limit) break;
    const key = withoutJoiners(candidate.text).toLowerCase();
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
  /**
   * Reserved, not used by the app: no caller passes a name, so none leaves
   * the phone (the privacy policy says so). The proxy still accepts one.
   */
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
 * Built-in lines per persona, by stage (early / mid / late) and by how hard
 * they push. Everyone gets `early`; `gentle` lines are all a Gentle day uses;
 * Firm adds the `firm` ones from the middle of the day; Relentless adds
 * `relentless` ones at the end.
 *
 * A stage is the step's place in the day's nags, not the hour: a day planned
 * at four in the afternoon starts with "early" lines. So no line names a
 * time of day (NAG_CLOCK_WORDS; a test checks every line).
 *
 * Same rules as the AI lines: needling with affection, about the task and the
 * nagging, never about the person. No insults, shame, threats, profanity,
 * fake urgency, advice, emoji or em dashes, and nothing that reads like a
 * real message from a real person ("it's your mother", "call me"). {task} is
 * the quoted task name (at most 40 characters), so a line with it is 74
 * characters or fewer and every line fits in NAG_BUILT_IN_MAX_CHARS.
 *
 * Each pool has enough general lines (no {task}) for a full day at every
 * level with task names hidden: early 6, mid 3 gentle and 3 firm, late 2
 * gentle, 3 firm and 2 relentless.
 */
export interface NagTemplates {
  early: readonly string[];
  mid: { gentle: readonly string[]; firm: readonly string[] };
  late: { gentle: readonly string[]; firm: readonly string[]; relentless: readonly string[] };
}

/** Words that say what time it is. No built-in line has one (whole words, any case). */
export const NAG_CLOCK_WORDS = [
  "morning",
  "mornings",
  "afternoon",
  "evening",
  "evenings",
  "tonight",
  "night",
  "nights",
  "midnight",
  "noon",
  "late",
  "early",
  "sunrise",
  "sunset",
  "sundown",
  "dawn",
  "dusk",
  "breakfast",
  "lunch",
  "dinner",
  "supper",
  "bedtime",
] as const;

export const NAG_TEMPLATES: Record<NagPersona, NagTemplates> = {
  mom: {
    early: [
      "Hello there. Just checking on {task}. No rush.",
      "Hi. Did {task} happen yet? Only asking.",
      "I'm not mad, I'm just asking. How's the list going?",
      "Have you eaten? Also, {task}. In that order is fine.",
      "Hello, you! Your list and I are both thinking of you.",
      "So, {task} is on today's list. I'm sure you knew.",
      "Just a little hello from your list. And from me.",
      "Have you had some water? Good. Now, about that list.",
      "I'm only peeking at your list. It looks very doable.",
      "No rush at all. The list is there when you're ready.",
    ],
    mid: {
      gentle: [
        "Just checking again. {task} is still on your list, that's all.",
        "No pressure. I just happened to think of {task}.",
        "I'm sure you're busy. A little time for the list, maybe?",
        "Still thinking about your list. Kindly, of course.",
        "One little tick would be lovely. Only if you have a minute.",
      ],
      firm: [
        "I don't want to nag, but {task} isn't going to do itself.",
        "I'm only looking. And I notice {task} is still open.",
        "I'm not saying anything. I'm just looking at your list. Hm.",
        "I don't want to nag. I'm going to, but I don't want to.",
        "The list is still open. I'm sure that's on purpose.",
      ],
    },
    late: {
      gentle: [
        "No hurry. There's still a little time for {task}.",
        "One small thing, then I'll hush: {task}.",
        "Whatever you get done today is fine by me. Truly.",
        "One more tick would make me smile. No pressure.",
      ],
      firm: [
        "I've asked nicely, more than once. {task}, please.",
        "I looked again and {task} is still sitting there.",
        "You know what would make my day? One more tick.",
        "I keep looking at your list. It keeps looking the same.",
        "I've asked so nicely. The list is still open. Hm.",
      ],
      relentless: [
        "I taught you to tie your shoes. You can manage ten minutes on {task}.",
        "I've put {task} on the fridge. With a magnet. That's where we are now.",
        "I'll just sit here with my tea, thinking about {task}.",
        "I've lost count of my reminders. Your list is still open.",
        "I've told the houseplants about your list. They're rooting for you.",
      ],
    },
  },
  spouse: {
    early: [
      "Hey you. Reminder from your other half: {task}.",
      "Hi, you. {task} is on today's list. Just saying.",
      "Not nagging. Reminding. Big difference. How's the list?",
      "Today's the day for {task}. I believe in you.",
      "Coffee first, then {task}. I know how you work.",
      "Today's list looks doable. Says me, your biggest fan.",
      "Just a friendly little poke about the list. That's all.",
      "Your list says hi. I say hi too, with more charm.",
      "I believe in you and your list. Mostly you.",
      "Pick any one to start. I'll cheer for whichever.",
    ],
    mid: {
      gentle: [
        "Thinking of you. Also thinking of {task}.",
        "Back again, as promised. {task} is still waiting for you.",
        "Small reminder, big smile. The list is still open.",
        "Still on your team. Still looking at your list.",
        "A gentle poke about the list, from your biggest fan.",
      ],
      firm: [
        "So. {task}. We talked about this. Well, I talked.",
        "You're great. {task} is still not done. Both things are true.",
        "This is reminder number several. The list hasn't moved.",
        "Ahem. The list. I say this with a raised eyebrow.",
        "I'm a fan of yours. The list is still open. Both feelings fit.",
      ],
    },
    late: {
      gentle: [
        "Hey, you. Still time for {task} if you're up for it.",
        "One quick thing while I have you: {task}.",
        "However today went, I'm on your team. One more tick?",
        "Whatever gets ticked today, I'm still on your side.",
      ],
      firm: [
        "I'm running out of polite ways to say {task}.",
        "Partner. Teammate. Fellow adult. {task}. Please.",
        "The list is still open. I checked. Twice.",
        "I'm running out of polite ways to mention your list.",
        "Attention, please. The list. That is the whole reminder.",
      ],
      relentless: [
        "I've started telling the cat about {task}. The cat is concerned.",
        "I'm writing a ballad about {task}. It has nine verses so far.",
        "Picture me in the doorway, arms folded, saying {task}.",
        "At this point your list is basically our third housemate.",
        "I've started humming a sad little song about your list.",
      ],
    },
  },
  coach: {
    early: [
      "Hey, champ. First play of the day: {task}.",
      "Warm-up's over. {task} is up. You've got this.",
      "Fresh start. Pick one thing and go.",
      "Game plan's simple today. Start with {task}.",
      "Good to see you. Let's get a first point on the board.",
      "Lace up. {task} is a great place to start.",
      "Huddle up. One task, one tick. That's the whole play.",
      "You showed up, and that counts. Now pick a task and go.",
      "Easy start, champ. One item, nice and smooth.",
      "Stretch, breathe, pick one. I like our chances.",
    ],
    mid: {
      gentle: [
        "Nice and steady. {task} is your next rep.",
        "Quick huddle: you're doing fine. {task} is still open.",
        "Halftime check. One small push on the list?",
        "Good pace, champ. One more rep on the list when you're ready.",
        "Water break's over. The list is ready when you are.",
      ],
      firm: [
        "Clock's running. {task} needs you on the field.",
        "No more stretching. Time to move on {task}.",
        "Eyes up. The list is still open and you're still in this.",
        "Time out's over. Back on the field, the list is waiting.",
        "I'm pointing at the list, champ. You know what that means.",
      ],
    },
    late: {
      gentle: [
        "Still time on the clock. {task}, nice and easy.",
        "One good rep on {task} and today counts.",
        "Whatever's left, finish at your own pace. Proud of the effort.",
        "One more tick and we call it a good game. Your pace.",
      ],
      firm: [
        "Fourth quarter. {task}. Leave it all out there.",
        "I need one more push. {task}. Right now.",
        "Whistle's about to blow. One more tick on the board.",
        "Dig in, champ. The list is still open and so is the game.",
        "One more push. That's all I'm asking. One tick.",
      ],
      relentless: [
        "I'm on the sideline waving both arms. {task}! Go, go, go!",
        "I've lost my voice yelling about {task}. Worth it. GO.",
        "Overtime. Crowd on its feet. All for {task}. Bring it home.",
        "I'm doing laps around your list. Please tick something.",
        "I'm blowing my whistle at a to-do list. That's where we are, champ.",
      ],
    },
  },
  drill: {
    early: [
      "Eyes front, recruit. Today's mission: {task}.",
      "Recruit! {task} is on the board. Carry on.",
      "Inspection time. The list is waiting, recruit.",
      "Mission briefing: {task}. Simple. Doable. Yours.",
      "Fall in, recruit. {task} reports for duty.",
      "Boots on, recruit. That list won't march itself.",
      "Attention, recruit. The list is standing by for orders.",
      "Formation check. One list, one recruit. Good odds.",
      "Recruit! Pick an item and move out. Any item.",
      "Orders of the day: tick something. That is all, recruit.",
    ],
    mid: {
      gentle: [
        "At ease, recruit. Just a reminder: {task}.",
        "Status check, recruit. {task} is still on the board.",
        "Steady march. One item at a time, recruit.",
        "Carry on, recruit. The list is still on the board.",
        "Good marching, recruit. Next item when ready.",
      ],
      firm: [
        "Recruit! {task} is still standing. Fix that.",
        "That list is not going to clear itself. MOVE, recruit.",
        "I want {task} done, and I want it done today.",
        "Recruit! That list is still open. I have NOTICED.",
        "The list has not moved, recruit. Neither have I.",
      ],
    },
    late: {
      gentle: [
        "Roll call. {task} is still present, recruit.",
        "One last patrol, recruit: {task}. Then stand down.",
        "Good effort today, recruit. Anything left can be quick.",
        "Final formation, recruit. One more tick, then at ease.",
      ],
      firm: [
        "RECRUIT. {task}. Double time.",
        "{task} is STILL on my board, recruit. I checked.",
        "I did not polish these boots to watch a list sit there. MOVE.",
        "RECRUIT. The list. Double time.",
        "I have inspected that list again. It is STILL open.",
      ],
      relentless: [
        "{task}! DROP AND GIVE ME TEN MINUTES, RECRUIT!",
        "I am YELLING at a to-do list. That's what {task} has done to me.",
        "That list is LAUGHING at us, recruit. Are we going to stand for that?",
        "I have saluted {task} for the last time. FINISH IT.",
        "I am doing push-ups next to your list, recruit. TICK SOMETHING.",
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

/**
 * The task's name inside a built-in line: one clean line, quoted, 40
 * characters at most. Punctuation at its end is left off, so a line never
 * reads “Fix the bike!”. or “Why is the sink leaking?”, please. The full stop
 * of an abbreviation that ends the name (“Email J.R.”) is kept.
 */
export function nagTaskName(text: string): string {
  const clean = oneLine(text);
  // "Call J.R." keeps its last full stop: it belongs to the initial.
  if (/\b[A-Za-z]\.$/.test(clean)) return quoteTask(clean);
  return quoteTask(clean.replace(/[\s.,;:!?\u2026]+$/, "") || clean);
}

/**
 * The day's lines without the AI: the same lines for the same seed (use the
 * date, so a day's reminders don't change between launches), a different mix
 * for another seed. Steps go early, mid, late in thirds; within a third the
 * mildest lines come first. Lines with {task} take the open tasks in turn.
 *
 * With a task to name, each third's lines name one, and a third with two or
 * more nags keeps exactly one general line: 3 of a Gentle day's 4 name a
 * task, 4 of Firm's 7 and 8 of Relentless's 11, and with two or three open
 * tasks each gets its turn.
 *
 * No line is used twice. With a task to name every level has `count` lines
 * (up to MAX_NAG_COUNT). With no usable task (names hidden) only the general
 * lines are used: enough for each level's own day (Gentle 4, Firm 7,
 * Relentless 11), fewer than a larger `count`.
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
    const need = perStage[stageIndex];
    // With a task to name, the stage's lines name one, except one general
    // line in a stage of two or more (so a day isn't the task's name eleven
    // times over). With none, every line is a general one.
    const naming = open.length === 0 ? 0 : need - (need >= 2 ? 1 : 0);
    const chosen = pools.map(() => new Set<string>());
    // Hottest pool first, so the level shows. A stage short of lines stays
    // short: an opening line is never borrowed for the end of the day.
    const take = (wanted: number, fits: (template: string) => boolean): number => {
      let left = wanted;
      pools.forEach((pool, poolIndex) => {
        for (const template of pool) {
          if (left <= 0) return;
          if (chosen[poolIndex].has(template) || !fits(template)) continue;
          chosen[poolIndex].add(template);
          left -= 1;
        }
      });
      return wanted - left;
    };
    const named = take(naming, (template) => template.includes("{task}"));
    const general = take(need - named, (template) => !template.includes("{task}"));
    // A pool short of one kind is topped up with the other.
    take(need - named - general, () => true);
    // Then the mildest goes first in the stage, each pool in its drawn order.
    pools
      .map((pool, poolIndex) => pool.filter((template) => chosen[poolIndex].has(template)))
      .reverse()
      .forEach((taken) => picked.push(...taken));
  });

  let turn = open.length > 0 ? Math.floor(random() * open.length) : 0;
  return picked.map((template, index) => {
    if (!template.includes("{task}")) return { step: index + 1, taskIndex: null, text: template };
    const task = open[turn % open.length];
    turn += 1;
    return { step: index + 1, taskIndex: task.from, text: template.replace("{task}", () => task.name) };
  });
}
