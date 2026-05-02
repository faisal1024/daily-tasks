import type { AdaptationSnapshot } from "./types";

export type CoachMessageTag =
  | "empty"
  | "choosing"
  | "locked"
  | "progress"
  | "complete"
  | "recovery"
  | "stretch";

export interface CoachMessage {
  id: string;
  tags: CoachMessageTag[];
  phase: string;
  title: string;
  body: string;
}

export interface CoachMessageInput {
  dateKey: string;
  total: number;
  completedCount: number;
  locked: boolean;
  adaptationRecommendation?: AdaptationSnapshot["recommendation"] | null;
}

export const COACH_MESSAGES: CoachMessage[] = [
  {
    id: "empty-choose-fewer",
    tags: ["empty"],
    phase: "Commit",
    title: "Start with the three that actually matter.",
    body: "Your coach will help turn one meaningful goal into a small list you can stand behind today.",
  },
  {
    id: "empty-honest-day",
    tags: ["empty"],
    phase: "Commit",
    title: "What would make today honest?",
    body: "Pick commitments that are specific enough to start and small enough to finish.",
  },
  {
    id: "empty-no-backlog",
    tags: ["empty"],
    phase: "Commit",
    title: "Today does not need a backlog.",
    body: "Choose the few actions that would make the day feel meaningfully used.",
  },
  {
    id: "empty-direction",
    tags: ["empty"],
    phase: "Commit",
    title: "Give the day a direction.",
    body: "Three clear commitments are easier to protect than a dozen maybe-laters.",
  },
  {
    id: "empty-first-step",
    tags: ["empty"],
    phase: "Commit",
    title: "Make the first step visible.",
    body: "Momentum works best when today's tasks are plain, doable, and tied to what matters.",
  },
  {
    id: "empty-small-win",
    tags: ["empty"],
    phase: "Commit",
    title: "Design a small win before the day gets loud.",
    body: "You are not planning your whole life here. Just the three commitments for today.",
  },
  {
    id: "choosing-stop-choosing",
    tags: ["choosing"],
    phase: "Set the day",
    title: "Choose, then stop choosing.",
    body: "When the list feels honest, set it. Momentum works best when today has edges.",
  },
  {
    id: "choosing-protect-focus",
    tags: ["choosing"],
    phase: "Set the day",
    title: "Protect the list before it grows.",
    body: "If these commitments are enough for a good day, lock them in and move forward.",
  },
  {
    id: "choosing-fewer-better",
    tags: ["choosing"],
    phase: "Set the day",
    title: "Fewer tasks. Better follow-through.",
    body: "You can still edit while choosing, but the real value starts when the day is set.",
  },
  {
    id: "choosing-stand-behind",
    tags: ["choosing"],
    phase: "Set the day",
    title: "Pick the work you will stand behind.",
    body: "The goal is not to capture every idea. It is to choose what deserves attention today.",
  },
  {
    id: "choosing-good-enough",
    tags: ["choosing"],
    phase: "Set the day",
    title: "A good-enough list can be a strong list.",
    body: "You do not need three perfect tasks. You need commitments that move the day forward.",
  },
  {
    id: "choosing-make-it-real",
    tags: ["choosing"],
    phase: "Set the day",
    title: "Make the day real.",
    body: "Once the list is set, Momentum stops being a planner and becomes your follow-through coach.",
  },
  {
    id: "progress-next-ten",
    tags: ["progress"],
    phase: "Follow through",
    title: "One task gets the next ten minutes.",
    body: "Pick the easiest unfinished commitment and give it a clean start.",
  },
  {
    id: "progress-small-finish",
    tags: ["progress"],
    phase: "Follow through",
    title: "A small finish is still a finish.",
    body: "You do not need a perfect run. You just need the next honest action.",
  },
  {
    id: "progress-return",
    tags: ["progress"],
    phase: "Follow through",
    title: "Return to the list.",
    body: "The day already has a shape. Choose one unfinished commitment and continue.",
  },
  {
    id: "progress-momentum",
    tags: ["progress"],
    phase: "Follow through",
    title: "Momentum comes from finishing.",
    body: "Check off one commitment before opening the door to anything new.",
  },
  {
    id: "progress-start-small",
    tags: ["progress"],
    phase: "Follow through",
    title: "Start smaller if you need to.",
    body: "Two focused minutes can break the seal on a task that has been waiting.",
  },
  {
    id: "progress-keep-promise",
    tags: ["progress"],
    phase: "Follow through",
    title: "Keep one promise to yourself.",
    body: "Choose the commitment that would make the biggest difference if it were finished.",
  },
  {
    id: "locked-protected",
    tags: ["locked"],
    phase: "Follow through",
    title: "The list is protected. Now finish calmly.",
    body: "No backlog, no reshuffle. Pick the next unfinished commitment and give it your attention.",
  },
  {
    id: "locked-no-reshuffle",
    tags: ["locked"],
    phase: "Follow through",
    title: "No more reshuffling today.",
    body: "The useful move now is not editing the list. It is finishing one thing that is already on it.",
  },
  {
    id: "locked-finish-line",
    tags: ["locked"],
    phase: "Follow through",
    title: "The finish line is visible.",
    body: "Your commitments are set. Work the list from here, one calm check at a time.",
  },
  {
    id: "locked-accountability",
    tags: ["locked"],
    phase: "Follow through",
    title: "Accountability starts after the list is set.",
    body: "You already chose what matters today. Now let the constraint help you follow through.",
  },
  {
    id: "locked-focus",
    tags: ["locked"],
    phase: "Follow through",
    title: "Let the lock do its job.",
    body: "The list has boundaries so your attention does not have to keep negotiating.",
  },
  {
    id: "complete-capture-win",
    tags: ["complete"],
    phase: "Reflect",
    title: "Capture the win before tomorrow arrives.",
    body: "A quick reflection helps Momentum make tomorrow easier, sharper, or just right.",
  },
  {
    id: "complete-you-showed",
    tags: ["complete"],
    phase: "Reflect",
    title: "You showed up today.",
    body: "Before moving on, notice what worked. That is useful data for tomorrow.",
  },
  {
    id: "complete-discipline",
    tags: ["complete"],
    phase: "Reflect",
    title: "This is how discipline gets built.",
    body: "Not by doing everything. By choosing a few meaningful things and closing the loop.",
  },
  {
    id: "complete-loop",
    tags: ["complete"],
    phase: "Reflect",
    title: "Close the loop.",
    body: "Tell Momentum how the day felt so tomorrow's three can fit your real life better.",
  },
  {
    id: "recovery-kind-reset",
    tags: ["recovery"],
    phase: "Recover",
    title: "Make the next step kinder.",
    body: "If recent days were heavy, Momentum can shrink the work without dropping the goal.",
  },
  {
    id: "recovery-smaller",
    tags: ["recovery"],
    phase: "Recover",
    title: "Smaller is not weaker.",
    body: "A smaller commitment is often the fastest way back into motion.",
  },
  {
    id: "recovery-restart",
    tags: ["recovery"],
    phase: "Recover",
    title: "Restart without the drama.",
    body: "Missed days are information. Today only needs the next three commitments.",
  },
  {
    id: "stretch-ready",
    tags: ["stretch"],
    phase: "Stretch",
    title: "You may be ready for a little more.",
    body: "Recent follow-through looks strong. Keep the list short, but let one task stretch you.",
  },
  {
    id: "stretch-trust",
    tags: ["stretch"],
    phase: "Stretch",
    title: "Trust the consistency you are building.",
    body: "Momentum can raise the challenge slightly while keeping the day limited to three.",
  },
];

export function selectCoachMessage(input: CoachMessageInput): CoachMessage {
  const tag = selectPrimaryTag(input);
  const candidates = COACH_MESSAGES.filter((message) =>
    message.tags.includes(tag),
  );

  return pickStable(candidates.length > 0 ? candidates : COACH_MESSAGES, [
    input.dateKey,
    tag,
    String(input.total),
    String(input.completedCount),
    input.locked ? "locked" : "unlocked",
  ]);
}

function selectPrimaryTag(input: CoachMessageInput): CoachMessageTag {
  if (input.total > 0 && input.completedCount >= input.total) return "complete";
  if (input.adaptationRecommendation === "simplify") return "recovery";
  if (input.adaptationRecommendation === "increase" && input.total === 0) {
    return "stretch";
  }
  if (input.total === 0) return "empty";
  if (input.locked) return "locked";
  if (input.completedCount > 0) return "progress";
  return "choosing";
}

function pickStable<T>(items: T[], parts: string[]): T {
  const hash = stableHash(parts.join("|"));
  return items[hash % items.length] as T;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
