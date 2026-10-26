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

// "spouse" is shown as "Partner" (1.4.1). The id stays "spouse" in saved
// settings, the day's record, the proxy and analytics, so older saves and
// older proxies keep working. "dad" is new in 1.4.1: an older proxy refuses
// it (400, "Invalid persona") and the day keeps the built-in lines.
export const NAG_PERSONAS = ["mom", "dad", "spouse", "coach", "drill"] as const;
export type NagPersona = (typeof NAG_PERSONAS)[number];
export const NAG_LEVELS = ["gentle", "firm", "relentless"] as const;
export type NagLevel = (typeof NAG_LEVELS)[number];

export const NAG_PERSONA_LABELS: Record<NagPersona, string> = {
  mom: "Mom",
  dad: "Dad",
  spouse: "Partner",
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
  /** 1.5: times it was moved to another day (coach-memory.ts); sent so the AI names it more often. */
  moved?: number;
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

/**
 * 1.6 G: a line of the user's own (nag-own-lines.ts) cleaned as an AI line is:
 * one line, no invisible format characters (bidi marks and overrides
 * included), control characters as spaces.
 */
export function cleanNagText(value: string): string {
  return oneLine(value);
}

/** 1.6 G: `value` holds a link, read as the AI's lines are (LINK_PATTERN, joiners ignored). */
export function nagTextHasLink(value: string): boolean {
  return LINK_PATTERN.test(withoutJoiners(value));
}

function cut(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("").trim();
}

// Affection, for this one purpose: Nag mode's voices are comic nagging types
// and never say "I love you", use a pet name or send a hug, a kiss or a
// heart. The proxy refuses such lines (its blocklist is the real check, and
// much longer); this short copy is here because a batch fetched before that
// rule may still be in today's saved record on a phone, and an older proxy
// may still answer. Whole words, any case; "lovely" and "honeydew" pass.
// \b, lookahead and plain ranges only (no lookbehind, no \p), so it runs on
// Hermes. No bare "hon": it is a word in other languages. 1.4.1, with Dad:
// "kiddo", and "sport" said to someone (", sport" or "Sport,"), never the
// bare word ("Take up a sport").
const AFFECTION_WORDS =
  /\b(?:i love|love (?:you|ya|u)|luv|ily|with love|my love|(?:much|lots of|all my) love|ador(?:e|es|ed|ing)|sweetheart|sweetie|honey|babe|baby|darling|dearest|kiddo|hugs?|kiss(?:es)?|xoxo)\b|\blove(?=[,.!?]|$)|, (?:dear|sport)\b|\b(?:dear|sport),/gi;
// A declaration: never excused, not even when a task has the word "love" in it.
const AFFECTION_DECLARED = /\b(?:i|we) (?:love|adore) (?:you|u|ya)\b|\blove (?:you|ya|u)\b/i;
// Figures of speech that only look like affection ("I'd love to see one
// tick", "Oh dear", "Baby steps"). They are blanked before the words are
// looked for. "With love to..." is not one of them.
const AFFECTION_IDIOMS =
  /\b(?:(?:i'd|i would|you'll|you'd|would) love|(with |sending |my |much |of )?love (?:to|it if|how|the|that)|oh dear|dear me|baby steps?)\b/gi;
// Hearts, kisses, hugs and heart-eyed faces (the red heart with or without its variation selector).
const AFFECTION_EMOJI =
  /[\u2763\u2764\u2665]|\uD83D[\uDC8B\uDC8C\uDC8F\uDC91\uDC93-\uDC9F\uDDA4\uDE0D\uDE17-\uDE1A\uDE3B\uDE3D]|\uD83E[\uDD0D\uDD0E\uDD17\uDD70\uDDE1\uDE75-\uDE77]/;

const affectionFold = (value: string) => withoutJoiners(oneLine(value)).replace(/[\u2018\u2019]/g, "'").toLowerCase();
const withoutAffectionIdioms = (value: string) => value.replace(AFFECTION_IDIOMS, (idiom, sent?: string) => (sent ? idiom : "|"));
const lettersOf = (value: string) => value.match(/[a-z]+/g) ?? [];

/**
 * True when a line says something affectionate or intimate (see
 * AFFECTION_WORDS): a declaration, a pet name, a hug or a kiss, "love" or
 * "dear" said to someone ("Thanks, love.", "Yes, dear", "Dear, the list"),
 * a sign-off ("much love"). The user's own words don't count, as on the
 * proxy: a line may repeat a task called "Buy honey" or "Buy a gift for my
 * love". So each of `ownTexts` (the open tasks' text) is taken out of the
 * line whole, and what is found after that is excused when its words are
 * affection words of one of them. A declaration ("I love you", "love ya") is
 * never excused, and neither is a heart.
 */
export function isAffectionateNagLine(text: string, ownTexts: readonly string[] = []): boolean {
  if (AFFECTION_EMOJI.test(text)) return true;
  const folded = affectionFold(text);
  if (AFFECTION_DECLARED.test(folded)) return true;
  const own = ownTexts.map(affectionFold).filter(Boolean).sort((a, b) => b.length - a.length);
  let rest = folded;
  for (const value of own) rest = rest.split(value).join("|");
  const ownWords = new Set(own.flatMap((value) => value.match(AFFECTION_WORDS) ?? []).flatMap(lettersOf));
  return (withoutAffectionIdioms(rest).match(AFFECTION_WORDS) ?? []).some((found) => !lettersOf(found).every((word) => ownWords.has(word)));
}

// Tasks a joke doesn't belong next to: health, grief, money trouble, the law,
// losing a job. Whole words and phrases, any case; an entry ending in [a-z]*
// is a word's start ("oncolog" for oncologist and oncology). Deliberately
// wide ("wake", "court", "bill", "vet"): a task it catches by mistake only
// loses its name in the built-in lines. No bare "will". \b and plain ranges
// only, so it runs on Hermes.
const SENSITIVE_TASK =
  /\b(?:funeral|memorial|obituary|wake|hospice|hospital|oncolog[a-z]*|cancer|chemo[a-z]*|biopsy|surgery|surgeon|doctor|dr|clinic|therap[a-z]*|psychiatr[a-z]*|counsel[a-z]*|rehab|diagnos[a-z]*|medication|meds|prescription|grief|grieving|condolence[a-z]*|died|death|passed away|divorce|custody|lawyer|attorney|court|eviction|evicted|overdue|debt|rent|loan|mortgage|bankrupt[a-z]*|fired|layoff|laid off|redundan[a-z]*|resign[a-z]*|vet|miscarriage|pregnan[a-z]*|estate|probate|tax|taxes|irs|bill|bills|payment|insurance claim)\b/i;

/**
 * True when a task's words look sensitive (SENSITIVE_TASK). No built-in line
 * names such a task, whatever the voice, and on a day with one among the
 * open tasks the Drill sergeant has no rude line (builtInNagLines).
 */
export function nagTaskIsSensitive(text: string): boolean {
  return typeof text === "string" && SENSITIVE_TASK.test(withoutJoiners(oneLine(text)).replace(/[\u2018\u2019]/g, "'"));
}

// ---------------------------------------------------------------------------
// 1.6 G: an AI line names the task it is for, and only that one
// ---------------------------------------------------------------------------

/** A task long enough that a line may quote only its first words (names are cut near 40 characters). */
const NAG_NAME_CUT_AT = 40;
/** The shortest first words of a long task a line may quote. */
const NAG_NAME_MIN_PREFIX = 12;
/** A task's words found unquoted in a line count as naming it from this many characters. */
const NAG_NAME_MIN_MENTION = 4;
// Text in double quotes, curly or straight.
const QUOTED_NAME = /[\u201C"]([^\u201C\u201D"]{1,200})[\u201D"]/g;

// Emoji, their variation selectors and joiners (plain ranges: Hermes).
const NAME_EMOJI = /[\uD83C-\uD83E][\uDC00-\uDFFF]|[\u2600-\u27BF\uFE0F\u200D\u20E3]/g;

/** A name as the match reads it: one line, any case, accents off, straight apostrophes, no end punctuation. */
function foldName(value: string): string {
  return withoutJoiners(oneLine(value))
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    // Emoji don't count (the proxy may take one out of a line).
    .replace(NAME_EMOJI, " ")
    .replace(/\s+/g, " ")
    .replace(/(?:\.\.\.|[\s.,;:!?\u2026])+$/, "")
    .trim();
}

// Letters and digits of any script; punctuation (curly quotes, the ellipsis) is not one.
const isWordChar = (char: string) => char !== "" && /[a-z0-9\u00C0-\u1FFF\u2070-\uFFFF]/i.test(char);

/** `name` is in `folded` as whole words. */
function holdsWords(folded: string, name: string): boolean {
  for (let at = folded.indexOf(name); at !== -1; at = folded.indexOf(name, at + 1)) {
    if (!isWordChar(folded.charAt(at - 1)) && !isWordChar(folded.charAt(at + name.length))) return true;
  }
  return false;
}

/** A quoted name is this task: its words exactly (any case), or the first whole words of a long one. */
function quoteIsTask(quote: string, task: string): boolean {
  const q = foldName(quote);
  const t = foldName(task);
  if (!q || !t) return false;
  if (q === t) return true;
  // Cut mid-word only with an ellipsis ("“Pneumonoultra…”").
  const cut = /(?:\u2026|\.\.\.)\s*$/.test(quote);
  return Array.from(t).length > NAG_NAME_CUT_AT && Array.from(q).length >= NAG_NAME_MIN_PREFIX && t.startsWith(q) && (!isWordChar(t.charAt(q.length)) || cut);
}

/**
 * 1.6 G: an AI line reads right for the task it is attached to. A line for
 * task `taskIndex` names that task: it quotes its words (exactly, any case;
 * the first whole words of a task over 40 characters) or has its whole
 * words as they are. A paraphrase ("the walk" for "Walk 20 minutes") or no
 * name at all is not enough: the line is dropped, so a line written for
 * one task can't go out as another's or as a general one. It quotes no
 * other task and has no other task's words in it (outside its own task's
 * words). A general line
 * (`taskIndex` null) quotes no task and has none of their words. Task words
 * under four characters aren't looked for unquoted. The proxy runs the same
 * check (nagLineFitsTask in server/providers/nag-contract.mjs).
 */
export function nagLineFitsTask(text: string, taskIndex: number | null, taskTexts: readonly string[]): boolean {
  const quotes = Array.from(text.matchAll(QUOTED_NAME), (match) => match[1]);
  const mentions = (rest: string, task: string) => {
    const name = foldName(task);
    return Array.from(name).length >= NAG_NAME_MIN_MENTION && holdsWords(foldName(rest), name);
  };
  if (taskIndex === null) {
    return !quotes.some((quote) => taskTexts.some((task) => quoteIsTask(quote, task))) && !taskTexts.some((task) => mentions(text, task));
  }
  const own = taskTexts[taskIndex];
  if (typeof own !== "string") return false;
  // Named: quoted (as the prompt asks), or its whole words as they are. A
  // task with no words to look for (emoji only) can't be checked: let through.
  if (foldName(own) && !(quotes.some((quote) => quoteIsTask(quote, own)) || mentions(text, own))) return false;
  if (quotes.some((quote) => !quoteIsTask(quote, own) && taskTexts.some((task, index) => index !== taskIndex && quoteIsTask(quote, task)))) return false;
  // Another task's words, outside the quote of this one (and not part of this task's own words).
  const rest = text.replace(QUOTED_NAME, (whole, quote: string) => (quoteIsTask(quote, own) ? " | " : whole));
  const ownName = foldName(own);
  return !taskTexts.some((task, index) => index !== taskIndex && !ownName.includes(foldName(task)) && mentions(rest, task));
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
 * kept. An affectionate line is dropped too (isAffectionateNagLine; `ownTexts`
 * are the tasks that were sent, whose words are excused): the nag it was for
 * keeps its built-in line. No other blocklist runs here; that is the proxy's
 * job. What's left is ordered by step, renumbered 1..n and capped at `count`.
 */
export function parseNagResponse(
  data: unknown,
  { taskCount, count, ownTexts = [] }: { taskCount: number; count: number; ownTexts?: readonly string[] },
): NagLine[] {
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
    if (isAffectionateNagLine(text, ownTexts)) return;
    // 1.6 G: it names the task it is for, and no other (nagLineFitsTask).
    if (ownTexts.length > 0 && !nagLineFitsTask(text, taskIndex as number | null, ownTexts)) return;
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
  const sent: { text: string; from: number; moved: number }[] = [];
  tasks.forEach((task, from) => {
    const text = cut(oneLine(typeof task?.text === "string" ? task.text : ""), MAX_NAG_TASK_CHARS);
    const moved = typeof task?.moved === "number" && Number.isFinite(task.moved) ? Math.min(99, Math.max(0, Math.floor(task.moved))) : 0;
    if (text && sent.length < MAX_NAG_TASKS) sent.push({ text, from, moved });
  });
  if (sent.length === 0) throw new MomentumAiError("unavailable", "No open tasks to remind about.");
  const wanted = clampCount(count);
  const name = cut(oneLine(firstName ?? ""), MAX_NAG_NAME_CHARS);
  const data = await postToProxy({
    url,
    payload: {
      persona,
      level,
      // `moved` only when it was (1.5); an older proxy ignores it.
      tasks: sent.map(({ text, moved }) => ({ text, ...(moved > 0 ? { moved } : {}) })),
      count: wanted,
      ...(name ? { firstName: name } : {}),
    },
    ...(proxySecret !== undefined ? { proxySecret } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const lines = parseNagResponse(data, { taskCount: sent.length, count: wanted, ownTexts: sent.map(({ text }) => text) }).map((line) => ({
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
 * Same rules as the AI lines: annoying on purpose, about the task and the
 * nagging, never about the person. No insults, shame, threats, profanity,
 * fake urgency, advice, emoji or em dashes, and nothing that reads like a
 * real message from a real person ("it's your mother", "call me"). Nothing
 * affectionate or intimate either: Mom, Dad and Partner ("spouse") are the
 * classic nagging types (they repeat themselves, sigh, won't let it drop;
 * Dad is the dry, deadpan one with the dad jokes and the lectures that go
 * nowhere, and his disappointment is in the list, never in the person),
 * never a loving relative, so no line declares love or fondness, uses a pet name, or
 * mentions a hug, a kiss, a shared bed or a marriage (isAffectionateNagLine,
 * and the proxy's blocklist; tests check every line against both). One
 * exception to "never about the person": the Drill sergeant is sometimes
 * rude about the recruit's effort at Firm and Relentless (NAG_DRILL_RUDE),
 * always about the effort, the speed or the excuse and never about who the
 * person is. {task} is the quoted task name (at most 40 characters between
 * its quotation marks), and every line, name included, fits in
 * NAG_BUILT_IN_MAX_CHARS (a test checks every line).
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
      "I'm not mad, I'm just asking. Did {task} happen yet?",
      "Have you eaten? Good. Now, about {task}.",
      "I'm only mentioning {task} once. For now.",
      "So, {task} is on today's list. I'm sure you knew. I'm checking.",
      "I'm not nagging. I'm just asking. How's the list going?",
      "Have you had some water? Good. Now, about that list.",
      "I'm only peeking at your list. I'll be peeking again.",
      "Just a little hello from your list. And a little look from me.",
      "No rush. I'll only ask about the list a few more times.",
      "I looked at your list. I'm not saying anything. Yet.",
    ],
    mid: {
      gentle: [
        "Just checking again. {task} is still on your list, that's all.",
        "I don't like to repeat things. Anyway: {task}.",
        "I'm sure you're busy. I'm sure the list can tell.",
        "Still thinking about your list. Out loud, apparently.",
        "One little tick would be nice. I'm only saying. Again.",
      ],
      firm: [
        "I don't want to nag, but {task} isn't going to do itself.",
        "Don't mind me. I'll just keep bringing up {task}.",
        "I'm not saying anything. I'm just looking at your list. Hm.",
        "I don't want to nag. I'm going to, but I don't want to.",
        "The list is still open. I'm sure that's on purpose. Sigh.",
      ],
    },
    late: {
      gentle: [
        "One small thing, then I'll hush: {task}. I won't hush.",
        "I'm not mad about {task}. I'm just asking. Again.",
        "Whatever you get done today is fine. I'll still ask, mind you.",
        "One more tick and I'll stop asking. Probably.",
      ],
      firm: [
        "I've asked nicely, more than once. {task}, please.",
        "Did you do {task} yet? No? I'll wait. I won't, actually.",
        "I keep looking at your list. It keeps looking the same.",
        "I asked nicely. Then I asked again. Now I'm just asking.",
        "You know what would make my day? One tick. Just the one.",
      ],
      relentless: [
        "Do I have to come over there about {task}?",
        "I've put {task} on the fridge. With a magnet. That's where we are.",
        "Sigh. {task}. Still. I'll be here with my tea, sighing.",
        "I've lost count of my reminders. I'm starting the count over.",
        "I've told the houseplants about your list. Even the fern is sighing.",
      ],
    },
  },
  dad: {
    early: [
      "So. {task}. I'm not going to make a big thing of it. Yet.",
      "Just checking in on {task}. Carry on. I'll check in again. And again.",
      "I see {task} on the list. I'm just going to stand here and look at it.",
      "Funny thing about {task}. It doesn't do itself. I checked.",
      "I'm not saying anything about the list. I'm just adjusting the thermostat.",
      "Small list today. I've mowed bigger lawns. Still, a list is a list.",
      "I'd tell you a joke about the list, but it's still unfinished.",
      "I'm just going to leave this here. The list, I mean.",
      "The list has been open so long I can feel a draft.",
      "No pressure. I'll just be over here, quietly reading the list.",
    ],
    mid: {
      gentle: [
        "Checking in on {task} again. It's what I do.",
        "You know what goes great with {task}? A tick next to it.",
        "Not a word from me. Just a long, meaningful look at the list.",
        "The list and I had a little talk. It's still open.",
        "One tick. That's all. Then I'll go back to my lawn.",
      ],
      firm: [
        "I'm not mad, I'm just disappointed in the list. {task} is still on it.",
        "I didn't want to bring up {task} again. And yet here I am, bringing it up.",
        "Let me tell you about lists. Lists get ticked. That was the whole lecture.",
        "I'm going to sigh now. Not at you. At the list. Big sigh.",
        "This list has been open longer than the garage door. That's saying something.",
      ],
    },
    late: {
      gentle: [
        "Still on the list: {task}. I'm not going anywhere. I'm in my chair.",
        "Last thing about {task}, I promise. I promised that last time too.",
        "Whatever got done, good. The rest of the list is still here. So am I.",
        "One more tick and I'll stop hovering. I'll hover a little less.",
      ],
      firm: [
        "I've brought up {task} more times than I've adjusted the thermostat.",
        "We've talked about {task}. Well, I talked. The list just sat there.",
        "I'm not mad. I'm not even disappointed. I'm just reading the list. Again.",
        "This is the part where I take my glasses off and rub my eyes. The list.",
        "I've told the list all my best jokes. Not a single tick. Tough crowd.",
      ],
      relentless: [
        "My lecture about {task} has chapters now. We're on chapter four.",
        "I'm going to stand here and sigh about {task} until it's done.",
        "{task}, still. I've mowed the lawn twice just to have somewhere to sigh.",
        "I've started the lecture again from the top. One tick and it ends.",
        "The thermostat is set, the lawn is mowed, the gutters are clean. The list? Still open.",
      ],
    },
  },
  spouse: {
    early: [
      "Remember {task}? The thing I mentioned? I'm mentioning it.",
      "I'm not nagging. I'm reminding. {task}. See? A reminder.",
      "{task} is on today's list. Just saying. I'll say it again.",
      "Coffee first, then {task}. I'll be checking. Often.",
      "Not nagging. Reminding. Big difference. How's the list?",
      "Your list is open. I noticed. I notice things.",
      "Just a small poke about the list. The first of several.",
      "I'm sure you've seen the list. I'm mentioning it anyway.",
      "Start anywhere on the list. I'll be watching. Supportively.",
      "Fresh list. I'd rather not bring it up again. I will, though.",
    ],
    mid: {
      gentle: [
        "Back again, as promised. {task} is still waiting.",
        "Not to go on about it, but {task}. I'm going on about it.",
        "Small reminder, patient smile. The list is still open.",
        "Still on your team. Still looking at your list. Pointedly.",
        "Look at me, not saying anything about the list. Ahem.",
      ],
      firm: [
        "So. {task}. We talked about this. Well, I talked.",
        "No, no, take your time with {task}. I'll wait. Loudly.",
        "This is reminder number several. The list hasn't moved.",
        "Ahem. The list. I say this with a raised eyebrow.",
        "I'm not nagging. I'm reminding. Loudly.",
      ],
    },
    late: {
      gentle: [
        "One quick thing, and I know I've said it: {task}.",
        "Are you doing {task}, or are you 'about to' do it?",
        "However today went, I'm on your team. One more tick, though?",
        "I'll stop mentioning the list soon. Not yet. Soon.",
      ],
      firm: [
        "I'm running out of polite ways to say {task}.",
        "I put {task} on the list so I wouldn't have to say it. Here I am.",
        "The list is still open. I checked. Twice. Then once more.",
        "I'm not going to say it again. I'm saying it again: the list.",
        "Sigh. The list. That is the whole reminder.",
      ],
      relentless: [
        "I've mentioned {task} once. Twice. I've stopped counting. I haven't.",
        "I'm writing a ballad about {task}. It has nine verses so far.",
        "Fine. Leave {task}. See if I bring it up again. I will.",
        "I've started humming a sad little song about your list.",
        "I could recite your list from memory by now. Please tick one.",
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
      "Game face on. {task} is a great place to start.",
      "Huddle up. One task, one tick. That's the whole play.",
      "You showed up, and that counts. Now pick a task and go.",
      "Easy start, champ. One item, nice and smooth.",
      "Stretch, breathe, pick one. I like our chances.",
    ],
    mid: {
      gentle: [
        "Nice and steady. {task} is up next.",
        "Quick huddle: you're doing fine. {task} is still open.",
        "Halftime check. One small push on the list?",
        "Good pace, champ. One more rep on the list when you're ready.",
        "Water break's over. The list is ready when you are.",
      ],
      firm: [
        "Clock's running. {task} needs you on the field.",
        "No more stalling. Time to move on {task}.",
        "Eyes up. The list is still open and you're still in this.",
        "Time out's over. Back on the field, the list is waiting.",
        "I'm pointing at the list, champ. You know what that means.",
      ],
    },
    late: {
      gentle: [
        "Still time on the clock. {task}, nice and easy.",
        "One good push on {task} and today counts.",
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
      "Mission briefing: {task}. Doable. Yours.",
      "Fall in, recruit. On the board: {task}.",
      "Boots on, recruit. That list won't march itself.",
      "Attention, recruit. The list is standing by for orders.",
      "Formation check. One list, one recruit. Good odds.",
      "Recruit! Pick the next item and move out. Now.",
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
      // Three of the five are rude (see NAG_DRILL_RUDE).
      firm: [
        "Recruit! {task} is still open. Fix that.",
        "Is that the best you've got, maggot? {task} is STILL open.",
        "That list is not going to clear itself. MOVE, recruit.",
        "My boots have more hustle than you, slacker. The list. MOVE.",
        "You call that effort, cupcake? The list has not moved.",
      ],
    },
    late: {
      gentle: [
        "Roll call. {task}: still not ticked, recruit.",
        "One last patrol, recruit: {task}. Then stand down.",
        "Good effort today, recruit. Anything left can be quick.",
        "Final formation, recruit. One more tick, then at ease.",
      ],
      // Two of the five are rude.
      firm: [
        "{task} is STILL on my board, recruit. I checked.",
        "I've seen slugs with more urgency, recruit. {task}. NOW.",
        "I did not polish these boots to watch a list sit there. MOVE.",
        "RECRUIT. The list. Double time.",
        "Did I say you could rest, slacker? The list is STILL open.",
      ],
      // Four of the five are rude.
      relentless: [
        "{task}! DROP AND GIVE ME TEN MINUTES, MAGGOT!",
        "I've seen glaciers tick faster than you, recruit. {task}. MOVE.",
        "I am YELLING at a to-do list. That's what {task} has done to me.",
        "I've seen houseplants with more hustle. TICK SOMETHING, WORM.",
        "Pathetic effort, recruit. I've seen snails file paperwork faster. NOW.",
      ],
    },
  },
};

/**
 * What marks a Drill sergeant line as rude: the boot-camp contempt for the
 * recruit's effort, speed and excuses that this voice alone may use, and only
 * in its `firm` and `relentless` pools (never `early` or `gentle`, so a
 * Gentle day has none; a test checks every pool). About one line in three of
 * a Firm day and of a Relentless day come out rude, and every such day has
 * at least one (builtInNagLines sees to it). The insult is aimed at the
 * effort, never at who the person is: nothing about worth, intelligence,
 * body or anything else in the safety rules, and no swearing. None on a day
 * with a sensitive task among the open ones (nagTaskIsSensitive).
 */
export const NAG_DRILL_RUDE = /\b(?:maggot|worm|slacker|cupcake|slugs|glaciers|houseplants|pathetic|did i say you could rest)\b/i;

/** The Drill sergeant insults the recruit's effort at this level (Firm and Relentless; Settings says so). */
export function nagDrillGetsRude(persona: NagPersona, level: NagLevel): boolean {
  return persona === "drill" && level !== "gentle";
}

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
 *
 * A sensitive task (nagTaskIsSensitive) is never named, by any voice: it is
 * left out of the tasks the lines take in turn, and with nothing else open
 * the day has general lines only, as with names hidden. On a day with a
 * sensitive task among the open ones (one of `tasks`, or `sensitiveDay` when
 * the caller passes only some of the day's tasks) the Drill sergeant's rude
 * lines are left out of the pools. On any other Firm or Relentless day the
 * Drill sergeant has at least one rude line: when the draw gave none, a line
 * of the last third is exchanged for a rude one of the same kind.
 */
/**
 * The order tasks take turns in (indexes), each appearing `weights[i]` times
 * (a whole number from 1 to 3), spread out (smooth weighted round robin):
 * [3, 1, 1] gives 0, 1, 0, 2, 0. Equal weights give 0, 1, 2…, the plain
 * rotation.
 */
export function weightedTurns(weights: readonly number[]): number[] {
  const turns = weights.map((weight) => (Number.isFinite(weight) ? Math.min(3, Math.max(1, Math.round(weight))) : 1));
  const total = turns.reduce((sum, weight) => sum + weight, 0);
  const current = turns.map(() => 0);
  const order: number[] = [];
  for (let step = 0; step < total; step += 1) {
    let best = 0;
    turns.forEach((weight, index) => {
      current[index] += weight;
      if (current[index] > current[best]) best = index;
    });
    current[best] -= total;
    order.push(best);
  }
  return order;
}

export function builtInNagLines({
  persona,
  level,
  tasks,
  count,
  seed,
  sensitiveDay = false,
  weights,
}: {
  persona: NagPersona;
  level: NagLevel;
  tasks: NagTask[];
  count: number;
  seed: string | number;
  /** One of the day's open tasks is sensitive, also when it isn't among `tasks`. */
  sensitiveDay?: boolean;
  /**
   * 1.5: how many turns each of `tasks` gets (same order; 1 when absent) when
   * the lines that name a task are shared out, so a task moved more often is
   * named more often. All 1 (or none): the plain rotation, as before.
   */
  weights?: readonly number[];
}): NagLine[] {
  const wanted = clampCount(count);
  const random = seededRandom(`${seed}|${persona}|${level}`);
  const open: { name: string; from: number }[] = [];
  let sensitive = sensitiveDay;
  tasks.forEach((task, from) => {
    const text = oneLine(typeof task?.text === "string" ? task.text : "");
    if (!text) return;
    if (nagTaskIsSensitive(text)) sensitive = true;
    else if (open.length < MAX_NAG_TASKS) open.push({ name: nagTaskName(text), from });
  });
  const rudeDay = nagDrillGetsRude(persona, level) && !sensitive;
  const isRude = (template: string) => persona === "drill" && NAG_DRILL_RUDE.test(template);
  const usable = (template: string) => (open.length > 0 || !template.includes("{task}")) && (rudeDay || !isRude(template));

  // How many steps fall in each third of the day.
  const perStage = [0, 0, 0];
  for (let step = 0; step < wanted; step += 1) perStage[Math.min(2, Math.floor((3 * step) / wanted))] += 1;

  const picked: string[] = [];
  let rudePicked = false;
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
    const taken = () => pools.flatMap((pool, poolIndex) => pool.filter((template) => chosen[poolIndex].has(template)));
    // A rude day with no rude line so far gets one in its last third: a line
    // of the hottest pool gives its place to a rude one of the same kind.
    if (rudeDay && stage === "late" && !rudePicked && !taken().some(isRude)) {
      for (const out of pools[0].filter((template) => chosen[0].has(template))) {
        const rude = pools[0].find((template) => isRude(template) && template.includes("{task}") === out.includes("{task}"));
        if (!rude) continue;
        chosen[0].delete(out);
        chosen[0].add(rude);
        break;
      }
    }
    if (taken().some(isRude)) rudePicked = true;
    // Then the mildest goes first in the stage, each pool in its drawn order.
    pools
      .map((pool, poolIndex) => pool.filter((template) => chosen[poolIndex].has(template)))
      .reverse()
      .forEach((taken) => picked.push(...taken));
  });

  let turn = open.length > 0 ? Math.floor(random() * open.length) : 0;
  const order = weightedTurns(open.map((task) => weights?.[task.from] ?? 1));
  return picked.map((template, index) => {
    if (!template.includes("{task}")) return { step: index + 1, taskIndex: null, text: template };
    const task = open[order[turn % order.length]];
    turn += 1;
    return { step: index + 1, taskIndex: task.from, text: template.replace("{task}", () => task.name) };
  });
}
