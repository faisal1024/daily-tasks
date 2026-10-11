import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";

import {
  fitPlanToLimit,
  IOS_PENDING_NOTIFICATION_LIMIT,
  taskAwareStrategy,
  type PendingReminder,
  type ReminderContext,
  type ReminderPlan,
  type ReminderPlanItem,
  type ReminderStrategy,
} from "./reminder-plan";
import { NAG_CATEGORY_ID, NAG_KIND } from "./nag-plan";
import { MANAGED_REMINDER_PREFIX } from "./reminders";
import type { NotificationPermissionState } from "./types";

let handlerConfigured = false;

/**
 * What the reminders are planned from; `now` defaults to the moment of the
 * call. The scheduler adds what is pending and when one last went off.
 */
export type SyncNotificationsInput = Omit<ReminderContext, "now" | "draft" | "pending" | "lastDeliveredAt"> & {
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

function isManaged(identifier: unknown): identifier is string {
  return typeof identifier === "string" && identifier.startsWith(MANAGED_REMINDER_PREFIX);
}

/**
 * When a pending notification will go off, from its trigger as the system
 * reports it: a timestamp (Android) or calendar components. null when it
 * can't be told. On iOS it can't: expo-notifications schedules a one-off
 * date as a time interval and reports it back as `{ type: "timeInterval",
 * seconds, repeats }`, the seconds counted from when it was scheduled, which
 * isn't known here. So each reminder also carries its time in its own data
 * (see contentFor and pendingTime); this is the fallback.
 */
export function pendingFireAt(trigger: unknown): Date | null {
  if (!trigger || typeof trigger !== "object") return null;
  const t = trigger as { type?: unknown; value?: unknown; date?: unknown; dateComponents?: Record<string, unknown> };
  const stamp = t.value ?? t.date;
  if (t.type === "date" && (typeof stamp === "number" || stamp instanceof Date)) {
    const at = new Date(stamp);
    return Number.isFinite(at.getTime()) ? at : null;
  }
  if (t.type === "calendar" && t.dateComponents) {
    const { year, month, day, hour, minute, second } = t.dateComponents;
    if ([year, month, day, hour, minute].every((part) => typeof part === "number")) {
      const at = new Date(
        year as number,
        (month as number) - 1,
        day as number,
        hour as number,
        minute as number,
        typeof second === "number" ? second : 0,
      );
      return Number.isFinite(at.getTime()) ? at : null;
    }
  }
  return null;
}

/**
 * When one of our pending reminders will go off: the time it carries in its
 * data (written by contentFor; the only way to know on iOS), else what its
 * trigger says. null when neither tells (it is then rescheduled).
 */
function pendingTime(data: unknown, trigger: unknown): Date | null {
  const stamp = data && typeof data === "object" ? (data as Record<string, unknown>).fireAt : undefined;
  if (typeof stamp === "number" && Number.isFinite(stamp) && stamp > 0) return new Date(stamp);
  return pendingFireAt(trigger);
}

interface PendingState {
  /** Our pending reminders, soonest first (unknown times last). */
  managed: PendingReminder[];
  /** Pending notifications that aren't ours (the focus timer's end, the trial reminder): never touched, only counted towards iOS's limit. */
  otherPending: number;
}

async function readPending(): Promise<PendingState> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const managed: PendingReminder[] = scheduled
    .filter((request) => isManaged(request.identifier))
    .map((request) => {
      const data = request.content?.data;
      return {
        id: request.identifier,
        fireAt: pendingTime(data, request.trigger),
        title: request.content?.title ?? "",
        body: request.content?.body ?? "",
        ...(data && typeof data === "object" ? { data: data as Record<string, unknown> } : {}),
      };
    })
    .sort((a, b) => (a.fireAt?.getTime() ?? Infinity) - (b.fireAt?.getTime() ?? Infinity));
  return { managed, otherPending: scheduled.length - managed.length };
}

/** Cancels one pending reminder; false (and a warning with the id only) if that failed. */
async function cancelOne(id: string): Promise<boolean> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
    scheduledTimes.delete(id);
    return true;
  } catch (err) {
    // The id only: a reminder's words can be the user's task.
    console.warn(`[daily-tasks] failed to cancel reminder ${id}`, err);
    return false;
  }
}

// Syncs run one at a time: two overlapping passes would interleave and
// leave duplicate (or missing) reminders.
let syncQueue: Promise<void> = Promise.resolve();

function queueSync(step: () => Promise<void>): Promise<void> {
  const run = syncQueue.then(step);
  // Keep the chain alive even if one sync fails.
  syncQueue = run.catch(() => {});
  return run;
}

// When each reminder scheduled since the app started goes off (by id), and
// the latest time one is known to have gone off: see lastDeliveredAt.
const scheduledTimes = new Map<string, number>();
let lastDelivered: number | null = null;
// "Hide task names" at the last sync (null before the first).
let lastHideTaskNames: boolean | null = null;

/** A delivered notification's date in ms (iOS reports seconds, Android ms). */
function deliveredMs(date: unknown): number | null {
  if (typeof date !== "number" || !Number.isFinite(date) || date <= 0) return null;
  return date < 1e11 ? date * 1000 : date;
}

async function presentedManaged(): Promise<Notifications.Notification[]> {
  if (typeof Notifications.getPresentedNotificationsAsync !== "function") return [];
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    return presented.filter((notification) => isManaged(notification?.request?.identifier));
  } catch {
    return [];
  }
}

/** See ReminderContext.lastDeliveredAt. */
async function readLastDelivered(pending: PendingReminder[], now: Date): Promise<Date | null> {
  const stillPending = new Set(pending.map((item) => item.id));
  for (const [id, time] of scheduledTimes) {
    if (time > now.getTime() || stillPending.has(id)) continue;
    // Its time has passed and it is no longer pending: it went off.
    lastDelivered = Math.max(lastDelivered ?? 0, time);
    scheduledTimes.delete(id);
  }
  for (const notification of await presentedManaged()) {
    const at = deliveredMs(notification.date);
    if (at !== null && at <= now.getTime() + 60_000) lastDelivered = Math.max(lastDelivered ?? 0, at);
  }
  return lastDelivered === null ? null : new Date(lastDelivered);
}

/**
 * Clears our reminders that already went off from Notification Center and
 * the lock screen: what they say is fixed when they're scheduled, so they
 * go stale (a count that has moved on, a task since done, names since
 * hidden). Other notifications are left alone.
 */
async function dismissDeliveredManaged(): Promise<void> {
  if (typeof Notifications.dismissNotificationAsync !== "function") return;
  for (const notification of await presentedManaged()) {
    try {
      await Notifications.dismissNotificationAsync(notification.request.identifier);
    } catch {
      // It stays until the user clears it.
    }
  }
}

function appIsActive(): boolean {
  return AppState?.currentState === "active";
}

/**
 * Plans the reminders from what the app knows now and makes the pending
 * ones match that plan. Called whenever the tasks or the settings change and
 * when the app comes to the front: iOS can't run code when a notification
 * is delivered, so what one says is fixed when it's scheduled.
 *
 * Reminders that already went off are cleared while the app is in front
 * (the app itself says what's open), and when "Hide task names" has just
 * been turned on.
 */
export function syncNotifications({ strategy = taskAwareStrategy, now, draft = null, ...rest }: SyncNotificationsInput): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  const at = now ?? new Date();
  return queueSync(async () => {
    configureHandler();
    const state = await readPending();
    const lastDeliveredAt = await readLastDelivered(state.managed, at);
    const hide = rest.settings.hideTaskNames === true;
    const namesJustHidden = hide && lastHideTaskNames === false;
    const plan = await strategy({ ...rest, draft, now: at, pending: state.managed, lastDeliveredAt });
    await runPlan(plan, at, { state, dismissDelivered: appIsActive() || namesJustHidden });
    lastHideTaskNames = hide;
  });
}

export interface ApplyReminderPlanOptions {
  /** Also clear our reminders that already went off (see syncNotifications). Default false. */
  dismissDelivered?: boolean;
}

/**
 * Makes the pending reminders this code owns match `plan` (any strategy's).
 * Notifications with other ids are left alone. The plan is cut to what fits
 * under iOS's limit of pending notifications (soonest kept).
 */
export function applyReminderPlan(plan: ReminderPlan, now: Date = new Date(), options: ApplyReminderPlanOptions = {}): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  return queueSync(() => runPlan(plan, now, options));
}

/** A pending reminder that already is what the plan wants: same words, same time. */
function alreadyPending(pending: PendingReminder | undefined, item: ReminderPlanItem): boolean {
  return (
    !!pending &&
    pending.fireAt !== null &&
    pending.title === item.title &&
    pending.body === item.body &&
    Math.abs(pending.fireAt.getTime() - item.fireAt.getTime()) < 1000
  );
}

function contentFor(item: ReminderPlanItem): Notifications.NotificationContentInput {
  // Its own time goes with it: iOS doesn't report a pending one-off's date
  // back (see pendingFireAt), and without it every sync would reschedule
  // every reminder.
  const data = { ...item.data, ...(item.kind ? { kind: item.kind } : {}), fireAt: item.fireAt.getTime() };
  return {
    title: item.title,
    body: item.body,
    data,
    ...(item.sound !== undefined ? { sound: item.sound } : {}),
    ...(item.interruptionLevel ? { interruptionLevel: item.interruptionLevel } : {}),
    ...(item.categoryId ? { categoryIdentifier: item.categoryId } : {}),
  };
}

/**
 * Schedules the plan first, then cancels what is no longer in it. Ids are
 * fixed by time and kind, and scheduling an id that is already pending
 * replaces it, so there is never a moment with nothing pending (a sync
 * interrupted halfway leaves the old reminders, not none). One that already
 * says the same at the same time is left as it is. A failed schedule or
 * cancel is skipped; the rest still run.
 */
async function runPlan(
  plan: ReminderPlan,
  now: Date,
  { state, dismissDelivered = false }: ApplyReminderPlanOptions & { state?: PendingState } = {},
): Promise<void> {
  configureHandler();
  const { managed, otherPending } = state ?? (await readPending());
  const fitted = fitPlanToLimit(plan, { now, otherPending });
  const wanted = new Set(fitted.map((item) => item.id));
  const pendingById = new Map(managed.map((item) => [item.id, item]));
  const stale = managed.filter((item) => !wanted.has(item.id)).map((item) => item.id);

  // Only if old and new together wouldn't fit under iOS's limit (it would
  // drop some silently) do the old ones go first.
  const added = fitted.filter((item) => !pendingById.has(item.id)).length;
  const crowded = otherPending + managed.length + added > IOS_PENDING_NOTIFICATION_LIMIT;
  if (crowded) await Promise.all(stale.map(cancelOne));

  for (const item of fitted) {
    const pending = pendingById.get(item.id);
    scheduledTimes.set(item.id, item.fireAt.getTime());
    if (alreadyPending(pending, item)) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: item.id,
        content: contentFor(item),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: item.fireAt,
        },
      });
    } catch (err) {
      // The id only: a reminder's words can be the user's task.
      console.warn(`[daily-tasks] failed to schedule reminder ${item.id}`, err);
      // The one it was meant to replace says something out of date (maybe a
      // name that is now hidden): better none than that.
      if (pending) await cancelOne(item.id);
      else scheduledTimes.delete(item.id);
    }
  }

  if (!crowded) await Promise.all(stale.map(cancelOne));
  if (dismissDelivered) await dismissDeliveredManaged();
}

/** Cancels every pending reminder this code owns (nothing else). */
export async function cancelAllNotifications(): Promise<void> {
  if (Platform.OS === "web") return;
  const { managed } = await readPending();
  await Promise.all(managed.map((item) => cancelOne(item.id)));
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

// Nag mode (1.4): a nag carries one button, "Stop for today". Like the focus
// buttons it opens the app, so the tap is handled even when the app wasn't
// running (a background action is lost then). A tap on the nag itself just
// opens the app, on Today.
export const NAG_ACTION_STOP = "nag-stop-today";
let nagCategoryReady = false;

/** Registers the nag category's button, at every launch. Best-effort: without it a nag still arrives. */
export function registerNagCategory(): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  return (async () => {
    if (nagCategoryReady || typeof Notifications.setNotificationCategoryAsync !== "function") return;
    await Notifications.setNotificationCategoryAsync(NAG_CATEGORY_ID, [
      { identifier: NAG_ACTION_STOP, buttonTitle: "Stop for today", options: { opensAppToForeground: true } },
    ]);
    nagCategoryReady = true;
  })().catch(() => {});
}

/** A tap on a nag's "Stop for today". */
export interface NagNotificationResponse {
  action: "stop";
  /** The day the nag was for (yyyy-MM-dd), from its id. */
  dayKey: string;
}

/** The nag response in a notification response, or null for anything else (a plain tap included). */
export function parseNagNotificationResponse(response: Notifications.NotificationResponse | null | undefined): NagNotificationResponse | null {
  const request = response?.notification?.request;
  if (!request || !isManaged(request.identifier) || response?.actionIdentifier !== NAG_ACTION_STOP) return null;
  const [dayKey, kind] = request.identifier.slice(MANAGED_REMINDER_PREFIX.length).split(":");
  if (kind !== NAG_KIND || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey ?? "")) return null;
  return { action: "stop", dayKey };
}

/**
 * Calls `listener` for each "Stop for today": while the app runs, and once
 * for the tap that launched it. Each tap is passed on once. Returns the
 * unsubscribe.
 */
export function subscribeNagResponses(listener: (response: NagNotificationResponse) => void): () => void {
  if (Platform.OS === "web") return () => {};
  const seen = new Set<string>();
  const handle = (response: Notifications.NotificationResponse | null | undefined) => {
    const parsed = parseNagNotificationResponse(response);
    if (!parsed || !response) return;
    const key = `${response.notification.request.identifier}|${response.notification.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    listener(parsed);
    try {
      Notifications.clearLastNotificationResponse?.();
    } catch {
      // A replay only pauses a day that is already paused.
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
