import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { CelebrationOverlay } from "@/components/daily-tasks/celebration-overlay";
import { MonthHistory } from "@/components/daily-tasks/month-history";
import { OnboardingModal } from "@/components/daily-tasks/onboarding-modal";
import { SectionLabel } from "@/components/daily-tasks/section-label";
import { WeeklyReviewCard } from "@/components/daily-tasks/weekly-review-card";
import { ScreenContainer } from "@/components/screen-container";
import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { stageForDays } from "@/lib/daily-tasks/journey";
import { pickCelebration } from "@/lib/daily-tasks/milestones";
import { track } from "@/lib/daily-tasks/analytics";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { buildWeeklyReview } from "@/lib/daily-tasks/weekly-review";

export default function JourneyScreen() {
  const colors = useColors();
  const {
    state,
    daysShowedUp,
    completeMilestone,
    uncompleteMilestone,
    completeMomentumOnboarding,
    momentumMilestones,
    pendingMilestoneCelebration,
    acknowledgeMilestoneCelebration,
    today,
  } = useDailyTasks();
  const weeklyReview = useMemo(() => buildWeeklyReview(state.history, today), [state.history, today]);

  const journey = state.journey;
  const stage = stageForDays(daysShowedUp);
  const goalTitle = state.momentumProfile.goalTitle;
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const milestonesDone = momentumMilestones.filter((m) => m.done).length;
  const nextMilestoneIndex = momentumMilestones.findIndex((m) => !m.done);

  // Levels are no longer shown, so only milestones celebrate here.
  const celebration = pickCelebration({ pendingMilestoneCelebration, pendingLevelUp: null });
  const showMilestoneCelebration = celebration === "milestone";

  const markNotReached = (id: string, title: string) => {
    Alert.alert("Mark as not reached?", `"${title}"`, [
      { text: "Keep it", style: "cancel" },
      { text: "Not reached yet", onPress: () => uncompleteMilestone(id) },
    ]);
  };

  const markReached = (id: string, title: string) => {
    Alert.alert("Reached this milestone?", `"${title}"`, [
      { text: "Not yet", style: "cancel" },
      { text: "Yes, I got there", onPress: () => completeMilestone(id) },
    ]);
  };

  return (
    <ScreenContainer>
      <ScrollView
        // Readable width on iPad.
        contentContainerStyle={{
          padding: 20,
          paddingBottom: 32,
          gap: 16,
          width: "100%",
          maxWidth: 720,
          alignSelf: "center",
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          className="text-foreground"
          style={{ fontFamily: Fonts.rounded, fontWeight: "800", fontSize: 34 }}
          accessibilityRole="header"
          maxFontSizeMultiplier={1.6}
        >
          Your progress
        </Text>

        {/* No goal yet (first run doesn't ask): offer one here, in context. */}
        {!goalTitle ? (
          <View className="rounded-2xl bg-surface border border-border p-4 gap-3" testID="set-goal-card">
            <Text className="text-lg font-bold text-foreground">What are you working toward?</Text>
            <Text className="text-sm" style={{ color: colors.muted }}>
              Add a goal and your coach suggests tasks and milestones toward it.
            </Text>
            <Pressable
              onPress={() => setGoalModalOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Set a goal"
              className="self-start rounded-full px-4 py-2"
              style={{ backgroundColor: colors.primary }}
            >
              <Text className="text-sm font-bold" style={{ color: "#fff" }}>
                Set a goal
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Growth hero: a calm tinted card (the one gradient is Today's finished day). */}
        <View
          className="rounded-3xl p-7 items-center"
          style={{ backgroundColor: `${colors.primary}12` }}
          testID="growth-hero"
        >
          <Text style={{ fontSize: 84 }} accessibilityElementsHidden importantForAccessibility="no">
            {stage.glyph}
          </Text>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.6}
            style={{
              color: colors.foreground,
              fontFamily: Fonts.rounded,
              fontWeight: "800",
              fontSize: 28,
              marginTop: 4,
            }}
          >
            Day {daysShowedUp} · {stage.label}
          </Text>
          <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 15, marginTop: 6, textAlign: "center" }}>
            {stage.nextAt
              ? `Days you've shown up. ${stage.nextAt - daysShowedUp} more to grow.`
              : "Days you've shown up. Fully grown."}
          </Text>
        </View>

        {/* Streak stats — colorful tinted cards */}
        <View className="flex-row gap-3">
          <StatCard
            icon="flame"
            label="Showed up"
            value={journey.showedUpStreak}
            tint={colors.accent}
          />
          <StatCard
            icon="star"
            label="Best run"
            value={journey.longestShowedUpStreak}
            tint={colors.primary}
          />
        </View>

        <View
          className="rounded-2xl p-4 flex-row items-center gap-3"
          style={{ backgroundColor: `${colors.primary}12` }}
        >
          <Ionicons name="snow-outline" size={22} color={colors.primary} />
          <Text className="flex-1 text-base font-medium" style={{ color: colors.muted }}>
            {journey.showedUpFreezes > 0
              ? `${journey.showedUpFreezes} streak freeze${
                  journey.showedUpFreezes === 1 ? "" : "s"
                } ready — miss a day without losing your run.`
              : "Show up a few days in a row to earn a streak freeze."}
          </Text>
        </View>

        <View className="gap-3">
          <SectionLabel icon="calendar-outline" label="Your last 7 days" />
          {/* Free for everyone: seeing your own patterns builds the habit
              (the review's value is retention, not a paywall). */}
          <WeeklyReviewCard review={weeklyReview} plus canUnlock={false} onUnlock={() => {}} />
        </View>

        {/* Milestones toward the goal: ticked off by hand */}
        {momentumMilestones.length > 0 && (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <SectionLabel
                icon="trail-sign-outline"
                label={goalTitle ? `Path to ${goalTitle}` : "Your milestones"}
              />
              <Text className="text-base font-extrabold" style={{ color: colors.primary }}>
                {milestonesDone}/{momentumMilestones.length}
              </Text>
            </View>
            <Text className="text-sm" style={{ color: colors.muted }}>
              Tick one off when you get there.
            </Text>
            {momentumMilestones.map((milestone, index) => {
              const isNext = !milestone.done && index === nextMilestoneIndex;
              return (
                <View
                  key={milestone.id}
                  className="bg-surface rounded-2xl p-4 border flex-row items-center gap-3"
                  style={{ borderColor: colors.border }}
                >
                  <Ionicons
                    // Only a reached milestone is filled; "next" is just a label,
                    // so a new path never looks like it's already started.
                    name={milestone.done ? "checkmark-circle" : "ellipse-outline"}
                    size={20}
                    color={milestone.done ? colors.success : colors.muted}
                    accessibilityElementsHidden
                  />
                  <View className="flex-1 gap-1">
                    {isNext ? (
                      <Text
                        className="text-xs font-bold uppercase"
                        style={{ color: colors.primary, letterSpacing: 0.6 }}
                      >
                        Up next
                      </Text>
                    ) : null}
                    <Text
                      className="text-lg font-bold"
                      style={{ color: milestone.done ? colors.muted : colors.foreground }}
                    >
                      {milestone.title}
                    </Text>
                    {milestone.description ? (
                      <Text className="text-sm text-muted">{milestone.description}</Text>
                    ) : null}
                  </View>
                  {milestone.done ? (
                    <Pressable
                      onPress={() => markNotReached(milestone.id, milestone.title)}
                      accessibilityRole="button"
                      accessibilityLabel={`"${milestone.title}" reached`}
                      accessibilityHint="Double-tap to mark it as not reached"
                      hitSlop={8}
                      testID={`milestone-done-${milestone.id}`}
                    >
                      <Text className="text-sm font-bold" style={{ color: colors.success }}>
                        Done
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => markReached(milestone.id, milestone.title)}
                      accessibilityRole="button"
                      accessibilityLabel={`Mark "${milestone.title}" as reached`}
                      hitSlop={8}
                      className="rounded-full px-3 py-1.5"
                      style={{ backgroundColor: `${colors.primary}14` }}
                      testID={`milestone-reach-${milestone.id}`}
                    >
                      <Text className="text-sm font-bold" style={{ color: colors.primary }}>
                        Mark reached
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}


        {/* Month by month (this used to be its own Calendar tab). */}
        <View className="gap-3">
          <SectionLabel icon="calendar-number-outline" label="History" />
          <MonthHistory />
        </View>
      </ScrollView>

      <CelebrationOverlay
        visible={showMilestoneCelebration}
        onDismiss={acknowledgeMilestoneCelebration}
        emoji="🏆"
        title="Milestone reached!"
        subtitle={`You reached: ${pendingMilestoneCelebration ?? ""}`}
      />
      <OnboardingModal
        visible={goalModalOpen}
        startAt="goal"
        initialProfile={state.momentumProfile}
        onRequestClose={() => setGoalModalOpen(false)}
        onComplete={(profile) => {
          completeMomentumOnboarding(profile);
          setGoalModalOpen(false);
          track("goal_set", { source: "progress" });
        }}
      />
    </ScreenContainer>
  );
}

function StatCard({
  icon,
  label,
  value,
  tint,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: number;
  tint: string;
}) {
  const colors = useColors();
  return (
    <View
      className="flex-1 rounded-3xl p-4 border"
      style={{ backgroundColor: colors.surface, borderColor: colors.border }}
    >
      <View className="flex-row items-center gap-1.5">
        <Ionicons
          name={icon}
          size={14}
          color={tint}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        {/* Colour on the icon only: tinted label text was too faint to read. */}
        <Text className="text-sm uppercase font-extrabold" style={{ color: colors.muted }}>
          {label}
        </Text>
      </View>
      <Text
        className="text-4xl text-foreground mt-1.5"
        style={{ fontFamily: Fonts.rounded, fontWeight: "800" }}
        maxFontSizeMultiplier={1.6}
      >
        {value}
      </Text>
    </View>
  );
}
