export const MAX_TASKS = 3;

export type TaskId = string;

export interface Task {
  id: TaskId;
  text: string;
  createdAt: string;
  carriedOver: boolean;
}

export interface DayRecord {
  date: string;
  total: number;
  completed: number;
}

export type History = Record<string, DayRecord>;

export interface NotificationSlot {
  enabled: boolean;
  hour: number;
  minute: number;
}

export interface NotificationConfig {
  morning: NotificationSlot;
  evening: NotificationSlot;
  night: NotificationSlot;
}

export interface AppState {
  tasks: Task[];
  todayCompletions: TaskId[];
  lastOpenedDate: string;
  history: History;
  notifications: NotificationConfig;
}

export const DEFAULT_TASKS: Pick<Task, "text">[] = [
  { text: "Morning Exercise" },
  { text: "Read for 30 Minutes" },
  { text: "Review Daily Goals" },
];

export const DEFAULT_NOTIFICATIONS: NotificationConfig = {
  morning: { enabled: true, hour: 8, minute: 0 },
  evening: { enabled: true, hour: 18, minute: 0 },
  night: { enabled: true, hour: 21, minute: 0 },
};

export type NotificationKey = keyof NotificationConfig;
