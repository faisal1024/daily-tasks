import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { CelebrationOverlay } from "@/components/daily-tasks/celebration-overlay";
import { GradientCard } from "@/components/daily-tasks/gradient-card";
import { SectionLabel } from "@/components/daily-tasks/section-label";
import { WeeklyReviewCard } from "@/components/daily-tasks/weekly-review-card";
import { ScreenContainer } from "@/components/screen-container";
import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { stageForLevel } from "@/lib/daily-tasks/journey";
import { pickCelebration } from "@/lib/daily-tasks/milestones";
import { track } from "@/lib/daily-tasks/analytics";
import { usePlus } from "@/lib/daily-tasks/plus-context";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { buildWeeklyReview } from "@/lib/daily-tasks/weekly-review";

export default function JourneyScreen() {
  const colors = useColors();
  const {
    state,
    journeyLevel,
    journeyProgress,
    pendingLevelUp,
    acknowledgeLevelUp,
    momentumMilestones,
    pendingMilestoneCelebration,
    acknowledgeMilestoneCelebration,
    today,
    hasPlus,
    plusConfirmed,
  } = useDailyTasks();
  const { openPaywall } = usePlus();
  const weeklyReview = useMemo(() => buildWeeklyReview(state.history, today), [state.history, today]);

  const journey = state.journey;
  const stage = stageForLevel(journeyLevel);
  const ratio = Math.min(Math.max(journeyProgress.ratio, 0), 1);
  const xpToNext = journeyProgress.xpRemaining;
  const goalTitle = state.momentumProfile.goalTitle;
  const milestonesDone = momentumMilestones.filter((m) => m.done).length;
  const nextMilestoneIndex = momentumMilestones.findIndex((m) => !m.done);

  const celebration = pickCelebration({ pendingMilestoneCelebration, pendingLevelUp });
  const showMilestoneCelebration = celebration === "milestone";
  const showLevelCelebration = celebration === "level";

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
        >
          Your progress
        </Text>

        {/* Growth hero — gradient card (scheme-aware, self-measuring) */}
        <GradientCard
          className="rounded-3xl p-7 items-center"
          style={{
            shadowColor: colors.primary,
            shadowOpacity: 0.2,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 12 },
            elevation: 5,
          }}
        >
          <Text style={{ fontSize: 84 }}>{stage.glyph}</Text>
          <Text
            style={{
              color: "#fff",
              fontFamily: Fonts.rounded,
              fontWeight: "800",
              fontSize: 28,
              marginTop: 4,
            }}
          >
            Level {journeyLevel} · {stage.label}
          </Text>
          <View className="w-full mt-4 gap-2">
            <View
              className="w-full rounded-full overflow-hidden"
              style={{ height: 13, backgroundColor: "rgba(255,255,255,0.25)" }}
            >
              <View
                style={{
                  width: `${ratio * 100}%`,
                  height: "100%",
                  backgroundColor: "#FFD37A",
                  borderRadius: 999,
                }}
              />
            </View>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14, textAlign: "center" }}>
              {xpToNext} XP to Level {journeyLevel + 1} · {journey.xp} XP total
            </Text>
          </View>
        </GradientCard>

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
          <WeeklyReviewCard
            review={weeklyReview}
            // Patterns only once Plus is confirmed, and no upsell while it's
            // still being checked (hasPlus is true while pending).
            plus={plusConfirmed}
            canUnlock={!hasPlus}
            onUnlock={() => {
              track("plus_gate_hit", { feature: "weekly_review" });
              openPaywall("weekly_review");
            }}
          />
        </View>

        {/* Milestones toward the goal — advance automatically as you finish your days */}
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
              These advance on their own each day you finish all your tasks.
            </Text>
            {momentumMilestones.map((milestone, index) => {
              const isNext = !milestone.done && index === nextMilestoneIndex;
              return (
                <View
                  key={milestone.id}
                  className="bg-surface rounded-2xl p-4 border flex-row items-center gap-3"
                  style={{ borderColor: isNext ? colors.primary : colors.border }}
                >
                  <Ionicons
                    name={
                      milestone.done
                        ? "checkmark-circle"
                        : isNext
                          ? "ellipse"
                          : "ellipse-outline"
                    }
                    size={20}
                    color={
                      milestone.done
                        ? colors.success
                        : isNext
                          ? colors.primary
                          : colors.muted
                    }
                  />
                  <View className="flex-1 gap-1">
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
                    <Text className="text-sm font-bold" style={{ color: colors.success }}>
                      Done
                    </Text>
                  ) : isNext ? (
                    <Text className="text-sm font-bold" style={{ color: colors.primary }}>
                      In progress
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

      </ScrollView>

      <CelebrationOverlay
        visible={showMilestoneCelebration || showLevelCelebration}
        onDismiss={
          showMilestoneCelebration ? acknowledgeMilestoneCelebration : acknowledgeLevelUp
        }
        emoji={showMilestoneCelebration ? "🏆" : stage.glyph}
        title={showMilestoneCelebration ? "Milestone reached!" : `Level ${pendingLevelUp ?? journeyLevel}!`}
        subtitle={
          showMilestoneCelebration
            ? `You reached: ${pendingMilestoneCelebration}`
            : "Your journey is growing. Keep showing up."
        }
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
  return (
    <View
      className="flex-1 rounded-3xl p-4 border"
      style={{ backgroundColor: `${tint}14`, borderColor: `${tint}33` }}
    >
      <View className="flex-row items-center gap-1.5">
        <Ionicons name={icon} size={14} color={tint} accessibilityElementsHidden />
        <Text className="text-sm uppercase font-extrabold" style={{ color: tint }}>
          {label}
        </Text>
      </View>
      <Text className="text-4xl font-extrabold text-foreground mt-1.5">{value}</Text>
    </View>
  );
}
