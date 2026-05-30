import { ScrollView, Text, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ConfettiOverlay } from "@/components/daily-tasks/confetti-overlay";
import { StreakPill } from "@/components/daily-tasks/streak-pill";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { JOURNEY_COSMETICS, stageForLevel } from "@/lib/daily-tasks/journey";
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
  } = useDailyTasks();

  const journey = state.journey;
  const stage = stageForLevel(journeyLevel);
  const ratio = Math.min(Math.max(journeyProgress.ratio, 0), 1);
  const xpToNext = journeyProgress.xpRemaining;

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-1">
          <Text className="text-2xl font-bold text-foreground">Your journey</Text>
          <Text className="text-sm text-muted">Small wins, stacking up.</Text>
        </View>

        {/* Growth hero */}
        <View className="bg-surface rounded-3xl p-6 border border-border items-center gap-3">
          <Text style={{ fontSize: 64 }}>{stage.glyph}</Text>
          <Text className="text-lg font-bold text-foreground">
            Level {journeyLevel} · {stage.label}
          </Text>

          <View className="w-full mt-1 gap-2">
            <View
              className="w-full rounded-full overflow-hidden"
              style={{ height: 10, backgroundColor: colors.border }}
            >
              <View
                style={{
                  width: `${ratio * 100}%`,
                  height: "100%",
                  backgroundColor: colors.primary,
                  borderRadius: 999,
                }}
              />
            </View>
            <Text className="text-xs text-muted text-center">
              {`${xpToNext} XP to level ${journeyLevel + 1}`}
              {"  ·  "}
              {journey.xp} XP total
            </Text>
          </View>
        </View>

        {/* Streak stats */}
        <View className="flex-row gap-3">
          <StreakPill icon="flame" label="Showed up" value={journey.showedUpStreak} />
          <StreakPill icon="star" label="Best run" value={journey.longestShowedUpStreak} />
        </View>

        <View className="bg-surface rounded-2xl p-4 border border-border flex-row items-center gap-3">
          <Ionicons name="snow-outline" size={20} color={colors.primary} />
          <Text className="flex-1 text-sm text-muted">
            {journey.showedUpFreezes > 0
              ? `${journey.showedUpFreezes} streak freeze${
                  journey.showedUpFreezes === 1 ? "" : "s"
                } ready — miss a day without losing your run.`
              : "Show up a few days in a row to earn a streak freeze."}
          </Text>
        </View>

        {/* Cosmetics */}
        <View className="gap-3">
          <Text className="text-base font-semibold text-foreground">Looks</Text>
          <Text className="text-xs text-muted -mt-2">
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

      <ConfettiOverlay
        visible={pendingLevelUp !== null}
        onDismiss={acknowledgeLevelUp}
        emoji={stage.glyph}
        title={`Level ${pendingLevelUp ?? journeyLevel}!`}
        subtitle="Your journey is growing. Keep showing up."
      />
    </ScreenContainer>
  );
}
