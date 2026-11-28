// The night before's morning card (1.7): last night's list on the day it was
// for, where the decision is made. Each row goes to Today (room and lock
// rules as any add) or to Saved for later; "Let the rest go" ends it. What
// isn't added or saved is never filed anywhere: it's let go here, or when
// the day ends. Ticked-first rows lead. Rules: lib/daily-tasks/night-before.ts.
import { useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { FROM_LAST_NIGHT, letRestGoSpoken, morningOrder, NIGHT_COPY } from "@/lib/daily-tasks/night-before";
import type { NightList } from "@/lib/daily-tasks/types";

/** From this text size a row's two buttons go under its words. */
const BUTTONS_UNDER_FONT_SCALE = 1.3;

export function NightMorningCard({
  list,
  room,
  locked,
  onTake,
  onFinish,
}: {
  list: NightList;
  /** Today's open slots. */
  room: number;
  /** Today is set: nothing can be added (saving still works). */
  locked: boolean;
  /** One row to Today or to Saved for later; "full" when there was no room. */
  onTake: (id: string, how: "add" | "save") => "done" | "full";
  /** "Let the rest go". */
  onFinish: () => void;
}) {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const under = fontScale >= BUTTONS_UNDER_FONT_SCALE;
  const [savedFull, setSavedFull] = useState(false);
  const rows = morningOrder(list.items);
  const canAdd = !locked && room > 0;
  const blocked = locked ? NIGHT_COPY.morningLocked : room <= 0 ? NIGHT_COPY.morningFull : null;

  const button = (label: string, spoken: string, onPress: () => void, testID: string, solid: boolean, disabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ disabled }}
      hitSlop={4}
      className="rounded-full px-3 items-center justify-center flex-row gap-1"
      style={{
        minHeight: 44,
        minWidth: 44,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: solid ? `${colors.primary}16` : "transparent",
        borderWidth: solid ? 0 : 1,
        borderColor: colors.controlBorder,
      }}
      testID={testID}
    >
      <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View
      className="rounded-3xl border p-5 gap-3"
      style={{ borderColor: colors.primary, backgroundColor: `${colors.primary}0f` }}
      testID="night-morning"
    >
      <View className="flex-row items-start gap-2">
        <Ionicons name="moon-outline" size={20} color={colors.primary} style={{ marginTop: 3 }} />
        <View className="flex-1 gap-1">
          <Text
            accessibilityRole="header"
            style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontWeight: "700", fontSize: 20 }}
          >
            {NIGHT_COPY.morningTitle}
          </Text>
          <Text className="text-sm" style={{ color: colors.muted }}>
            {NIGHT_COPY.morningHint}
          </Text>
        </View>
      </View>
      {blocked || savedFull ? (
        <Text className="text-sm" style={{ color: colors.muted }} testID="night-morning-blocked">
          {savedFull ? NIGHT_COPY.savedFull : blocked}
        </Text>
      ) : null}
      <View
        className="rounded-2xl border overflow-hidden"
        style={{ borderColor: colors.border, backgroundColor: colors.background }}
      >
        {rows.map((item, index) => (
          <View key={item.id}>
            {index > 0 ? <View style={{ height: 1, backgroundColor: colors.border }} /> : null}
            <View
              style={{
                flexDirection: under ? "column" : "row",
                alignItems: under ? "stretch" : "center",
                gap: 10,
                minHeight: 44,
                paddingHorizontal: 16,
                paddingVertical: 10,
              }}
              testID="night-morning-row"
            >
              <View
                className="flex-1 gap-0.5"
                accessible
                accessibilityLabel={`${item.text}, ${FROM_LAST_NIGHT.toLowerCase()}${item.picked ? ", marked first" : ""}`}
              >
                <Text className="text-base text-foreground" style={{ fontWeight: "600" }}>
                  {item.text}
                </Text>
                <View className="flex-row flex-wrap items-center gap-1">
                  <Ionicons name="moon-outline" size={12} color={colors.muted} />
                  <Text className="text-xs" style={{ color: colors.muted }}>
                    {FROM_LAST_NIGHT}
                    {item.picked ? ` · ${NIGHT_COPY.rowFirst}` : ""}
                  </Text>
                </View>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {button(
                  NIGHT_COPY.add,
                  `Add ${item.text} to today`,
                  () => {
                    setSavedFull(false);
                    onTake(item.id, "add");
                  },
                  "night-morning-add",
                  true,
                  !canAdd,
                )}
                {button(
                  NIGHT_COPY.save,
                  `Save ${item.text} for later`,
                  () => setSavedFull(onTake(item.id, "save") === "full"),
                  "night-morning-save",
                  false,
                )}
              </View>
            </View>
          </View>
        ))}
      </View>
      <Pressable
        onPress={onFinish}
        accessibilityRole="button"
        accessibilityLabel={letRestGoSpoken(rows.length)}
        accessibilityHint="They aren't added or saved anywhere"
        className="rounded-2xl py-3 items-center justify-center border"
        style={{ minHeight: 44, borderColor: colors.controlBorder }}
        testID="night-morning-finish"
      >
        <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 16 }}>{NIGHT_COPY.letRestGo}</Text>
      </Pressable>
    </View>
  );
}
