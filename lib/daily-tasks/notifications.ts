import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import type { NotificationConfig, NotificationKey } from "./types";

const SCHEDULED_PREFIX = "daily-tasks:";

const SLOT_MESSAGES: Record<NotificationKey, { title: string; body: string }> = {
  morning: {
    title: "Good morning!",
    body: "Time to plan your 3 daily tasks.",
  },
  evening: {
    title: "Evening check-in",
    body: "How are your tasks going?",
  },
  night: {
    title: "Final reminder",
    body: "Complete your remaining tasks.",
  },
};

let handlerConfigured = false;

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

export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  configureHandler();
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  if (settings.canAskAgain === false) return false;
  const result = await Notifications.requestPermissionsAsync();
  return result.granted;
}

async function cancelAllManaged() {
  if (Platform.OS === "web") return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((s) => typeof s.identifier === "string" && s.identifier.startsWith(SCHEDULED_PREFIX))
      .map((s) => Notifications.cancelScheduledNotificationAsync(s.identifier)),
  );
}

export async function syncNotifications(config: NotificationConfig): Promise<void> {
  if (Platform.OS === "web") return;
  configureHandler();
  await cancelAllManaged();

  const slots: NotificationKey[] = ["morning", "evening", "night"];
  for (const key of slots) {
    const slot = config[key];
    if (!slot.enabled) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${SCHEDULED_PREFIX}${key}`,
        content: SLOT_MESSAGES[key],
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: slot.hour,
          minute: slot.minute,
        },
      });
    } catch (err) {
      console.warn(`[daily-tasks] failed to schedule ${key} notification`, err);
    }
  }
}

export async function cancelAllNotifications(): Promise<void> {
  if (Platform.OS === "web") return;
  await cancelAllManaged();
}
