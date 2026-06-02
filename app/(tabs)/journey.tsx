import { ScrollView, Text, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { CelebrationOverlay } from "@/components/daily-tasks/celebration-overlay";
import { GradientCard } from "@/components/daily-tasks/gradient-card";
import { SectionLabel } from "@/components/daily-tasks/section-label";
import { ScreenContainer } from "@/components/screen-container";
import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { JOURNEY_COSMETICS, stageForLevel } from "@/lib/daily-tasks/journey";
import { pickCelebration } from "@/lib/daily-tasks/milestones";
import { useDailyTasks } from "@/lib/daily-tasks/store";

export default function JourneyScreen() {
  const colors = useColors();
  const {
    state,
    journeyLevel,
    journeyProgress,
    pendingLevelUp,
    acknowledgeLevelUp,
    selectJourneyCosmetic,
    momentumMilestones,
    pendingMilestoneCelebration,
    acknowledgeMilestoneCelebration,
  } = useDailyTasks();

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
        contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          className="text-foreground"
          style={{ fontFamily: Fonts.rounded, fontWeight: "800", fontSize: 34 }}
        >
          Your journey 🌱
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
            emoji="🔥"
            label="Showed up"
            value={journey.showedUpStreak}
            tint={colors.accent}
          />
          <StatCard
            emoji="⭐"
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

        {/* Milestones toward the goal — advance automatically as you finish your days */}
        {momentumMilestones.length > 0 && (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <SectionLabel
                emoji="🎯"
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

        {/* Cosmetics */}
        <View className="gap-3">
          <SectionLabel emoji="🎨" label="Looks" />
          <Text className="text-sm text-muted -mt-1">
            Unlock new journey styles as you level up.
          </Text>
          <View className="flex-row flex-wrap gap-3">
            {JOURNEY_COSMETICS.map((cosmetic) => {
              const unlocked = !cosmetic.premium && journeyLevel >= cosmetic.unlockLevel;
              const selected = journey.selectedCosmeticId === cosmetic.id;
              const lockLabel = cosmetic.premium
                ? "Premium"
                : `Level ${cosmetic.unlockLevel}`;

              return (
                <Pressable
                  key={cosmetic.id}
                  disabled={!unlocked}
                  onPress={() => selectJourneyCosmetic(cosmetic.id)}
                  className="bg-surface rounded-2xl p-4 border items-center"
                  style={{
                    width: "30%",
                    minWidth: 96,
                    opacity: unlocked ? 1 : 0.55,
                    borderColor: selected ? colors.primary : colors.border,
                    borderWidth: selected ? 2 : 1,
                  }}
                >
                  <Text className="text-sm font-semibold text-foreground text-center">
                    {cosmetic.label}
                  </Text>
                  {unlocked ? (
                    selected ? (
                      <View className="flex-row items-center gap-1 mt-2">
                        <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                        <Text className="text-xs" style={{ color: colors.primary }}>
                          Active
                        </Text>
                      </View>
                    ) : (
                      <Text className="text-xs text-muted mt-2">Tap to use</Text>
                    )
                  ) : (
                    <View className="flex-row items-center gap-1 mt-2">
                      <Ionicons
                        name={cosmetic.premium ? "diamond-outline" : "lock-closed"}
                        size={12}
                        color={colors.muted}
                      />
                      <Text className="text-xs text-muted">{lockLabel}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
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
  emoji,
  label,
  value,
  tint,
}: {
  emoji: string;
  label: string;
  value: number;
  tint: string;
}) {
  return (
    <View
      className="flex-1 rounded-3xl p-4 border"
      style={{ backgroundColor: `${tint}14`, borderColor: `${tint}33` }}
    >
      <Text className="text-sm uppercase font-extrabold" style={{ color: tint }}>
        {emoji}  {label}
      </Text>
      <Text className="text-4xl font-extrabold text-foreground mt-1.5">{value}</Text>
    </View>
  );
}
