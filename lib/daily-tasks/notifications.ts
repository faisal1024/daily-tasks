import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { MANAGED_REMINDER_PREFIX, planReminders, planUpcomingMornings } from "./reminders";
import type { NotificationConfig, NotificationPermissionState, TomorrowDraft } from "./types";

let handlerConfigured = false;

interface SyncNotificationsInput {
  now?: Date;
  settings: NotificationConfig;
  permissionState: NotificationPermissionState;
  taskCount: number;
  completedCount: number;
  draft?: TomorrowDraft | null;
}

function configureHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    // Focus mode's timer end is said in-app already, so it isn't shown there.
    handleNotification: async (notification) => {
      const show = notification.request.identifier !== FOCUS_TIMER_NOTIFICATION_ID;
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: false, shouldSetBadge: false };
    },
  });
}

function mapPermissionStatus(
  settings: Notifications.NotificationPermissionsStatus,
): NotificationPermissionState {
  if (settings.granted) return "granted";
  if (settings.canAskAgain === false) return "denied";
  return "undetermined";
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionState> {
  if (Platform.OS === "web") return "unsupported";
  configureHandler();
  const settings = await Notifications.getPermissionsAsync();
  return mapPermissionStatus(settings);
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (Platform.OS === "web") return "unsupported";
  configureHandler();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return "granted";
  if (current.canAskAgain === false) return "denied";
  const result = await Notifications.requestPermissionsAsync();
  return mapPermissionStatus(result);
}

async function cancelAllManaged() {
  if (Platform.OS === "web") return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(
        (s) =>
          typeof s.identifier === "string" &&
          s.identifier.startsWith(MANAGED_REMINDER_PREFIX),
      )
      .map((s) => Notifications.cancelScheduledNotificationAsync(s.identifier)),
  );
}

// Syncs run one at a time: two overlapping cancel-then-schedule passes would
// interleave and leave duplicate (or missing) reminders.
let syncQueue: Promise<void> = Promise.resolve();

export function syncNotifications(input: SyncNotificationsInput): Promise<void> {
  const run = syncQueue.then(() => runSync(input));
  // Keep the chain alive even if one sync fails.
  syncQueue = run.catch(() => {});
  return run;
}

async function runSync({
  now = new Date(),
  settings,
  permissionState,
  taskCount,
  completedCount,
  draft = null,
}: SyncNotificationsInput): Promise<void> {
  if (Platform.OS === "web") return;
  configureHandler();
  await cancelAllManaged();

  const planned = [
    ...planReminders({
      now,
      taskCount,
      completedCount,
      settings,
      permissionState,
      draft,
    }),
    ...planUpcomingMornings({ now, settings, permissionState, draft }),
  ];

  for (const reminder of planned) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.identifier,
        content: {
          title: reminder.title,
          body: reminder.body,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.at,
        },
      });
    } catch (err) {
      console.warn(`[daily-tasks] failed to schedule ${reminder.kind} reminder`, err);
    }
  }
}

export async function cancelAllNotifications(): Promise<void> {
  if (Platform.OS === "web") return;
  await cancelAllManaged();
}

// Focus mode's timer (1.2): one quiet notification for when it ends, in case
// they're in another app. Its id is outside MANAGED_REMINDER_PREFIX, so the
// reminder syncs never cancel it; the handler above doesn't show it in-app
// (focus mode says it there). Only with permission already granted: it never asks.
export const FOCUS_TIMER_NOTIFICATION_ID = "three-today:focus-timer";
export const FOCUS_TIMER_NOTIFICATION_BODY = "Time's up. Keep going, or take a break.";

// One at a time, like the reminder syncs. A schedule that another call has
// already overtaken (a restart, a cancel) is skipped; the later call wins.
let focusQueue: Promise<void> = Promise.resolve();
let focusGeneration = 0;

function queueFocus(step: () => Promise<void>): Promise<void> {
  // A missed end-of-timer notification is fine; focus mode still says it there.
  const run = focusQueue.then(step).catch(() => {});
  focusQueue = run;
  return run;
}

export function scheduleFocusTimerNotification(at: Date): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  const generation = ++focusGeneration;
  return queueFocus(async () => {
    if (generation !== focusGeneration) return;
    if ((await getNotificationPermissionStatus()) !== "granted" || generation !== focusGeneration) return;
    await Notifications.scheduleNotificationAsync({
      identifier: FOCUS_TIMER_NOTIFICATION_ID,
      content: { title: "Three Today", body: FOCUS_TIMER_NOTIFICATION_BODY, sound: false },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  });
}

export function cancelFocusTimerNotification(): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  focusGeneration++;
  return queueFocus(() => Notifications.cancelScheduledNotificationAsync(FOCUS_TIMER_NOTIFICATION_ID));
}
