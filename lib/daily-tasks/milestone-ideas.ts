// Suggestions for the next open milestone on the goal path (1.4).
//
// Pure and free of react-native imports. Free users get the built-in
// suggestions below (no AI, nothing leaves the device); Plus users get the AI
// suggestions the plan marked for the milestone, and fall back to the built-in
// ones whenever there are none (old server, AI failure, a path that changed
// since the plan was made).

import { nextIncompleteMilestone, pathSourceOf } from "./milestones";
import type { GeneratedTask, MomentumMilestone, MomentumPlan } from "./types";

/** A task's text limit (validateGeneratedTasks, MAX_TASK_TEXT). */
const MAX_IDEA_TEXT = 64;
/** At most this many suggestions in the milestone group. */
export const MAX_MILESTONE_IDEAS = 2;
const MAX_KEY = 240;

export interface MilestoneIdea {
  id: string;
  text: string;
  estimatedMinutes: number;
}

export type MilestoneIdeaSource = "ai" | "local";

export interface MilestoneIdeaGroup {
  milestoneId: string;
  /** The milestone's title, shown under the group header. */
  title: string;
  source: MilestoneIdeaSource;
  ideas: MilestoneIdea[];
}

const textKey = (text: string) => text.trim().toLowerCase();

/**
 * Identifies a milestone as it reads right now. The title is part of it: ids
 * are positional and survive an edit or a fresh path, so an AI suggestion made
 * for "Run 1 km" must stop counting once that step says something else.
 */
export function milestoneKey(milestone: Pick<MomentumMilestone, "id" | "title">): string {
  return `${milestone.id}|${textKey(milestone.title).replace(/\s+/g, " ")}`.slice(0, MAX_KEY);
}

// The title leads and a small, concrete action follows, so the line reads as
// a task on today's list. Each line's minutes match what the line says.
const TEMPLATES: { minutes: number; action: string }[] = [
  { minutes: 10, action: "10 easy minutes" },
  { minutes: 5, action: "do the first small step" },
  { minutes: 15, action: "15 focused minutes" },
  { minutes: 5, action: "plan the next small step" },
];
const SEPARATOR = ": ";

const inRange = (code: number, from: number, to: number) => code >= from && code <= to;
/** A code point that belongs to the character before it (accent, variation, skin tone, tag). */
const joinsPrevious = (code: number) =>
  inRange(code, 0x0300, 0x036f) ||
  inRange(code, 0x1ab0, 0x1aff) ||
  inRange(code, 0x1dc0, 0x1dff) ||
  inRange(code, 0x20d0, 0x20ff) ||
  inRange(code, 0xfe00, 0xfe0f) ||
  inRange(code, 0xfe20, 0xfe2f) ||
  inRange(code, 0x1f3fb, 0x1f3ff) ||
  inRange(code, 0xe0020, 0xe007f) ||
  code === 0x200d;
const isFlagHalf = (code: number) => inRange(code, 0x1f1e6, 0x1f1ff);

/**
 * The text as whole characters the way a person sees them (an emoji with its
 * skin tone, a letter with its accent), so a cut never leaves half of one.
 * Uses Intl.Segmenter where the engine has it; otherwise a small built-in rule.
 */
export function splitGraphemes(text: string, useIntl = true): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: object) => {
    segment(input: string): Iterable<{ segment: string }>;
  } }).Segmenter;
  if (useIntl && typeof Segmenter === "function") {
    try {
      return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
    } catch {
      // Fall through to the built-in rule.
    }
  }
  const out: string[] = [];
  let flagHalves = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const last = out.length - 1;
    const afterJoiner = last >= 0 && out[last].endsWith("\u200d");
    const secondFlagHalf = isFlagHalf(code) && flagHalves % 2 === 1;
    flagHalves = isFlagHalf(code) ? flagHalves + 1 : 0;
    if (last >= 0 && (joinsPrevious(code) || afterJoiner || secondFlagHalf)) out[last] += char;
    else out.push(char);
  }
  return out;
}

/** The start of `text` that fits `max` UTF-16 units, cut between whole characters. */
export function cutGraphemes(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const part of splitGraphemes(text)) {
    if (out.length + part.length > max) break;
    out += part;
  }
  return out;
}

const TRAILING_PUNCTUATION = /[\s.,;:!?\-–—]+$/;

/** One line, no quote marks, no closing punctuation, cut at a word with an ellipsis if long. */
export function shortMilestoneTitle(title: string, max: number): string {
  const clean = title
    .replace(/["“”«»]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(TRAILING_PUNCTUATION, "");
  if (clean.length <= max) return clean;
  const cut = cutGraphemes(clean, Math.max(1, max - 1));
  const lastSpace = cut.lastIndexOf(" ");
  const atWord = lastSpace >= cut.length / 2 ? cut.slice(0, lastSpace) : cut;
  return `${atWord.replace(TRAILING_PUNCTUATION, "")}…`;
}

/** Small stable hash (FNV-1a), so the same day and milestone give the same lines. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Built-in suggestions for a milestone: every template, starting from one
 * picked by the day (so the pair changes from day to day but not within one).
 * Callers take the first few they can use.
 *
 * `lead` is what the line opens with: the milestone's title, or the goal's
 * title for a starter path (its steps, like "Start small", say nothing about
 * the goal on their own).
 */
export function localMilestoneIdeas(
  milestone: Pick<MomentumMilestone, "id" | "title">,
  today: string,
  lead: string = milestone.title,
): MilestoneIdea[] {
  const opener = shortMilestoneTitle(lead, MAX_IDEA_TEXT) ? lead : milestone.title;
  if (!shortMilestoneTitle(opener, MAX_IDEA_TEXT)) return [];
  const start = hash(`${today}|${milestone.id}`) % TEMPLATES.length;
  return TEMPLATES.map((_, offset) => {
    const index = (start + offset) % TEMPLATES.length;
    const template = TEMPLATES[index];
    const room = MAX_IDEA_TEXT - SEPARATOR.length - template.action.length;
    return {
      id: `milestone_local_${index}`,
      text: `${shortMilestoneTitle(opener, room)}${SEPARATOR}${template.action}`,
      estimatedMinutes: template.minutes,
    };
  });
}

/**
 * The milestone a plan request should name, or null. Not with a fresh path,
 * and not while the path is still the starter one: the AI's first plan
 * replaces that path, so ideas made for its first step would aim at a step
 * that is about to go.
 */
export function milestoneToAskAbout(
  plan: MomentumPlan | null,
  completedMilestoneIds: string[],
  newPath = false,
): MomentumMilestone | null {
  if (!plan || newPath || pathSourceOf(plan) === "template") return null;
  return nextIncompleteMilestone(plan.milestones, completedMilestoneIds);
}

/**
 * After a plan is stored: keep a suggestion's milestone mark only when it
 * names the first open milestone of the path as it is now. The path a plan
 * was requested for may not be the one that ends up stored (a starter path
 * upgraded, a fresh path, an edit while the request was out), and a mark for
 * a step that is gone must not show under another one.
 */
export function settleMilestoneMarks(plan: MomentumPlan, completedMilestoneIds: string[]): MomentumPlan {
  if (!plan.todaySuggestions.some((task) => task.milestoneKey !== undefined)) return plan;
  const next = nextIncompleteMilestone(plan.milestones, completedMilestoneIds);
  const key = next ? milestoneKey(next) : null;
  if (plan.todaySuggestions.every((task) => task.milestoneKey === undefined || task.milestoneKey === key)) return plan;
  return {
    ...plan,
    todaySuggestions: plan.todaySuggestions.map((task) => {
      if (task.milestoneKey === undefined || task.milestoneKey === key) return task;
      const { milestoneKey: _stale, ...rest } = task;
      return rest;
    }),
  };
}

/**
 * The "Next on your path" group for the Ideas sheet, or null when there
 * is no path, every milestone is reached, or nothing usable is left.
 *
 * - AI: today's suggestions the plan marked for this exact milestone.
 * - Otherwise the built-in ones, skipping any that repeat another idea or a
 *   routine already listed in the sheet.
 * A suggestion already on today's list stays (the sheet shows it as added,
 * like any other idea).
 */
export function buildMilestoneIdeaGroup(params: {
  milestones: MomentumMilestone[];
  completedMilestoneIds: string[];
  /** Local date key (YYYY-MM-DD). */
  today: string;
  /** The plan's suggestions for today (AI or template). */
  suggestions?: GeneratedTask[];
  /** Texts listed elsewhere in the sheet without a milestone mark (routines due today, starter ideas). */
  otherTexts?: Iterable<string>;
  /** The goal's title when the path is still the starter one: the built-in lines open with it. */
  starterGoalTitle?: string | null;
}): MilestoneIdeaGroup | null {
  const milestone = nextIncompleteMilestone(params.milestones, params.completedMilestoneIds);
  if (!milestone) return null;
  const suggestions = params.suggestions ?? [];
  const key = milestoneKey(milestone);
  const taken = new Set<string>();
  for (const text of params.otherTexts ?? []) taken.add(textKey(text));

  const ai = suggestions
    .filter((task) => task.source === "ai" && task.milestoneKey === key && !taken.has(textKey(task.text)))
    .slice(0, MAX_MILESTONE_IDEAS)
    .map((task) => ({ id: task.id, text: task.text, estimatedMinutes: task.estimatedMinutes }));
  if (ai.length > 0) {
    return { milestoneId: milestone.id, title: milestone.title, source: "ai", ideas: ai };
  }

  for (const task of suggestions) taken.add(textKey(task.text));
  const local = localMilestoneIdeas(milestone, params.today, params.starterGoalTitle || milestone.title)
    .filter((idea) => !taken.has(textKey(idea.text)))
    .slice(0, MAX_MILESTONE_IDEAS);
  if (local.length === 0) return null;
  return { milestoneId: milestone.id, title: milestone.title, source: "local", ideas: local };
}
