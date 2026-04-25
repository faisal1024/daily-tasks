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
}

export const DEFAULT_TASKS: Pick<Task, "text">[] = [
  { text: "Morning Exercise" },
  { text: "Read for 30 Minutes" },
  { text: "Review Daily Goals" },
];

export const DEFAULT_NOTIFICATIONS: NotificationConfig = {
  enabled: true,
  morning: true,
  progress: true,
  evening: true,
};

export type NotificationKey = Exclude<keyof NotificationConfig, "enabled">;

export type NotificationPermissionState =
  | "granted"
  | "denied"
  | "undetermined"
  | "unsupported";
