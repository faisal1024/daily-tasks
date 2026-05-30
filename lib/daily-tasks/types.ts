import type { Journey } from "./journey";

export const MAX_TASKS = 3;

export type TaskId = string;

export interface Task {
  id: TaskId;
  text: string;
  createdAt: string;
  carriedOver: boolean;
}

export type LockSource = "manual" | "auto";

export type RolloverOutcome = "carried" | "dropped" | "unresolved";

export interface DayTaskRecord {
  id: TaskId;
  text: string;
  completed: boolean;
  carriedOver: boolean;
  rolloverOutcome: RolloverOutcome | null;
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

export interface MomentumProfile {
  goalTitle: string | null;
  goalSource: GoalSource | null;
  timeAvailability: TimeAvailability | null;
  experienceLevel: ExperienceLevel | null;
  struggleType: StruggleType | null;
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
  autoLockNoticeDate: string | null;
  pendingRollover: PendingRollover | null;
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
  momentumPlanError: string | null;
  adaptationSnapshot: AdaptationSnapshot | null;
  journey: Journey;
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
  goalTitle: null,
  goalSource: null,
  timeAvailability: null,
  experienceLevel: null,
  struggleType: null,
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
