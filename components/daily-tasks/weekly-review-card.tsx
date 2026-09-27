import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { BodyFont, Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { comparisonText, type WeeklyReview } from "@/lib/daily-tasks/weekly-review";

interface WeeklyReviewCardProps {
  review: WeeklyReview;
  /** Plus shows the patterns; otherwise a quiet unlock row. */
  plus: boolean;
  onUnlock: () => void;
}

const BAR_MAX = 44;

export function WeeklyReviewCard({ review, plus, onUnlock }: WeeklyReviewCardProps) {
  const colors = useColors();
  const comparison = comparisonText(review);
  const summary =
    review.planned > 0
      ? `${review.completed} of ${review.planned} tasks done · ${review.perfectDays} perfect ${
          review.perfectDays === 1 ? "day" : "days"
        }`
      : "Nothing planned yet this week.";

  return (
    <View className="rounded-2xl bg-surface border border-border p-4 gap-4" testID="weekly-review">
      <View className="gap-1">
        <Text className="text-lg text-foreground" style={{ fontFamily: Fonts.rounded }}>
          {review.headline}
        </Text>
        <Text className="text-sm" style={{ color: colors.muted }}>
          {summary}
        </Text>
      </View>

      <View
        className="flex-row items-end justify-between"
        accessible
        accessibilityLabel={review.days
          .map((day) =>
            day.total > 0 ? `${day.weekday}: ${day.completed} of ${day.total}` : `${day.weekday}: no tasks`,
          )
          .join(". ")}
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
              <Text className="text-xs" style={{ color: colors.muted }}>
                {day.letter}
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
              text={`"${task.text}" moved to the next day ${task.times} times. Try breaking it into tiny steps.`}
            />
          ))}
          {!comparison && !review.bestWeekday && review.stuck.length === 0 && (
            <Insight icon="leaf-outline" text="A few more days of tasks and your patterns will show up here." />
          )}
        </View>
      ) : (
        <Pressable
          onPress={onUnlock}
          accessibilityRole="button"
          accessibilityLabel="See your patterns with Plus"
          className="flex-row items-center gap-2 rounded-xl p-3"
          style={{ backgroundColor: `${colors.primary}12` }}
          testID="weekly-review-unlock"
        >
          <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
          <Text className="flex-1 text-sm" style={{ color: colors.foreground, fontFamily: BodyFont.semibold }}>
            See your patterns: best days and tasks that keep sliding
          </Text>
          <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
            Plus
          </Text>
        </Pressable>
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
