import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { CalendarGrid } from "@/components/daily-tasks/calendar-grid";
import { DayDetailCard } from "@/components/daily-tasks/day-detail-card";
import { useColors } from "@/hooks/use-colors";
import { formatMonthLabel, fromDateKey } from "@/lib/daily-tasks/date";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { monthlyStats } from "@/lib/daily-tasks/streaks";

/**
 * Month-by-month history (the old Calendar tab), now a compact section of
 * Progress: month switcher with the month's counts, the grid, a one-line key,
 * and a day's details once one is tapped.
 */
export function MonthHistory() {
  const colors = useColors();
  const { state, today } = useDailyTasks();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // The app's day (the store's), not the raw clock: they can differ briefly.
  const todayDate = fromDateKey(today);
  const monthOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
  const [month, setMonth] = useState(() => monthOf(fromDateKey(today)));
  // Until the user moves, follow the current month (e.g. across midnight on the 1st).
  const navigated = useRef(false);
  useEffect(() => {
    if (!navigated.current) setMonth(monthOf(fromDateKey(today)));
  }, [today]);

  const onThisMonth =
    month.getFullYear() === todayDate.getFullYear() && month.getMonth() === todayDate.getMonth();
  const stats = monthlyStats(state.history, month.getFullYear(), month.getMonth());

  const shift = (delta: number) => {
    navigated.current = true;
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
    setSelectedDate(null);
  };

  const jumpToThisMonth = () => {
    navigated.current = false;
    setMonth(monthOf(todayDate));
    setSelectedDate(null);
  };

  return (
    <View className="gap-3" testID="month-history">
      <View className="bg-surface rounded-2xl p-4 border border-border gap-3">
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => shift(-1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            style={{ padding: 6 }}
          >
            <Ionicons name="chevron-back" size={22} color={colors.foreground} />
          </Pressable>
          <Pressable
            onPress={jumpToThisMonth}
            disabled={onThisMonth}
            hitSlop={8}
            accessibilityRole={onThisMonth ? "header" : "button"}
            // Includes the counts: a label replaces the text inside it for VoiceOver.
            accessibilityLabel={`${formatMonthLabel(month)}, ${stats.activeDays} active ${
              stats.activeDays === 1 ? "day" : "days"
            }, ${stats.perfectDays} perfect${onThisMonth ? "" : ". Go to this month"}`}
            style={{ alignItems: "center" }}
          >
            <Text className="text-lg font-semibold text-foreground">{formatMonthLabel(month)}</Text>
            <Text className="text-xs" style={{ color: colors.muted }} testID="month-counts">
              {stats.activeDays} active {stats.activeDays === 1 ? "day" : "days"} · {stats.perfectDays} perfect
            </Text>
          </Pressable>
          <Pressable
            onPress={() => shift(1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            style={{ padding: 6 }}
          >
            <Ionicons name="chevron-forward" size={22} color={colors.foreground} />
          </Pressable>
        </View>

        <CalendarGrid
          today={today}
          month={month}
          history={state.history}
          selectedDate={selectedDate ?? ""}
          onSelectDate={(dateKey) => setSelectedDate((current) => (current === dateKey ? null : dateKey))}
        />

        <Text className="text-xs text-center" style={{ color: colors.muted }}>
          Green: all three done · Dot: some done
        </Text>
      </View>

      {selectedDate ? (
        <View accessibilityLiveRegion="polite">
          <DayDetailCard dateLabel={formatDateDetailLabel(selectedDate)} record={state.history[selectedDate]} />
        </View>
      ) : null}
    </View>
  );
}

function formatDateDetailLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}
