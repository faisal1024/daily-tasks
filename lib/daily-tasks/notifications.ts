import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { MANAGED_REMINDER_PREFIX, planReminders } from "./reminders";
import type { NotificationConfig, NotificationPermissionState } from "./types";

let handlerConfigured = false;

interface SyncNotificationsInput {
  now?: Date;
  settings: NotificationConfig;
  permissionState: NotificationPermissionState;
  taskCount: number;
  completedCount: number;
}

function configureHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
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

export async function syncNotifications({
  now = new Date(),
  settings,
  permissionState,
  taskCount,
  completedCount,
}: SyncNotificationsInput): Promise<void> {
  if (Platform.OS === "web") return;
  configureHandler();
  await cancelAllManaged();

  const planned = planReminders({
    now,
    taskCount,
    completedCount,
    settings,
    permissionState,
  });

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
