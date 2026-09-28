import { Pressable, Text, View } from "react-native";

import { GradientCard } from "@/components/daily-tasks/gradient-card";
import { Fonts } from "@/constants/theme";
import { doneCardTitle, smallWinsLine, type WeekSummary } from "@/lib/daily-tasks/today-phase";

/**
 * The one gradient in the app: the finished day. A rest-first title, the
 * week's small wins (positive counts only), and, with room left on an open
 * day, a quiet way to pull one more from Ideas.
 */
export function DoneCard({
  total,
  week,
  eveningCheckIn,
  onPullOneMore,
}: {
  total: number;
  week: Pick<WeekSummary, "showedUpDays" | "tasksDone">;
  /** The check-in follows below: keep the line about closing the day. */
  eveningCheckIn: boolean;
  /** Only when there's an open slot and the day isn't set. */
  onPullOneMore?: () => void;
}) {
  const title = doneCardTitle(total);
  const wins = smallWinsLine(week);
  return (
    <GradientCard className="rounded-3xl" style={{ padding: 20, gap: 6 }}>
      <View testID="done-card" accessible accessibilityRole="summary">
        <Text
          style={{ color: "#fff", fontFamily: Fonts.rounded, fontSize: 24, fontWeight: "800" }}
          maxFontSizeMultiplier={1.6}
        >
          {title}
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 15, fontWeight: "700", marginTop: 4 }}>
          {wins}
        </Text>
        {eveningCheckIn ? (
          <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 15, marginTop: 4 }}>
            You showed up today. Close the day below and your coach drafts tomorrow.
          </Text>
        ) : null}
      </View>
      {onPullOneMore ? (
        <Pressable
          onPress={onPullOneMore}
          accessibilityRole="button"
          accessibilityLabel="Pull one more from Ideas"
          hitSlop={8}
          className="self-start mt-1"
          testID="pull-one-more"
        >
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700", textDecorationLine: "underline" }}>
            Pull one more from Ideas
          </Text>
        </Pressable>
      ) : null}
    </GradientCard>
  );
}
