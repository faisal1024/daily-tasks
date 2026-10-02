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
    // Focus mode's timer end is shown in-app already, so it isn't shown
    // there; its sound still plays, so the end is heard (like Apple's Timer).
    handleNotification: async (notification) => {
      const focus = notification.request.identifier === FOCUS_TIMER_NOTIFICATION_ID;
      return { shouldShowBanner: !focus, shouldShowList: !focus, shouldPlaySound: focus, shouldSetBadge: false };
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

// The focus session's end (1.3): one notification per session, in case
// they're in another app. Like Apple's Timer it plays the default
// notification sound (which respects the silent switch; the reminders stay
// silent). It isn't time-sensitive (that needs an extra Apple capability),
// so an iOS Focus (e.g. Do Not Disturb) may hold it back. Android uses the
// default channel. Its id is outside MANAGED_REMINDER_PREFIX, so the
// reminder syncs never cancel it; the handler above doesn't show it in-app
// (the task row's check-in says it there). Only with permission already granted: it never asks.
export const FOCUS_TIMER_NOTIFICATION_ID = "three-today:focus-timer";
// Its buttons, extend first (as the check-in, the Live Activity and the
// Dynamic Island have them): a timer's "5 more minutes" and Mark done; a
// 5-minute starter's "Keep going" (a 20-minute timer, as the check-in) and
// Mark done (it ticks the task); then the check-in's quiet way out, "Take a
// break" ("Stop for now" on a starter), which ends the session and never
// ticks the task. All open the app, so a tap is handled even when the app wasn't
// running (a background action is lost then).
export const FOCUS_CATEGORY_ID = "three-today:focus-session";
export const FOCUS_STARTER_CATEGORY_ID = "three-today:focus-starter";
export const FOCUS_ACTION_DONE = "focus-done";
export const FOCUS_ACTION_EXTEND = "focus-extend";
export const FOCUS_ACTION_KEEP_GOING = "focus-keep-going";
export const FOCUS_ACTION_BREAK = "focus-break";

// One at a time, like the reminder syncs. A schedule that another call has
// already overtaken (a reschedule, a cancel) is skipped; the later call wins.
let focusQueue: Promise<void> = Promise.resolve();
let focusGeneration = 0;
let categoryReady = false;

function queueFocus(step: () => Promise<void>): Promise<void> {
  // A missed end notification is fine; the task row's check-in still says it in the app.
  const run = focusQueue.then(step).catch(() => {});
  focusQueue = run;
  return run;
}

/**
 * Registers both categories' buttons: at every launch (so a
 * notification from before an update still gets them), and before a
 * schedule if that didn't take. Best-effort.
 */
export function registerFocusCategory(): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  return ensureFocusCategory().catch(() => {});
}

async function ensureFocusCategory(): Promise<void> {
  if (categoryReady || typeof Notifications.setNotificationCategoryAsync !== "function") return;
  await Notifications.setNotificationCategoryAsync(FOCUS_CATEGORY_ID, [
    { identifier: FOCUS_ACTION_EXTEND, buttonTitle: "5 more minutes", options: { opensAppToForeground: true } },
    { identifier: FOCUS_ACTION_DONE, buttonTitle: "Mark done", options: { opensAppToForeground: true } },
    { identifier: FOCUS_ACTION_BREAK, buttonTitle: "Take a break", options: { opensAppToForeground: true } },
  ]);
  await Notifications.setNotificationCategoryAsync(FOCUS_STARTER_CATEGORY_ID, [
    { identifier: FOCUS_ACTION_KEEP_GOING, buttonTitle: "Keep going", options: { opensAppToForeground: true } },
    { identifier: FOCUS_ACTION_DONE, buttonTitle: "Mark done", options: { opensAppToForeground: true } },
    { identifier: FOCUS_ACTION_BREAK, buttonTitle: "Stop for now", options: { opensAppToForeground: true } },
  ]);
  categoryReady = true;
}

/** What the end notification needs from a running session. */
export interface FocusNotificationInput {
  sessionId: string;
  taskId: string;
  /**
   * Picks the buttons: a starter's Keep going / Mark done / Stop for now, a
   * timer's 5 more minutes / Mark done / Take a break.
   */
  kind: "timer" | "starter";
  at: Date;
  /** The task's words (see notificationTitle). */
  title: string;
  body: string;
}

/**
 * The session's end notification at `at` (replacing any earlier one: one per
 * session). One that already went off is cleared first, so an extended
 * session's old "Time's up" doesn't linger in Notification Center.
 */
export function scheduleFocusSessionNotification({
  sessionId,
  taskId,
  kind,
  at,
  title,
  body,
}: FocusNotificationInput): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  const generation = ++focusGeneration;
  return queueFocus(async () => {
    if (generation !== focusGeneration) return;
    if ((await getNotificationPermissionStatus()) !== "granted" || generation !== focusGeneration) return;
    await Notifications.dismissNotificationAsync(FOCUS_TIMER_NOTIFICATION_ID).catch(() => {});
    // Without the buttons it still goes off: they're a shortcut, not the point.
    await ensureFocusCategory().catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: FOCUS_TIMER_NOTIFICATION_ID,
      content: {
        title,
        body,
        sound: true,
        categoryIdentifier: kind === "starter" ? FOCUS_STARTER_CATEGORY_ID : FOCUS_CATEGORY_ID,
        data: { focusSessionId: sessionId, taskId },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  });
}

export function cancelFocusTimerNotification(): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  focusGeneration++;
  return queueFocus(async () => {
    await Notifications.cancelScheduledNotificationAsync(FOCUS_TIMER_NOTIFICATION_ID);
    // One that already went off shouldn't linger in Notification Center.
    await Notifications.dismissNotificationAsync(FOCUS_TIMER_NOTIFICATION_ID).catch(() => {});
  });
}

/**
 * Clears a "Time's up" that already went off (Notification Center, the lock
 * screen), e.g. once it's been answered on the Live Activity. Queued with the
 * schedules, so it never removes a newer one (only delivered ones go).
 */
export function dismissFocusTimerNotification(): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  return queueFocus(async () => {
    await Notifications.dismissNotificationAsync(FOCUS_TIMER_NOTIFICATION_ID).catch(() => {});
  });
}

/** A tap on the end notification: one of its buttons, or the notification itself. */
export interface FocusNotificationResponse {
  /**
   * extend: a timer's 5 more minutes; keepGoing: a starter's Keep going;
   * break: Take a break (a starter's Stop for now), which never ticks the task.
   */
  action: "done" | "extend" | "keepGoing" | "break" | "open";
  sessionId: string;
}

/** The focus response in a notification response, or null for anything else. */
export function parseFocusResponse(response: Notifications.NotificationResponse | null | undefined): FocusNotificationResponse | null {
  const request = response?.notification?.request;
  if (!request || request.identifier !== FOCUS_TIMER_NOTIFICATION_ID) return null;
  const sessionId = (request.content?.data as Record<string, unknown> | undefined)?.focusSessionId;
  if (typeof sessionId !== "string" || !sessionId) return null;
  const action =
    response?.actionIdentifier === FOCUS_ACTION_DONE
      ? "done"
      : response?.actionIdentifier === FOCUS_ACTION_EXTEND
        ? "extend"
        : response?.actionIdentifier === FOCUS_ACTION_KEEP_GOING
          ? "keepGoing"
          : response?.actionIdentifier === FOCUS_ACTION_BREAK
            ? "break"
            : "open";
  return { action, sessionId };
}

/**
 * Calls `listener` for each tap on a focus notification: while the app runs,
 * and once for the tap that launched it (a cold start). Each tap is passed on
 * once. Returns the unsubscribe.
 */
export function subscribeFocusResponses(listener: (response: FocusNotificationResponse) => void): () => void {
  if (Platform.OS === "web") return () => {};
  const seen = new Set<string>();
  const handle = (response: Notifications.NotificationResponse | null | undefined) => {
    const parsed = parseFocusResponse(response);
    if (!parsed || !response) return;
    const key = `${parsed.sessionId}|${response.actionIdentifier}|${response.notification.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    listener(parsed);
    // Handled: a later read (e.g. a JS reload) mustn't replay it.
    try {
      Notifications.clearLastNotificationResponse?.();
    } catch {
      // Replays are ignored anyway (the store checks the session id).
    }
  };
  let subscription: { remove: () => void } | null = null;
  try {
    subscription = Notifications.addNotificationResponseReceivedListener(handle);
  } catch {
    subscription = null;
  }
  try {
    handle(Notifications.getLastNotificationResponse?.());
  } catch {
    // No launch tap to handle.
  }
  return () => subscription?.remove();
}
