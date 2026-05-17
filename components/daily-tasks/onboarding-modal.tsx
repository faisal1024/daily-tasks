import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import type {
  UserEnergy,
  UserGoal,
  UserProfile,
  UserTimeWindow,
  UserWorkStyle,
} from "@/lib/daily-tasks/types";
import { DEFAULT_PROFILE } from "@/lib/daily-tasks/types";
import { USER_GOALS, USER_GOAL_META } from "@/lib/daily-tasks/task-catalog";

interface OnboardingModalProps {
  visible: boolean;
  profile: UserProfile;
  onComplete: (profile: UserProfile) => void;
}

const ENERGY_OPTIONS: { value: UserEnergy; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "steady", label: "Steady" },
  { value: "high", label: "High" },
];

const TIME_OPTIONS: { value: UserTimeWindow; label: string }[] = [
  { value: "quick", label: "5-10 min" },
  { value: "medium", label: "20 min" },
  { value: "deep", label: "45 min" },
];

const STYLE_OPTIONS: { value: UserWorkStyle; label: string }[] = [
  { value: "gentle", label: "Gentle" },
  { value: "structured", label: "Structured" },
  { value: "ambitious", label: "Ambitious" },
];

export function OnboardingModal({ visible, profile, onComplete }: OnboardingModalProps) {
  const colors = useColors();
  const [draft, setDraft] = useState<UserProfile>(profile ?? DEFAULT_PROFILE);

  useEffect(() => {
    if (visible) setDraft(profile ?? DEFAULT_PROFILE);
  }, [profile, visible]);

  const toggleGoal = (goal: UserGoal) => {
    setDraft((current) => {
      const goals = current.goals.includes(goal)
        ? current.goals.filter((item) => item !== goal)
        : [...current.goals, goal].slice(0, 4);
      return { ...current, goals: goals.length > 0 ? goals : current.goals };
    });
  };

  const complete = () => {
    onComplete(draft.goals.length > 0 ? draft : { ...draft, goals: DEFAULT_PROFILE.goals });
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={complete}
    >
      <View
        className="flex-1 justify-end"
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      >
        <View
          className="bg-background rounded-t-3xl p-6 gap-5"
          style={{ paddingBottom: 36 }}
        >
          <View className="gap-1">
            <Text className="text-sm" style={{ color: colors.muted }}>
              Welcome
            </Text>
            <Text className="text-2xl font-bold text-foreground">
              Make suggestions feel like yours.
            </Text>
          </View>

          <ScrollView
            className="max-h-[320px]"
            contentContainerStyle={{ gap: 16 }}
            showsVerticalScrollIndicator={false}
          >
            <Question title="What are you working toward?">
              <View className="flex-row flex-wrap gap-2">
                {USER_GOALS.map((goal) => (
                  <Choice
                    key={goal}
                    label={USER_GOAL_META[goal].label}
                    active={draft.goals.includes(goal)}
                    onPress={() => toggleGoal(goal)}
                  />
                ))}
              </View>
            </Question>

            <Question title="How is your energy most days?">
              <View className="flex-row flex-wrap gap-2">
                {ENERGY_OPTIONS.map((option) => (
                  <Choice
                    key={option.value}
                    label={option.label}
                    active={draft.energy === option.value}
                    onPress={() => setDraft((current) => ({ ...current, energy: option.value }))}
                  />
                ))}
              </View>
            </Question>

            <Question title="What kind of task fits your day?">
              <View className="flex-row flex-wrap gap-2">
                {TIME_OPTIONS.map((option) => (
                  <Choice
                    key={option.value}
                    label={option.label}
                    active={draft.timeWindow === option.value}
                    onPress={() =>
                      setDraft((current) => ({ ...current, timeWindow: option.value }))
                    }
                  />
                ))}
              </View>
            </Question>

            <Question title="How should the app nudge you?">
              <View className="flex-row flex-wrap gap-2">
                {STYLE_OPTIONS.map((option) => (
                  <Choice
                    key={option.value}
                    label={option.label}
                    active={draft.workStyle === option.value}
                    onPress={() =>
                      setDraft((current) => ({ ...current, workStyle: option.value }))
                    }
                  />
                ))}
              </View>
            </Question>
          </ScrollView>

          <Pressable
            onPress={complete}
            className="self-stretch rounded-full py-3 items-center"
            style={{ backgroundColor: colors.primary }}
            accessibilityRole="button"
            accessibilityLabel="Start today"
          >
            <Text
              className="text-base font-semibold"
              style={{ color: colors.background }}
            >
              Save profile
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Question({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl bg-surface border border-border p-4 gap-3">
      <Text className="text-base font-semibold text-foreground">{title}</Text>
      {children}
    </View>
  );
}

function Choice({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className="rounded-full px-3 py-2 border"
      style={{
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? `${colors.primary}16` : colors.background,
      }}
    >
      <Text
        className="text-sm font-semibold"
        style={{ color: active ? colors.primary : colors.foreground }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
