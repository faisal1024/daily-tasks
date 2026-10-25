import { Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

/**
 * One choice out of a few, as a row of chips. To VoiceOver it is a radio
 * group with its label, and each chip a radio button that says whether it is
 * the one chosen. With `spokenGroup` each chip's label carries the group
 * ("Voice: Mom"), for when focus lands on a chip without passing the group.
 * With `columns` every chip has the same width (that share of the row) and a
 * short last row is centered, instead of its chips stretching to fill it.
 */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  testID,
  spokenGroup = false,
  columns,
}: {
  label: string;
  options: readonly { value: T; label: string; accessibilityLabel?: string }[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
  spokenGroup?: boolean;
  columns?: number;
}) {
  const colors = useColors();
  // Even columns: each chip sits in a cell of an equal share of the row, the
  // cells' padding making the 8pt gap (the row's negative margin cancels it
  // at the edges). Percentages, not a measured width, so there's no first
  // frame with stretched chips.
  const cell = columns ? { width: `${100 / columns}%` as const, padding: 4 } : null;
  return (
    <View
      className={cell ? "flex-row flex-wrap justify-center" : "flex-row flex-wrap gap-2"}
      style={cell ? { margin: -4 } : undefined}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const chip = (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={`${spokenGroup ? `${label}: ` : ""}${option.accessibilityLabel ?? option.label}`}
            accessibilityState={{ checked: selected }}
            // Vertical padding too: at large text sizes the label wraps and must not touch the border.
            className={`${cell ? "" : "flex-1 "}rounded-full px-3 py-2 items-center justify-center border`}
            style={{
              minHeight: 44,
              ...(cell ? null : { minWidth: 84 }),
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
        return cell ? (
          <View key={option.value} style={cell}>
            {chip}
          </View>
        ) : (
          chip
        );
      })}
    </View>
  );
}
