import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

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
  /** Only while the ideas entry would show (an open slot on an unset day). */
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
            Close the day below and your coach drafts tomorrow.
          </Text>
        ) : null}
      </View>
      {onPullOneMore ? (
        <Pressable
          onPress={onPullOneMore}
          accessibilityRole="button"
          accessibilityLabel="Pull one more from Ideas"
          accessibilityHint="Opens Ideas"
          // A quiet pill, still a full 44pt target.
          style={{
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginTop: 8,
            minHeight: 44,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: "rgba(255,255,255,0.18)",
          }}
          testID="pull-one-more"
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>Pull one more from Ideas</Text>
        </Pressable>
      ) : null}
    </GradientCard>
  );
}
