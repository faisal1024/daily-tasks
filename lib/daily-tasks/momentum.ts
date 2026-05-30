import type {
  AdaptationSnapshot,
  GeneratedTask,
  GeneratedTaskDifficulty,
  History,
  ExperienceLevel,
  MomentumPlan,
  MomentumProfile,
  MomentumSettings,
  StruggleType,
  TimeAvailability,
} from "./types";
import { TASK_SUGGESTIONS } from "./types";

const GOAL_TEMPLATES: Record<string, string[]> = {
  "get in shape": ["Take a 15-minute walk", "Stretch for 5 minutes", "Plan one simple meal"],
  "start a business": [
    "Write one customer problem",
    "List 3 people to learn from",
    "Spend 20 minutes on the offer",
  ],
  "learn a new skill": [
    "Practice for 15 minutes",
    "Watch one beginner lesson",
    "Write what felt confusing",
  ],
  "be more productive": [
    "Choose today's first focus",
    "Clear one distracting surface",
    "Spend 20 minutes on deep work",
  ],
  "improve mental health": [
    "Take 5 slow breaths",
    "Step outside for 10 minutes",
    "Write one kind sentence",
  ],
};

const STRUGGLE_TEMPLATES: Record<StruggleType, string[]> = {
  overwhelm: [
    "Make the next step tiny",
    "Remove one unnecessary task",
    "Do 10 quiet minutes",
  ],
  consistency: [
    "Repeat yesterday's smallest win",
    "Set a 15-minute start time",
    "Track one small finish",
  ],
  motivation: [
    "Write why this goal matters",
    "Start with the easiest step",
    "Celebrate one small finish",
  ],
  time: [
    "Do a 10-minute version",
    "Prepare one thing in advance",
    "Protect a short focus block",
  ],
};

const TIME_TEMPLATES: Record<TimeAvailability, string[]> = {
  "15_min": ["Do the 10-minute version", "Choose one tiny next step"],
  "30_min": ["Make 25 minutes of progress", "Finish one focused block"],
  "60_min": ["Spend 45 minutes on one meaningful step", "Review and improve one piece"],
};

const EXPERIENCE_TEMPLATES: Record<ExperienceLevel, string[]> = {
  beginner: ["Start with the simplest version", "Learn one basic concept"],
  intermediate: ["Practice one focused rep", "Improve one existing attempt"],
  advanced: ["Ship one visible improvement", "Raise the challenge slightly"],
};

interface PlannerInput {
  profile: MomentumProfile;
  history: History;
  settings: MomentumSettings;
  now?: Date;
}

interface RecentPerformance {
  daysReviewed: number;
  completed: number;
  total: number;
  missed: number;
  completionRate: number;
}

export function isMomentumProfileComplete(profile: MomentumProfile): boolean {
  return Boolean(
    profile.goalTitle &&
      profile.timeAvailability &&
      profile.experienceLevel &&
      profile.struggleType &&
      profile.onboardingCompletedAt,
  );
}

export function generateMomentumSuggestions(profile: MomentumProfile): string[] {
  if (!profile.goalTitle) return TASK_SUGGESTIONS;

  const suggestions = [
    ...goalSuggestions(profile.goalTitle),
    ...(profile.struggleType ? STRUGGLE_TEMPLATES[profile.struggleType] : []),
    ...(profile.timeAvailability ? TIME_TEMPLATES[profile.timeAvailability] : []),
    ...(profile.experienceLevel ? EXPERIENCE_TEMPLATES[profile.experienceLevel] : []),
  ];

  return uniqueShortSuggestions(suggestions).slice(0, 5);
}

export function buildMomentumPlan({
  profile,
  history,
  settings,
  now = new Date(),
}: PlannerInput): MomentumPlan | null {
  if (!isMomentumProfileComplete(profile) || !profile.goalTitle) return null;

  const performance = summarizeRecentPerformance(history, now);
  const recommendation = adaptationRecommendation(profile, settings, performance);
  const suggestions = buildGeneratedTasks(profile, recommendation);
  const generatedAt = now.toISOString();

  return {
    id: `plan_${generatedAt}`,
    goalTitle: profile.goalTitle,
    generatedAt,
    provider: "template",
    milestones: buildMilestones(profile.goalTitle),
    taskPool: suggestions,
    todaySuggestions: suggestions.slice(0, 3),
    promptSummary: buildPromptSummary(profile, settings, performance),
    version: 1,
  };
}

export function validateGeneratedTasks(tasks: GeneratedTask[]): GeneratedTask[] {
  const seen = new Set<string>();

  return tasks
    .filter((task) => {
      const text = task.text.trim();
      const key = text.toLowerCase();
      if (!text || text.length > 64 || seen.has(key)) return false;
      if (!Number.isInteger(task.estimatedMinutes) || task.estimatedMinutes < 5) return false;
      if (task.estimatedMinutes > 60) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

export function summarizeRecentPerformance(history: History, now: Date): RecentPerformance {
  const days = Object.values(history)
    .filter((record) => record.date < dateKey(now) && record.total > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  const total = days.reduce((sum, day) => sum + day.total, 0);
  const completed = days.reduce((sum, day) => sum + day.completed, 0);
  const missed = days.reduce((sum, day) => sum + Math.max(0, day.total - day.completed), 0);

  return {
    daysReviewed: days.length,
    completed,
    total,
    missed,
    completionRate: total === 0 ? 1 : completed / total,
  };
}

export interface RecentTask {
  text: string;
  completed: boolean;
}

/**
 * The user's own recent task texts (across the last few days), newest first,
 * with whether each was completed. Lets the AI build on what the user actually
 * chose — reinforcing finished kinds of tasks and reshaping ones they skipped.
 */
export function summarizeRecentTasks(
  history: History,
  now: Date,
  limit = 12,
): RecentTask[] {
  const days = Object.values(history)
    .filter((record) => record.date < dateKey(now) && record.tasks.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  const tasks: RecentTask[] = [];
  for (const day of days) {
    for (const task of day.tasks) {
      const text = task.text.trim();
      if (!text) continue;
      tasks.push({ text, completed: task.completed });
      if (tasks.length >= limit) return tasks;
    }
  }
  return tasks;
}

export function buildAdaptationSnapshot(
  profile: MomentumProfile,
  settings: MomentumSettings,
  history: History,
  now: Date = new Date(),
): AdaptationSnapshot | null {
  if (!isMomentumProfileComplete(profile)) return null;

  const performance = summarizeRecentPerformance(history, now);
  const recommendation = adaptationRecommendation(profile, settings, performance);

  return {
    date: dateKey(now),
    completionRate: performance.completionRate,
    missedCount: performance.missed,
    recommendation,
    reason: adaptationReason(profile, performance, recommendation),
  };
}

function goalSuggestions(goalTitle: string): string[] {
  const normalized = goalTitle.trim().toLowerCase();
  const exact = GOAL_TEMPLATES[normalized];
  if (exact) return exact;

  return [
    `Spend 15 minutes on ${goalTitle}`,
    `Write the next step for ${goalTitle}`,
    `Make one small move toward ${goalTitle}`,
  ];
}

function adaptationRecommendation(
  profile: MomentumProfile,
  settings: MomentumSettings,
  performance: RecentPerformance,
): "simplify" | "maintain" | "increase" {
  if (!settings.adaptivePlanning) return "maintain";
  if (profile.struggleType === "overwhelm" || profile.struggleType === "time") return "simplify";
  if (performance.daysReviewed >= 2 && performance.completionRate < 0.6) return "simplify";
  if (performance.daysReviewed >= 3 && performance.completionRate >= 0.9) return "increase";
  return "maintain";
}

function buildGeneratedTasks(
  profile: MomentumProfile,
  recommendation: "simplify" | "maintain" | "increase",
): GeneratedTask[] {
  const texts = generateMomentumSuggestions(profile);
  const minutes = minutesFor(profile.timeAvailability, recommendation);
  const difficulty = difficultyFor(recommendation);
  const reason = reasonFor(profile, recommendation);

  return validateGeneratedTasks(
    texts.map((text, index) => ({
      id: `suggestion_${index + 1}`,
      text,
      estimatedMinutes: minutes[index] ?? minutes[0],
      difficulty,
      reason,
      source: "template",
    })),
  );
}

function minutesFor(
  timeAvailability: TimeAvailability | null,
  recommendation: "simplify" | "maintain" | "increase",
): number[] {
  if (recommendation === "simplify") return [10, 10, 15];
  if (recommendation === "increase") {
    if (timeAvailability === "60_min") return [30, 35, 40];
    if (timeAvailability === "30_min") return [20, 25, 25];
    return [15, 15, 20];
  }
  if (timeAvailability === "60_min") return [25, 30, 30];
  if (timeAvailability === "30_min") return [15, 20, 20];
  return [10, 10, 15];
}

function difficultyFor(
  recommendation: "simplify" | "maintain" | "increase",
): GeneratedTaskDifficulty {
  if (recommendation === "simplify") return "easy";
  if (recommendation === "increase") return "stretch";
  return "medium";
}

function reasonFor(
  profile: MomentumProfile,
  recommendation: "simplify" | "maintain" | "increase",
): string {
  if (recommendation === "simplify") {
    return profile.struggleType === "time"
      ? "Sized for a short day."
      : "Kept small to reduce friction.";
  }
  if (recommendation === "increase") return "A gentle step up from recent wins.";
  return "Matched to your goal and daily window.";
}

function adaptationReason(
  profile: MomentumProfile,
  performance: RecentPerformance,
  recommendation: "simplify" | "maintain" | "increase",
): string {
  if (recommendation === "simplify") {
    if (profile.struggleType === "overwhelm") return "Simplifying because overwhelm is the main friction.";
    if (profile.struggleType === "time") return "Keeping tasks short for the time available.";
    return "Recent misses suggest tomorrow should start smaller.";
  }
  if (recommendation === "increase") {
    return "Recent completions show room for a gentle step up.";
  }
  if (performance.daysReviewed === 0) return "No recent pattern yet, so Momentum is staying steady.";
  return "Recent rhythm looks steady enough to maintain.";
}

function buildMilestones(goalTitle: string) {
  return [
    {
      id: "milestone_start",
      title: "Start small",
      description: `Build the first visible rhythm for ${goalTitle}.`,
      completedAt: null,
    },
    {
      id: "milestone_repeat",
      title: "Repeat the rhythm",
      description: "Use a few steady days to make progress feel normal.",
      completedAt: null,
    },
    {
      id: "milestone_grow",
      title: "Grow the challenge",
      description: "Increase the size only after the habit has evidence.",
      completedAt: null,
    },
  ];
}

function buildPromptSummary(
  profile: MomentumProfile,
  settings: MomentumSettings,
  performance: RecentPerformance,
): string {
  return [
    `Goal: ${profile.goalTitle}`,
    `Time: ${profile.timeAvailability}`,
    `Experience: ${profile.experienceLevel}`,
    `Struggle: ${profile.struggleType}`,
    `Tone: ${settings.suggestionTone}`,
    `Recent: ${performance.completed}/${performance.total || 0} tasks completed across ${
      performance.daysReviewed
    } days`,
  ].join(" | ");
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function uniqueShortSuggestions(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const text = value.trim();
    const key = text.toLowerCase();
    if (!text || text.length > 56 || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }

  return result.length >= 3 ? result : TASK_SUGGESTIONS;
}
