import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";

import { TimeStepper } from "@/components/daily-tasks/time-stepper";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useColors } from "@/hooks/use-colors";
import { formatTime } from "@/lib/daily-tasks/date";

interface TimePickerRowProps {
  label: string;
  hour: number;
  minute: number;
  disabled?: boolean;
  onChange: (hour: number, minute: number) => void;
}

function asDate(hour: number, minute: number): Date {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

/**
 * A time setting using the platform's own picker: the compact iOS picker,
 * Android's clock dialog, and the old stepper on the web (no native picker).
 */
export function TimePickerRow({ label, hour, minute, disabled = false, onChange }: TimePickerRowProps) {
  const colors = useColors();
  // Follow the app's own light/dark choice, not just the system's.
  const scheme = useColorScheme() === "dark" ? "dark" : "light";

  if (Platform.OS === "web") {
    return <TimeStepper hour={hour} minute={minute} disabled={disabled} onChange={onChange} />;
  }

  const row = (control: React.ReactNode) => (
    <View
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, opacity: disabled ? 0.45 : 1 }}
      accessibilityState={{ disabled }}
      testID="time-picker-row"
    >
      <Text className="text-base font-semibold text-foreground" style={{ flex: 1 }}>
        {label}
      </Text>
      {control}
    </View>
  );

  if (Platform.OS === "ios") {
    return row(
      <DateTimePicker
        value={asDate(hour, minute)}
        mode="time"
        display="compact"
        disabled={disabled}
        themeVariant={scheme}
        accentColor={colors.primary}
        accessibilityLabel={label}
        onChange={(event, date) => {
          if (event.type === "set" && date) onChange(date.getHours(), date.getMinutes());
        }}
      />,
    );
  }

  return row(
    <Pressable
      onPress={() =>
        DateTimePickerAndroid.open({
          value: asDate(hour, minute),
          mode: "time",
          onChange: (event, date) => {
            if (event.type === "set" && date) onChange(date.getHours(), date.getMinutes());
          },
        })
      }
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${formatTime(hour, minute)}`}
      hitSlop={8}
      style={{ borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: `${colors.primary}14` }}
    >
      <Text className="text-base font-semibold" style={{ color: colors.primary }}>
        {formatTime(hour, minute)}
      </Text>
    </Pressable>,
  );
}
