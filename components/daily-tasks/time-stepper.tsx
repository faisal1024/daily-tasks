import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import { formatTime } from "@/lib/daily-tasks/date";

interface TimeStepperProps {
  hour: number;
  minute: number;
  disabled?: boolean;
  onChange: (hour: number, minute: number) => void;
}

const MINUTE_STEP = 15;

export function TimeStepper({ hour, minute, disabled, onChange }: TimeStepperProps) {
  const colors = useColors();

  const stepHour = (delta: number) => {
    const next = (hour + delta + 24) % 24;
    onChange(next, minute);
  };
  const stepMinute = (delta: number) => {
    const totalMinutes = hour * 60 + minute + delta;
    const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    onChange(Math.floor(wrapped / 60), wrapped % 60);
  };

  const opacity = disabled ? 0.4 : 1;

  return (
    <View
      className="flex-row items-center justify-between mt-3 rounded-xl p-3"
      style={{ backgroundColor: colors.background, opacity }}
      pointerEvents={disabled ? "none" : "auto"}
    >
      <Stepper
        label="Hour"
        onMinus={() => stepHour(-1)}
        onPlus={() => stepHour(1)}
        color={colors.foreground}
      />
      <Text className="text-lg font-semibold text-foreground">
        {formatTime(hour, minute)}
      </Text>
      <Stepper
        label={`+${MINUTE_STEP}m`}
        onMinus={() => stepMinute(-MINUTE_STEP)}
        onPlus={() => stepMinute(MINUTE_STEP)}
        color={colors.foreground}
      />
    </View>
  );
}

function Stepper({
  label,
  onMinus,
  onPlus,
  color,
}: {
  label: string;
  onMinus: () => void;
  onPlus: () => void;
  color: string;
}) {
  return (
    <View className="items-center gap-1">
      <View className="flex-row gap-1">
        <Pressable
          onPress={onMinus}
          hitSlop={6}
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: `${color}11` }}
          accessibilityLabel={`Decrease ${label}`}
        >
          <Ionicons name="remove" size={16} color={color} />
        </Pressable>
        <Pressable
          onPress={onPlus}
          hitSlop={6}
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: `${color}11` }}
          accessibilityLabel={`Increase ${label}`}
        >
          <Ionicons name="add" size={16} color={color} />
        </Pressable>
      </View>
      <Text className="text-[10px] uppercase tracking-wide" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}
