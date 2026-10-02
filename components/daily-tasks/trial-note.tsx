import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import { track } from "@/lib/daily-tasks/analytics";
import { usePlus } from "@/lib/daily-tasks/plus-context";
import { manageSubscriptions } from "@/lib/daily-tasks/purchases";
import {
  loadPlusUses,
  loadTrialNoteRecord,
  saveTrialNoteRecord,
  shouldShowTrialNote,
  trialKey,
  trialNoteCopy,
  usageDuring,
  type TrialNoteCopy,
} from "@/lib/daily-tasks/trial-note";

/**
 * The day-5 trial note on Today: what Plus did during the trial (local
 * counts only) and when it ends, with a way to manage the subscription.
 * Once per trial: it stays until dismissed (or Manage), then never again for
 * that trial. In-app only, never a notification.
 */
export function TrialNote({ today, active = true }: { today: string; active?: boolean }) {
  const colors = useColors();
  const { trial } = usePlus();
  const [copy, setCopy] = useState<TrialNoteCopy | null>(null);
  const key = trial ? trialKey(trial) : null;

  // Checked when the trial changes, each new day and on coming to the
  // foreground (never during a background launch).
  useEffect(() => {
    setCopy(null);
    if (!trial || !key || !active) return;
    let cancelled = false;
    void (async () => {
      const record = await loadTrialNoteRecord();
      const now = Date.now();
      if (cancelled || !shouldShowTrialNote({ trial, record, now })) return;
      const usage = usageDuring(await loadPlusUses(), trial, now);
      if (cancelled) return;
      setCopy(trialNoteCopy(usage, trial, now));
      // trial_note_shown once per trial (it may stay up across launches).
      if (record?.key !== key) {
        track("trial_note_shown", { count: usage.brain_dump + usage.break_down + usage.coach_note + usage.tomorrow_draft });
        void saveTrialNoteRecord({ key, dismissed: false });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Not on every status refresh (a new trial object, same trial).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, trial?.endsAt, trial?.willRenew, today, active]);

  if (!copy || !key) return null;

  const dismiss = (action: "close" | "manage") => {
    setCopy(null);
    track("trial_note_dismissed", { action });
    void saveTrialNoteRecord({ key, dismissed: true });
  };

  return (
    <View
      className="bg-surface rounded-2xl p-4 border"
      style={{ borderColor: colors.border }}
      testID="trial-note"
    >
      <View className="flex-row items-start gap-3">
        <Ionicons name="sparkles-outline" size={20} color={colors.primary} />
        <View className="flex-1 gap-1">
          <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">
            {copy.title}
          </Text>
          <Text className="text-xs text-muted">{copy.body}</Text>
          <View className="flex-row gap-2 mt-2">
            <Pressable
              onPress={() => {
                dismiss("manage");
                void manageSubscriptions();
              }}
              accessibilityRole="button"
              accessibilityLabel="Manage subscription"
              className="rounded-full px-4 py-2 border"
              style={{ borderColor: colors.border }}
              testID="trial-note-manage"
            >
              <Text className="text-xs font-semibold text-muted">Manage</Text>
            </Pressable>
          </View>
        </View>
        <Pressable
          onPress={() => dismiss("close")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss trial note"
          testID="trial-note-dismiss"
        >
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}
