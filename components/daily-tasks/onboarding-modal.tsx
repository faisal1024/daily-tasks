import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/use-colors";
import type {
  Cadence,
  ExperienceLevel,
  GoalSource,
  MomentumProfile,
  PreferredTime,
  StruggleType,
  TimeAvailability,
} from "@/lib/daily-tasks/types";
import {
  DEFAULT_MOMENTUM_PROFILE,
  GOAL_OPTIONS,
} from "@/lib/daily-tasks/types";

interface OnboardingModalProps {
  visible: boolean;
  initialProfile?: MomentumProfile;
  onComplete: (profile: MomentumProfile) => void;
  onRequestClose?: () => void;
}

type Step = "welcome" | "goal" | "context" | "preferences" | "ready";

const TIME_OPTIONS: { value: TimeAvailability; label: string }[] = [
  { value: "15_min", label: "15 min" },
  { value: "30_min", label: "30 min" },
  { value: "60_min", label: "1 hour" },
];

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

const STRUGGLE_OPTIONS: { value: StruggleType; label: string }[] = [
  { value: "overwhelm", label: "Overwhelm" },
  { value: "consistency", label: "Consistency" },
  { value: "motivation", label: "Motivation" },
  { value: "time", label: "Time" },
];

const PREFERRED_TIME_OPTIONS: { value: PreferredTime; label: string }[] = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
  { value: "anytime", label: "Anytime" },
];

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "few_times", label: "A few days a week" },
];

export function OnboardingModal({
  visible,
  initialProfile = DEFAULT_MOMENTUM_PROFILE,
  onComplete,
  onRequestClose,
}: OnboardingModalProps) {
  const colors = useColors();
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState(initialProfile.name ?? "");
  const [goalTitle, setGoalTitle] = useState(initialProfile.goalTitle ?? "");
  const [goalSource, setGoalSource] = useState<GoalSource | null>(
    initialProfile.goalSource,
  );
  const [timeAvailability, setTimeAvailability] =
    useState<TimeAvailability | null>(initialProfile.timeAvailability);
  const [experienceLevel, setExperienceLevel] =
    useState<ExperienceLevel | null>(initialProfile.experienceLevel);
  const [struggleType, setStruggleType] =
    useState<StruggleType | null>(initialProfile.struggleType);
  const [motivation, setMotivation] = useState(initialProfile.motivation ?? "");
  const [preferredTime, setPreferredTime] = useState<PreferredTime | null>(
    initialProfile.preferredTime,
  );
  const [cadence, setCadence] = useState<Cadence | null>(initialProfile.cadence);

  useEffect(() => {
    if (!visible) return;
    setStep("welcome");
    setName(initialProfile.name ?? "");
    setGoalTitle(initialProfile.goalTitle ?? "");
    setGoalSource(initialProfile.goalSource);
    setTimeAvailability(initialProfile.timeAvailability);
    setExperienceLevel(initialProfile.experienceLevel);
    setStruggleType(initialProfile.struggleType);
    setMotivation(initialProfile.motivation ?? "");
    setPreferredTime(initialProfile.preferredTime);
    setCadence(initialProfile.cadence);
  }, [initialProfile, visible]);

  const trimmedGoal = goalTitle.trim();
  const canContinueGoal = trimmedGoal.length > 0 && goalSource !== null;
  const canContinueContext = Boolean(timeAvailability && experienceLevel && struggleType);
  const canContinuePreferences = Boolean(preferredTime && cadence);
  const canFinish = Boolean(
    canContinueGoal && canContinueContext && canContinuePreferences,
  );

  const finish = () => {
    if (!canFinish) return;
    onComplete({
      name: name.trim() ? name.trim() : null,
      goalTitle: trimmedGoal,
      goalSource,
      timeAvailability,
      experienceLevel,
      struggleType,
      motivation: motivation.trim() ? motivation.trim() : null,
      preferredTime,
      cadence,
      onboardingCompletedAt: new Date().toISOString(),
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onRequestClose}
    >
      <KeyboardAvoidingView
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(0,0,0,0.45)",
        }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          className="bg-background rounded-t-3xl p-6 gap-5"
          style={{ paddingBottom: 36 }}
        >
          {step === "welcome" && (
            <>
              <Header
                eyebrow="Welcome"
                title="Your friendly coach for three daily wins."
              />
              <Text className="text-base" style={{ color: colors.muted }}>
                Momentum helps you choose the right three tasks, follow
                through, and build momentum without an endless list.
              </Text>
              <View className="gap-2 mt-1">
                <Text className="text-base font-semibold text-foreground">
                  What should we call you?
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Your first name"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="words"
                  returnKeyType="done"
                  maxLength={40}
                  className="text-lg text-foreground rounded-2xl px-4 py-3"
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  }}
                />
                <Text className="text-sm" style={{ color: colors.muted }}>
                  Optional — we&apos;ll use it to greet you.
                </Text>
              </View>
              <PrimaryButton label="Get Started" onPress={() => setStep("goal")} />
            </>
          )}

          {step === "goal" && (
            <>
              <Header eyebrow="Step 1 of 3" title="What are you working toward?" />
              <ScrollView
                className="max-h-[360px]"
                contentContainerStyle={{ gap: 12 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {GOAL_OPTIONS.map((goal) => (
                  <OptionButton
                    key={goal}
                    label={goal}
                    selected={trimmedGoal === goal && goalSource === "suggested"}
                    onPress={() => {
                      setGoalTitle(goal);
                      setGoalSource("suggested");
                    }}
                  />
                ))}
                <View className="flex-row items-center gap-3 my-1">
                  <View className="flex-1 h-px" style={{ backgroundColor: colors.border }} />
                  <Text
                    className="text-xs uppercase tracking-wide"
                    style={{ color: colors.muted }}
                  >
                    or set your own
                  </Text>
                  <View className="flex-1 h-px" style={{ backgroundColor: colors.border }} />
                </View>
                <View
                  className="rounded-2xl p-4 gap-2"
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: goalSource === "custom" ? colors.primary : colors.border,
                    borderWidth: goalSource === "custom" ? 2 : 1,
                  }}
                >
                  <Text className="text-sm font-semibold text-foreground">
                    Type your own goal
                  </Text>
                  <TextInput
                    value={goalSource === "custom" ? goalTitle : ""}
                    onChangeText={(text) => {
                      setGoalTitle(text);
                      setGoalSource("custom");
                    }}
                    onFocus={() => {
                      setGoalSource("custom");
                      if (GOAL_OPTIONS.includes(goalTitle)) setGoalTitle("");
                    }}
                    placeholder="e.g. Run a marathon, Write a book, Save $5,000"
                    placeholderTextColor={colors.muted}
                    className="text-base text-foreground rounded-xl px-3 py-3"
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                    }}
                  />
                  <Text className="text-xs" style={{ color: colors.muted }}>
                    Momentum builds a personalized plan and daily tasks for whatever you
                    choose.
                  </Text>
                </View>
              </ScrollView>
              <FooterButtons
                backLabel="Back"
                nextLabel="Next"
                nextDisabled={!canContinueGoal}
                onBack={() => setStep("welcome")}
                onNext={() => setStep("context")}
              />
            </>
          )}

          {step === "context" && (
            <>
              <Header eyebrow="Step 2 of 3" title="Help Momentum keep it doable." />
              <ScrollView
                className="max-h-[420px]"
                contentContainerStyle={{ gap: 18 }}
                showsVerticalScrollIndicator={false}
              >
                <OptionGroup
                  title="Time per day"
                  options={TIME_OPTIONS}
                  value={timeAvailability}
                  onChange={setTimeAvailability}
                />
                <OptionGroup
                  title="Experience"
                  options={EXPERIENCE_OPTIONS}
                  value={experienceLevel}
                  onChange={setExperienceLevel}
                />
                <OptionGroup
                  title="Main struggle"
                  options={STRUGGLE_OPTIONS}
                  value={struggleType}
                  onChange={setStruggleType}
                />
              </ScrollView>
              <FooterButtons
                backLabel="Back"
                nextLabel="Next"
                nextDisabled={!canContinueContext}
                onBack={() => setStep("goal")}
                onNext={() => setStep("preferences")}
              />
            </>
          )}

          {step === "preferences" && (
            <>
              <Header
                eyebrow="Step 3 of 3"
                title="A few details for sharper suggestions."
              />
              <ScrollView
                className="max-h-[420px]"
                contentContainerStyle={{ gap: 18 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View className="gap-2">
                  <Text className="text-base font-semibold text-foreground">
                    Why does this matter to you?
                  </Text>
                  <TextInput
                    value={motivation}
                    onChangeText={setMotivation}
                    placeholder="e.g. To feel strong and keep up with my kids"
                    placeholderTextColor={colors.muted}
                    multiline
                    className="text-base text-foreground rounded-xl px-3 py-3"
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                      minHeight: 64,
                    }}
                  />
                  <Text className="text-sm" style={{ color: colors.muted }}>
                    Optional — but it helps Momentum keep you motivated.
                  </Text>
                </View>
                <OptionGroup
                  title="Best time of day"
                  options={PREFERRED_TIME_OPTIONS}
                  value={preferredTime}
                  onChange={setPreferredTime}
                />
                <OptionGroup
                  title="How often do you want to commit?"
                  options={CADENCE_OPTIONS}
                  value={cadence}
                  onChange={setCadence}
                />
              </ScrollView>
              <FooterButtons
                backLabel="Back"
                nextLabel="Preview"
                nextDisabled={!canContinuePreferences}
                onBack={() => setStep("context")}
                onNext={() => setStep("ready")}
              />
            </>
          )}

          {step === "ready" && (
            <>
              <Header eyebrow="First win" title="Commit to today, not forever." />
              <View className="rounded-2xl bg-surface border border-border p-4 gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  Momentum will coach your first three commitments for:
                </Text>
                <Text className="text-lg font-bold text-foreground">
                  {trimmedGoal}
                </Text>
                <Text className="text-sm" style={{ color: colors.muted }}>
                  You can accept suggestions, edit them, or write your own. The
                  limit stays at three so the day stays honest.
                </Text>
              </View>
              <FooterButtons
                backLabel="Back"
                nextLabel="Show Today's Three"
                onBack={() => setStep("preferences")}
                onNext={finish}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Header({ eyebrow, title }: { eyebrow: string; title: string }) {
  const colors = useColors();
  return (
    <View className="gap-1">
      <Text className="text-sm" style={{ color: colors.muted }}>
        {eyebrow}
      </Text>
      <Text className="text-2xl font-bold text-foreground">{title}</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      className="self-stretch rounded-full py-3 items-center"
      style={{ backgroundColor: colors.primary }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text className="text-base font-semibold" style={{ color: colors.background }}>
        {label}
      </Text>
    </Pressable>
  );
}

function FooterButtons({
  backLabel,
  nextLabel,
  nextDisabled = false,
  onBack,
  onNext,
}: {
  backLabel: string;
  nextLabel: string;
  nextDisabled?: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const colors = useColors();
  return (
    <View className="flex-row gap-3">
      <Pressable
        onPress={onBack}
        className="flex-1 rounded-full py-3 items-center border border-border"
        accessibilityRole="button"
        accessibilityLabel={backLabel}
      >
        <Text className="text-base font-semibold text-foreground">{backLabel}</Text>
      </Pressable>
      <Pressable
        onPress={onNext}
        disabled={nextDisabled}
        className="flex-1 rounded-full py-3 items-center"
        style={{
          backgroundColor: nextDisabled ? colors.border : colors.primary,
        }}
        accessibilityRole="button"
        accessibilityLabel={nextLabel}
      >
        <Text
          className="text-base font-semibold"
          style={{ color: nextDisabled ? colors.muted : colors.background }}
        >
          {nextLabel}
        </Text>
      </Pressable>
    </View>
  );
}

function OptionGroup<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-semibold text-foreground">{title}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => (
          <OptionButton
            key={option.value}
            label={option.label}
            selected={value === option.value}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

function OptionButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full px-4 py-3 border"
      style={{
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? `${colors.primary}16` : colors.surface,
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text
        className="text-sm font-semibold"
        style={{ color: selected ? colors.primary : colors.foreground }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
