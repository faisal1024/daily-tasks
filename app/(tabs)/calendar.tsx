import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer } from "@/components/screen-container";
import { CalendarGrid } from "@/components/daily-tasks/calendar-grid";
import { DayDetailCard } from "@/components/daily-tasks/day-detail-card";
import { useColors } from "@/hooks/use-colors";
import { formatMonthLabel, todayKey } from "@/lib/daily-tasks/date";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { monthlyStats } from "@/lib/daily-tasks/streaks";

export default function CalendarScreen() {
  const colors = useColors();
  const { state } = useDailyTasks();
  const [selectedDate, setSelectedDate] = useState(() => todayKey());
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const stats = monthlyStats(
    state.history,
    month.getFullYear(),
    month.getMonth(),
  );

  const shift = (delta: number) => {
    setMonth((m) => {
      const next = new Date(m.getFullYear(), m.getMonth() + delta, 1);
      setSelectedDate(todayKey(next));
      return next;
    });
  };

  const jumpToToday = () => {
    const d = new Date();
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedDate(todayKey(d));
  };

  const selectDate = (dateKey: string) => {
    setSelectedDate(dateKey);
  };

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 24 }}
      >
        <View className="gap-1">
          <Text className="text-base text-muted">History</Text>
          <Text className="text-3xl font-bold text-foreground">
            Your streak map
          </Text>
        </View>

        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => shift(-1)}
            hitSlop={12}
            accessibilityLabel="Previous month"
            className="p-2"
          >
            <Ionicons name="chevron-back" size={22} color={colors.foreground} />
          </Pressable>
          <Pressable onPress={jumpToToday} hitSlop={8}>
            <Text className="text-lg font-semibold text-foreground">
              {formatMonthLabel(month)}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => shift(1)}
            hitSlop={12}
            accessibilityLabel="Next month"
            className="p-2"
          >
            <Ionicons
              name="chevron-forward"
              size={22}
              color={colors.foreground}
            />
          </Pressable>
        </View>

        <View className="bg-surface rounded-2xl p-4 border border-border">
          <CalendarGrid
            month={month}
            history={state.history}
            selectedDate={selectedDate}
            onSelectDate={selectDate}
          />
        </View>

        <DayDetailCard
          dateLabel={formatDateDetailLabel(selectedDate)}
          record={state.history[selectedDate]}
        />

        <View className="flex-row gap-3">
          <View className="flex-1 bg-surface rounded-2xl p-4 border border-border">
            <Text
              className="text-xs uppercase tracking-wide"
              style={{ color: colors.muted }}
            >
              Active Days
            </Text>
            <Text className="text-2xl font-bold text-foreground mt-2">
              {stats.activeDays}
            </Text>
          </View>
          <View className="flex-1 bg-surface rounded-2xl p-4 border border-border">
            <Text
              className="text-xs uppercase tracking-wide"
              style={{ color: colors.muted }}
            >
              Perfect Days
            </Text>
            <Text className="text-2xl font-bold text-foreground mt-2">
              {stats.perfectDays}
            </Text>
          </View>
        </View>

        <View className="bg-surface rounded-2xl p-4 border border-border gap-2">
          <Text
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: colors.muted }}
          >
            Legend
          </Text>
          <LegendRow
            color={colors.success}
            label="All focuses completed"
            filled
          />
          <LegendRow
            color={colors.primary}
            label="Some focuses completed"
            dot
          />
          <LegendRow color={colors.primary} label="Today" outlined />
        </View>
      </ScrollView>
    </ScreenContainer>
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

function LegendRow({
  color,
  label,
  filled,
  dot,
  outlined,
}: {
  color: string;
  label: string;
  filled?: boolean;
  dot?: boolean;
  outlined?: boolean;
}) {
  return (
    <View className="flex-row items-center gap-3">
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: filled
            ? color
            : outlined
              ? "transparent"
              : `${color}22`,
          borderWidth: outlined ? 2 : 0,
          borderColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {dot && (
          <View
            style={{
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: color,
            }}
          />
        )}
      </View>
      <Text className="text-sm text-foreground">{label}</Text>
    </View>
  );
}
