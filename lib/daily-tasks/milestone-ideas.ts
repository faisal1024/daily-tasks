// Suggestions for the next open milestone on the goal path (1.4).
//
// Pure and free of react-native imports. Free users get the built-in
// suggestions below (no AI, nothing leaves the device); Plus users get the AI
// suggestions the plan marked for the milestone, and fall back to the built-in
// ones whenever there are none (old server, AI failure, a path that changed
// since the plan was made).

import { nextIncompleteMilestone } from "./milestones";
import type { GeneratedTask, MomentumMilestone } from "./types";

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

// The title is quoted, never spliced into the sentence, so any wording reads
// fine. Each line's minutes match what the line says.
const TEMPLATES: { minutes: number; before: string; after: string }[] = [
  { minutes: 15, before: "Spend 15 minutes on “", after: "”" },
  { minutes: 5, before: "Write the first step for “", after: "”" },
  { minutes: 10, before: "Do one small thing toward “", after: "”" },
  { minutes: 5, before: "Jot down what “", after: "” still needs" },
];

/** One line, no quote marks of its own, cut at a word with an ellipsis if long. */
export function shortMilestoneTitle(title: string, max: number): string {
  const clean = title
    .replace(/["“”«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, Math.max(1, max - 1));
  const lastSpace = cut.lastIndexOf(" ");
  const atWord = lastSpace >= cut.length / 2 ? cut.slice(0, lastSpace) : cut;
  return `${atWord.replace(/[\s.,;:!?\-–—]+$/, "")}…`;
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
 */
export function localMilestoneIdeas(
  milestone: Pick<MomentumMilestone, "id" | "title">,
  today: string,
): MilestoneIdea[] {
  if (!milestone.title.replace(/["“”«»]/g, "").trim()) return [];
  const start = hash(`${today}|${milestone.id}`) % TEMPLATES.length;
  return TEMPLATES.map((_, offset) => {
    const index = (start + offset) % TEMPLATES.length;
    const template = TEMPLATES[index];
    const room = MAX_IDEA_TEXT - template.before.length - template.after.length;
    return {
      id: `milestone_local_${index}`,
      text: `${template.before}${shortMilestoneTitle(milestone.title, room)}${template.after}`,
      estimatedMinutes: template.minutes,
    };
  });
}

/**
 * The "For your next milestone" group for the Ideas sheet, or null when there
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
  const local = localMilestoneIdeas(milestone, params.today)
    .filter((idea) => !taken.has(textKey(idea.text)))
    .slice(0, MAX_MILESTONE_IDEAS);
  if (local.length === 0) return null;
  return { milestoneId: milestone.id, title: milestone.title, source: "local", ideas: local };
}
