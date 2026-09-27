import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { comparisonText, hasInsights, type WeeklyReview } from "@/lib/daily-tasks/weekly-review";

interface WeeklyReviewCardProps {
  review: WeeklyReview;
  /** Confirmed Plus: show the patterns. */
  plus: boolean;
  /** Offer the unlock row (free users once Plus status is known). */
  canUnlock: boolean;
  onUnlock: () => void;
}

const BAR_MAX = 44;

export function WeeklyReviewCard({ review, plus, canUnlock, onUnlock }: WeeklyReviewCardProps) {
  const colors = useColors();
  const comparison = comparisonText(review);
  const tasks = review.completed === 1 ? "1 task done" : `${review.completed} tasks done`;
  const summary =
    review.completed > 0 || review.perfectDays > 0
      ? `${tasks} · ${review.perfectDays} perfect ${review.perfectDays === 1 ? "day" : "days"}`
      : "Nothing done yet. That's okay.";

  return (
    <View className="rounded-2xl bg-surface border border-border p-4 gap-4" testID="weekly-review">
      <View className="gap-1">
        <Text className="text-lg text-foreground" style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}>
          {review.headline}
        </Text>
        <Text className="text-sm" style={{ color: colors.muted }}>
          {summary}
        </Text>
      </View>

      <View
        className="flex-row items-end justify-between"
        accessible
        accessibilityLabel={`Last 7 days. ${review.days
          .map((day) => {
            const name = day.isToday ? "Today" : day.weekday;
            return day.total > 0 ? `${name}: ${day.completed} of ${day.total}` : `${name}: no tasks`;
          })
          .join(". ")}`}
      >
        {review.days.map((day) => {
          const fill = day.total > 0 ? day.completed / day.total : 0;
          return (
            <View key={day.date} className="items-center gap-1.5" style={{ flex: 1 }}>
              <View
                className="rounded-full overflow-hidden justify-end"
                style={{ width: 14, height: BAR_MAX, backgroundColor: `${colors.primary}14` }}
              >
                <View
                  style={{
                    height: Math.round(BAR_MAX * Math.min(1, fill)),
                    backgroundColor: day.perfect ? colors.success : colors.primary,
                    borderRadius: 7,
                  }}
                />
              </View>
              <Text
                className="text-xs"
                style={{
                  color: day.isToday ? colors.foreground : colors.muted,
                  fontWeight: day.isToday ? "700" : undefined,
                }}
              >
                {day.isToday ? "Today" : day.letter}
              </Text>
            </View>
          );
        })}
      </View>

      {plus ? (
        <View className="gap-3" testID="weekly-review-insights">
          {comparison && <Insight icon="trending-up-outline" text={comparison} />}
          {review.bestWeekday && (
            <Insight icon="sunny-outline" text={`${review.bestWeekday}s tend to go best for you.`} />
          )}
          {review.stuck.map((task) => (
            <Insight
              key={task.text}
              icon="refresh-outline"
              text={`"${task.text}" moved to the next day ${task.times} times. Maybe break it into tiny steps, or let it go for now.`}
            />
          ))}
          {!hasInsights(review) && (
            <Insight icon="leaf-outline" text="A few more days of tasks and your patterns will show up here." />
          )}
        </View>
      ) : (
        canUnlock &&
        hasInsights(review) && (
          <Pressable
            onPress={onUnlock}
            accessibilityRole="button"
            accessibilityHint="Shows Plus plans"
            className="flex-row items-center gap-2 rounded-xl p-3"
            style={{ backgroundColor: `${colors.primary}12` }}
            testID="weekly-review-unlock"
          >
            <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
            <Text className="flex-1 text-sm" style={{ color: colors.foreground, fontWeight: "600" }}>
              Your patterns are ready: best days and tasks that keep moving
            </Text>
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              Plus
            </Text>
          </Pressable>
        )
      )}
    </View>
  );
}

function Insight({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const colors = useColors();
  return (
    <View className="flex-row gap-2 items-start">
      <Ionicons name={icon} size={18} color={colors.primary} style={{ marginTop: 1 }} />
      <Text className="flex-1 text-sm text-foreground">{text}</Text>
    </View>
  );
}
