import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import {
  fitPlanToLimit,
  taskAwareStrategy,
  type ReminderContext,
  type ReminderPlan,
  type ReminderStrategy,
} from "./reminder-plan";
import { MANAGED_REMINDER_PREFIX } from "./reminders";
import type { NotificationPermissionState } from "./types";

let handlerConfigured = false;

/** What the reminders are planned from; `now` defaults to the moment of the call. */
export type SyncNotificationsInput = Omit<ReminderContext, "now" | "draft"> & {
  now?: Date;
  draft?: ReminderContext["draft"];
  /** How the plan is made (default: the task-aware reminders). */
  strategy?: ReminderStrategy;
};

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

/**
 * Cancels the pending reminders this code owns (ids under
 * MANAGED_REMINDER_PREFIX) and returns how many pending notifications aren't
 * ours (the focus timer's end, the trial reminder): those are never touched,
 * only counted towards iOS's limit.
 */
async function cancelAllManaged(): Promise<number> {
  if (Platform.OS === "web") return 0;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const managed = scheduled.filter(
    (s) => typeof s.identifier === "string" && s.identifier.startsWith(MANAGED_REMINDER_PREFIX),
  );
  await Promise.all(managed.map((s) => Notifications.cancelScheduledNotificationAsync(s.identifier)));
  return scheduled.length - managed.length;
}

// Syncs run one at a time: two overlapping cancel-then-schedule passes would
// interleave and leave duplicate (or missing) reminders.
let syncQueue: Promise<void> = Promise.resolve();

function queueSync(step: () => Promise<void>): Promise<void> {
  const run = syncQueue.then(step);
  // Keep the chain alive even if one sync fails.
  syncQueue = run.catch(() => {});
  return run;
}

/**
 * Plans the reminders from what the app knows now and replaces the pending
 * ones with that plan. Called whenever the tasks or the settings change and
 * when the app comes to the front: iOS can't run code when a notification
 * is delivered, so what one says is fixed when it's scheduled.
 */
export function syncNotifications({ strategy = taskAwareStrategy, now, draft = null, ...rest }: SyncNotificationsInput): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  const at = now ?? new Date();
  return queueSync(() => runPlan(strategy({ ...rest, draft, now: at }), at));
}

/**
 * Replaces every pending reminder this code owns with `plan` (any
 * strategy's). Notifications with other ids are left alone. The plan is cut
 * to what fits under iOS's limit of pending notifications (soonest kept).
 */
export function applyReminderPlan(plan: ReminderPlan, now: Date = new Date()): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  return queueSync(() => runPlan(plan, now));
}

async function runPlan(plan: ReminderPlan, now: Date): Promise<void> {
  configureHandler();
  const otherPending = await cancelAllManaged();

  for (const reminder of fitPlanToLimit(plan, { now, otherPending })) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.id,
        content: {
          title: reminder.title,
          body: reminder.body,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.fireAt,
        },
      });
    } catch (err) {
      // The id only: a reminder's words can be the user's task.
      console.warn(`[daily-tasks] failed to schedule reminder ${reminder.id}`, err);
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
// Its buttons, in the order the check-in, the Live Activity and the Dynamic
// Island have them: extend first (a timer's "5 more minutes"; a 5-minute
// starter's "Keep going", a 20-minute timer, as the check-in), then the quiet
// way out, "Take a break" ("Stop for now" on a starter), which ends the
// session and never ticks the task, then Mark done (it ticks the task). All
// open the app, so a tap is handled even when the app wasn't running (a
// background action is lost then).
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
    { identifier: FOCUS_ACTION_BREAK, buttonTitle: "Take a break", options: { opensAppToForeground: true } },
    { identifier: FOCUS_ACTION_DONE, buttonTitle: "Mark done", options: { opensAppToForeground: true } },
  ]);
  await Notifications.setNotificationCategoryAsync(FOCUS_STARTER_CATEGORY_ID, [
    { identifier: FOCUS_ACTION_KEEP_GOING, buttonTitle: "Keep going", options: { opensAppToForeground: true } },
    { identifier: FOCUS_ACTION_BREAK, buttonTitle: "Stop for now", options: { opensAppToForeground: true } },
    { identifier: FOCUS_ACTION_DONE, buttonTitle: "Mark done", options: { opensAppToForeground: true } },
  ]);
  categoryReady = true;
}

/** What the end notification needs from a running session. */
export interface FocusNotificationInput {
  sessionId: string;
  taskId: string;
  /**
   * Picks the buttons: a starter's Keep going / Stop for now / Mark done, a
   * timer's 5 more minutes / Take a break / Mark done.
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
