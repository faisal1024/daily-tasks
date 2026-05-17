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
}

export type History = Record<string, DayRecord>;

export interface PendingRollover {
  sourceDate: string;
  tasks: DayTaskRecord[];
}

export interface NotificationConfig {
  enabled: boolean;
  morning: boolean;
  progress: boolean;
  evening: boolean;
  frequencyHours: NotificationFrequencyHours;
}

export interface AutoLockConfig {
  enabled: boolean;
  hour: number;
  minute: number;
}

export type UserGoal =
  | "health"
  | "career"
  | "learning"
  | "relationships"
  | "home"
  | "finance"
  | "creativity"
  | "mindfulness";

export type UserEnergy = "low" | "steady" | "high";
export type UserTimeWindow = "quick" | "medium" | "deep";
export type UserWorkStyle = "gentle" | "structured" | "ambitious";
export type NotificationFrequencyHours = 1 | 2;

export interface UserProfile {
  goals: UserGoal[];
  energy: UserEnergy;
  timeWindow: UserTimeWindow;
  workStyle: UserWorkStyle;
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
  profile: UserProfile;
  hasSeenOnboarding: boolean;
  todayReflection: string | null;
}

export const DEFAULT_NOTIFICATIONS: NotificationConfig = {
  enabled: true,
  morning: true,
  progress: true,
  evening: true,
  frequencyHours: 1,
};

export const DEFAULT_AUTO_LOCK: AutoLockConfig = {
  enabled: true,
  hour: 12,
  minute: 0,
};

export type NotificationKey = Exclude<keyof NotificationConfig, "enabled" | "frequencyHours">;

export const DEFAULT_PROFILE: UserProfile = {
  goals: ["health", "career", "learning"],
  energy: "steady",
  timeWindow: "medium",
  workStyle: "structured",
};

export type NotificationPermissionState =
  | "granted"
  | "denied"
  | "undetermined"
  | "unsupported";
