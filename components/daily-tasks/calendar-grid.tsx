import { Pressable, View, Text } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { daysInMonth, toDateKey, todayKey } from "@/lib/daily-tasks/date";
import type { History } from "@/lib/daily-tasks/types";
import { MAX_TASKS } from "@/lib/daily-tasks/types";

interface CalendarGridProps {
  month: Date;
  history: History;
  selectedDate: string | null;
  onSelectDate: (dateKey: string) => void;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function CalendarGrid({
  month,
  history,
  selectedDate,
  onSelectDate,
}: CalendarGridProps) {
  const colors = useColors();
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const total = daysInMonth(month);
  const today = todayKey();

  const cells: { key: string; day: number | null; dateKey: string | null }[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ key: `pad-${i}`, day: null, dateKey: null });
  }
  for (let d = 1; d <= total; d++) {
    const dateKey = toDateKey(new Date(year, monthIndex, d));
    cells.push({ key: dateKey, day: d, dateKey });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, day: null, dateKey: null });
  }

  return (
    <View className="gap-2">
      <View className="flex-row">
        {WEEKDAYS.map((w, i) => (
          <View key={`${w}-${i}`} className="flex-1 items-center">
            <Text className="text-xs font-semibold" style={{ color: colors.muted }}>
              {w}
            </Text>
          </View>
        ))}
      </View>

      <View className="flex-row flex-wrap">
        {cells.map((cell) => {
          if (!cell.day || !cell.dateKey) {
            return <View key={cell.key} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
          }
          const dateKey = cell.dateKey;
          const record = history[dateKey];
          const isToday = dateKey === today;
          const isSelected = dateKey === selectedDate;
          const completed = record?.completed ?? 0;
          const total = record?.total ?? 0;
          const isPerfect = total === MAX_TASKS && completed === MAX_TASKS;
          const isPartial = completed > 0 && !isPerfect;

          let bg: string = "transparent";
          let textColor: string = colors.foreground;
          let dot: string | null = null;
          if (isPerfect) {
            bg = colors.success;
            textColor = colors.background;
          } else if (isPartial) {
            bg = `${colors.primary}22`;
            dot = colors.primary;
          }

          return (
            <Pressable
              key={cell.key}
              onPress={() => onSelectDate(dateKey)}
              accessibilityRole="button"
              accessibilityLabel={`View ${dateKey}`}
              style={{ width: `${100 / 7}%`, aspectRatio: 1 }}
              className="items-center justify-center p-1"
            >
              <View
                className="rounded-full items-center justify-center"
                style={{
                  width: 36,
                  height: 36,
                  backgroundColor: bg,
                  borderWidth: isSelected ? 3 : isToday ? 2 : 0,
                  borderColor: isSelected ? colors.foreground : colors.primary,
                }}
              >
                <Text className="text-sm font-medium" style={{ color: textColor }}>
                  {cell.day}
                </Text>
                {dot && (
                  <View
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: dot,
                      position: "absolute",
                      bottom: 4,
                    }}
                  />
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
