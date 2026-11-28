// The night before's morning card (1.7): last night's list on the day it was
// for, where the decision is made. Each row goes to Today (room and lock
// rules as any add) or to Saved for later; "Add the N marked first" takes
// the ticked ones in one tap; "Let the rest go" ends it, after asking. What
// isn't added or saved is never filed anywhere: it's let go here, or when
// the day ends. Rows ticked "do first" lead. Rules: lib/daily-tasks/night-before.ts.
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, Pressable, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import {
  addFirstLabel,
  FROM_LAST_NIGHT,
  letGoLabel,
  letGoQuestion,
  morningOrder,
  NIGHT_COPY,
} from "@/lib/daily-tasks/night-before";
import type { NightList } from "@/lib/daily-tasks/types";

/** From this text size a row's two buttons go under its words. */
const BUTTONS_UNDER_FONT_SCALE = 1.3;

export function NightMorningCard({
  list,
  room,
  locked,
  onTake,
  onAddFirst,
  onFinish,
}: {
  list: NightList;
  /** Today's open slots. */
  room: number;
  /** Today is set: nothing can be added (saving still works). */
  locked: boolean;
  /** One row to Today or to Saved for later; "full" when there was no room. */
  onTake: (id: string, how: "add" | "save") => "done" | "full";
  /** "Add the N marked first": how many landed. */
  onAddFirst: () => number;
  /** "Let the rest go" (confirmed). */
  onFinish: () => void;
}) {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const under = fontScale >= BUTTONS_UNDER_FONT_SCALE;
  const [savedFull, setSavedFull] = useState(false);
  const rows = morningOrder(list.items);
  const canAdd = !locked && room > 0;
  const blocked = locked ? NIGHT_COPY.morningLocked : room <= 0 ? NIGHT_COPY.morningFull : null;
  const marked = rows.filter((row) => row.picked).length;
  const firstCount = canAdd ? Math.min(marked, room) : 0;
  // Don't suggest Add when Today can't take it either.
  const savedFullLine = canAdd ? NIGHT_COPY.savedFull : NIGHT_COPY.savedFullOnly;

  // After Add or Save, VoiceOver goes on to the next row (or the header).
  const headerRef = useRef<Text>(null);
  const rowRefs = useRef(new Map<string, View>());
  // Where focus goes next, in a ref: clearing it mustn't re-run the effect
  // (whose cleanup would cancel the frame before it fires).
  const focusNext = useRef<string | "header" | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const moveFocus = (to: string | "header") => {
    focusNext.current = to;
    setFocusTick((tick) => tick + 1);
  };
  useEffect(() => {
    if (!focusNext.current) return;
    const frame = requestAnimationFrame(() => {
      const to = focusNext.current;
      focusNext.current = null;
      const target = to === "header" ? headerRef.current : to ? rowRefs.current.get(to) : null;
      if (target) AccessibilityInfo.sendAccessibilityEvent(target, "focus");
    });
    return () => cancelAnimationFrame(frame);
  }, [focusTick]);

  const take = (id: string, how: "add" | "save") => {
    const index = rows.findIndex((row) => row.id === id);
    const outcome = onTake(id, how);
    if (outcome === "full") {
      if (how === "save") {
        setSavedFull(true);
        announcePolitely(savedFullLine);
      }
      return;
    }
    setSavedFull(false);
    const next = rows[index + 1] ?? rows[index - 1];
    moveFocus(next && next.id !== id ? next.id : "header");
  };

  const letGo = () => {
    Alert.alert(letGoQuestion(rows.length), NIGHT_COPY.confirmBody, [
      { text: NIGHT_COPY.confirmCancel, style: "cancel" },
      { text: NIGHT_COPY.confirmLetGo, onPress: onFinish },
    ]);
  };

  const button = (
    label: string,
    spoken: string,
    onPress: () => void,
    testID: string,
    solid: boolean,
    disabled = false,
    hint?: string,
  ) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={hint}
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
      <Text className="text-sm font-semibold" style={{ color: colors.primaryInk }}>
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
            ref={headerRef}
            accessibilityRole="header"
            maxFontSizeMultiplier={2}
            style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontWeight: "700", fontSize: 20 }}
          >
            {NIGHT_COPY.morningTitle}
          </Text>
          <Text className="text-sm" style={{ color: colors.muted }} testID="night-morning-hint">
            {NIGHT_COPY.morningHint}
          </Text>
        </View>
      </View>
      {blocked || savedFull ? (
        <Text className="text-sm" style={{ color: colors.muted }} testID="night-morning-blocked">
          {savedFull ? savedFullLine : blocked}
        </Text>
      ) : null}
      {firstCount > 0 ? (
        <Pressable
          onPress={() => {
            if (onAddFirst() > 0) moveFocus("header");
          }}
          accessibilityRole="button"
          className="rounded-2xl py-3 px-4 items-center justify-center"
          style={{ minHeight: 44, backgroundColor: colors.primary }}
          testID="night-morning-add-first"
        >
          <Text className="text-center" style={{ color: colors.onPrimary, fontWeight: "700", fontSize: 16 }}>
            {addFirstLabel(firstCount, marked)}
          </Text>
        </Pressable>
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
                ref={(view) => {
                  if (view) rowRefs.current.set(item.id, view);
                  else rowRefs.current.delete(item.id);
                }}
                className="flex-1 gap-0.5"
                accessible
                accessibilityLabel={`${item.text}, ${FROM_LAST_NIGHT.toLowerCase()}${item.picked ? ", marked to do first" : ""}`}
              >
                <Text className="text-base text-foreground" style={{ fontWeight: "600" }}>
                  {item.text}
                </Text>
                <View className="flex-row flex-wrap items-center gap-1">
                  <Ionicons name="moon-outline" size={12} color={colors.muted} />
                  <Text className="text-xs" style={{ color: colors.muted }}>
                    {FROM_LAST_NIGHT}
                  </Text>
                  {item.picked ? (
                    <Text className="text-xs font-semibold" style={{ color: colors.primaryInk }}>
                      {` · ${NIGHT_COPY.rowFirst}`}
                    </Text>
                  ) : null}
                </View>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {button(
                  NIGHT_COPY.add,
                  `Add ${item.text} to today`,
                  () => take(item.id, "add"),
                  "night-morning-add",
                  true,
                  !canAdd,
                  blocked ?? undefined,
                )}
                {button(NIGHT_COPY.save, `Save ${item.text} for later`, () => take(item.id, "save"), "night-morning-save", false)}
              </View>
            </View>
          </View>
        ))}
      </View>
      <Pressable
        onPress={letGo}
        accessibilityRole="button"
        accessibilityHint="Asks first. They aren't added or saved anywhere."
        className="rounded-2xl py-3 items-center justify-center border"
        style={{ minHeight: 44, borderColor: colors.controlBorder }}
        testID="night-morning-finish"
      >
        <Text style={{ color: colors.primaryInk, fontWeight: "700", fontSize: 16 }}>{letGoLabel(list)}</Text>
      </Pressable>
    </View>
  );
}
