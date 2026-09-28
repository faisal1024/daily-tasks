import type { AiFailureKind } from "./ai-status";
import type { Journey } from "./journey";

export const MAX_TASKS = 3;

export type TaskId = string;

export interface TaskStep {
  id: string;
  text: string;
  done: boolean;
}

export interface Task {
  id: TaskId;
  text: string;
  createdAt: string;
  carriedOver: boolean;
  /** Optional "break it down" checklist; doesn't change the task's own status. */
  steps?: TaskStep[];
}

/** Tomorrow's three, drafted at the evening close (shown the next morning). */
export interface TomorrowDraft {
  /** The day the draft is for (yyyy-MM-dd). */
  forDate: string;
  tasks: string[];
  /** The coach's note from the evening before. */
  note: string;
  /** Plain reason for the draft, e.g. "Because today was hard, tomorrow is lighter." */
  because: string;
  source: "ai" | "local";
}

export interface EveningCloseRecord {
  date: string;
  result: ReflectionResult;
  note: string;
}

/** Brain-dump leftovers kept for another day (shown in the Ideas sheet). */
export interface ParkedTask {
  id: string;
  text: string;
  parkedAt: string;
}

// Generous so a brain dump never silently drops what someone typed.
export const MAX_PARKED_TASKS = 50;

export type LockSource = "manual" | "auto";

export type RolloverOutcome = "carried" | "dropped" | "unresolved";

export interface DayTaskRecord {
  id: TaskId;
  text: string;
  completed: boolean;
  carriedOver: boolean;
  rolloverOutcome: RolloverOutcome | null;
  /** Step checklist, kept so a carried-over (stuck) task keeps its steps. */
  steps?: TaskStep[];
}

export interface DayRecord {
  date: string;
  total: number;
  completed: number;
  locked: boolean;
  lockSource: LockSource | null;
  tasks: DayTaskRecord[];
  reflection: string | null;
  reflectionResult: ReflectionResult | null;
}

export type History = Record<string, DayRecord>;

export interface PendingRollover {
  sourceDate: string;
  tasks: DayTaskRecord[];
}

export type GoalSource = "suggested" | "custom";

export type TimeAvailability = "15_min" | "30_min" | "60_min";

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

export type StruggleType = "overwhelm" | "consistency" | "motivation" | "time";

export type PreferredTime = "morning" | "afternoon" | "evening" | "anytime";

export type Cadence = "daily" | "weekdays" | "few_times";

export interface MomentumProfile {
  name: string | null;
  goalTitle: string | null;
  goalSource: GoalSource | null;
  timeAvailability: TimeAvailability | null;
  experienceLevel: ExperienceLevel | null;
  struggleType: StruggleType | null;
  // Enrichment questions — optional; the core four above gate plan generation.
  motivation: string | null;
  preferredTime: PreferredTime | null;
  cadence: Cadence | null;
  onboardingCompletedAt: string | null;
}

export type GeneratedTaskSource = "template" | "ai";

export type GeneratedTaskDifficulty = "easy" | "medium" | "stretch";

export interface GeneratedTask {
  id: string;
  text: string;
  estimatedMinutes: number;
  difficulty: GeneratedTaskDifficulty;
  reason: string;
  source: GeneratedTaskSource;
}

export interface MomentumMilestone {
  id: string;
  title: string;
  description: string;
  completedAt: string | null;
}

export interface MomentumPlan {
  id: string;
  goalTitle: string;
  generatedAt: string;
  provider: GeneratedTaskSource;
  milestones: MomentumMilestone[];
  taskPool: GeneratedTask[];
  todaySuggestions: GeneratedTask[];
  promptSummary: string;
  version: number;
}

export type ReflectionResult = "easy" | "good" | "hard" | "missed";

export interface DailyReflection {
  date: string;
  result: ReflectionResult;
  note: string | null;
  createdAt: string;
}

export interface AdaptationSnapshot {
  date: string;
  completionRate: number;
  missedCount: number;
  recommendation: "simplify" | "maintain" | "increase";
  reason: string;
}

export interface MomentumSettings {
  adaptivePlanning: boolean;
  eveningReflection: boolean;
  suggestionTone: "calm" | "friendly" | "direct";
}

export interface NotificationConfig {
  enabled: boolean;
  morning: boolean;
  progress: boolean;
  evening: boolean;
  hourly: boolean;
}

export interface AutoLockConfig {
  enabled: boolean;
  hour: number;
  minute: number;
}

export interface AppState {
  tasks: Task[];
  todayCompletions: TaskId[];
  lastOpenedDate: string;
  todayLocked: boolean;
  todayLockSource: LockSource | null;
  // When today was locked (ISO), shown in the status line; null when unlocked.
  todayLockedAt: string | null;
  // Date the user manually unlocked; suppresses auto-lock for that day only.
  manualUnlockDate: string | null;
  pendingRollover: PendingRollover | null;
  /** The user asked for a new path: the next AI plan may replace the milestones. */
  pathRefreshPending?: boolean;
  history: History;
  notifications: NotificationConfig;
  autoLock: AutoLockConfig;
  hasSeenOnboarding: boolean;
  todayReflection: string | null;
  todayReflectionResult: ReflectionResult | null;
  momentumProfile: MomentumProfile;
  momentumPlan: MomentumPlan | null;
  momentumSettings: MomentumSettings;
  momentumPlanStatus: "idle" | "loading" | "ready" | "error";
  // Why the last AI plan request failed (drives friendly copy), or null.
  momentumPlanError: AiFailureKind | null;
  adaptationSnapshot: AdaptationSnapshot | null;
  // Milestone ids the user has completed. Kept separate from the (regenerated)
  // plan so completion survives daily plan rebuilds.
  completedMilestoneIds: string[];
  // Title of a just-completed milestone awaiting a celebration, or null.
  pendingMilestoneCelebration: string | null;
  journey: Journey;
  // When we last asked for an App Store rating (ISO), or null if never.
  lastReviewPromptAt: string | null;
  // A perfect day earned a rating ask (ISO time). It's shown on a later app
  // open, never on top of the celebration. Cleared once requested.
  reviewDueAt: string | null;
  parkedTasks: ParkedTask[];
  // Used the app before the paywall shipped: keeps every Plus feature free.
  plusGrandfathered: boolean;
  // Anonymous usage stats (Settings toggle). Only sent when the build has a key.
  analyticsEnabled: boolean;
  // Rolling summary the coach keeps from evening closes (AI), or null.
  coachMemory: string | null;
  // Tomorrow's three from the last evening close, or null.
  tomorrowDraft: TomorrowDraft | null;
  // The last evening close: which day, the answer it was for, and the note.
  // (Kept even when nothing was drafted, so a closed day stays closed.)
  eveningClose: EveningCloseRecord | null;
  // Read today's Calendar events and Reminders into AI requests (off by default).
  agendaEnabled: boolean;
}

export const GOAL_OPTIONS: string[] = [
  "Get in shape",
  "Start a business",
  "Learn a new skill",
  "Be more productive",
  "Improve mental health",
];

export const TASK_SUGGESTIONS: string[] = [
  "Move my body",
  "Plan tomorrow",
  "Reply to one important message",
  "Tidy one small area",
  "Read for 20 minutes",
];

export const DEFAULT_MOMENTUM_PROFILE: MomentumProfile = {
  name: null,
  goalTitle: null,
  goalSource: null,
  timeAvailability: null,
  experienceLevel: null,
  struggleType: null,
  motivation: null,
  preferredTime: null,
  cadence: null,
  onboardingCompletedAt: null,
};

export const DEFAULT_MOMENTUM_SETTINGS: MomentumSettings = {
  adaptivePlanning: true,
  eveningReflection: true,
  suggestionTone: "calm",
};

export const DEFAULT_NOTIFICATIONS: NotificationConfig = {
  enabled: true,
  morning: true,
  progress: true,
  evening: true,
  hourly: false,
};

export const DEFAULT_AUTO_LOCK: AutoLockConfig = {
  enabled: true,
  hour: 12,
  minute: 0,
};

export type NotificationKey = Exclude<keyof NotificationConfig, "enabled">;

export type NotificationPermissionState =
  | "granted"
  | "denied"
  | "undetermined"
  | "unsupported";
