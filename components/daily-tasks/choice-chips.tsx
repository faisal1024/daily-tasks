import { Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

/**
 * One choice out of a few, as a row of chips. To VoiceOver it is a radio
 * group with its label, and each chip a radio button that says whether it is
 * the one chosen. With `spokenGroup` each chip's label carries the group
 * ("Voice: Mom"), for when focus lands on a chip without passing the group.
 */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  testID,
  spokenGroup = false,
}: {
  label: string;
  options: readonly { value: T; label: string; accessibilityLabel?: string }[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
  spokenGroup?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      className="flex-row flex-wrap gap-2"
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={`${spokenGroup ? `${label}: ` : ""}${option.accessibilityLabel ?? option.label}`}
            accessibilityState={{ checked: selected }}
            // Vertical padding too: at large text sizes the label wraps and must not touch the border.
            className="flex-1 rounded-full px-3 py-2 items-center justify-center border"
            style={{
              minHeight: 44,
              minWidth: 84,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? `${colors.primary}16` : colors.background,
            }}
          >
            <Text
              className="text-sm font-semibold text-center"
              style={{ color: selected ? colors.primary : colors.text }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
