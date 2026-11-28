// The night before's evening card on Today (1.7): the prompt ("Tomorrow,
// out of your head"), or "Kept till morning" once something is held for
// the night's day. Which one shows is showsNightCard
// (lib/daily-tasks/night-before.ts); Today opens the sheet.
import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { track } from "@/lib/daily-tasks/analytics";
import { heldLine, NIGHT_COPY, type NightCardKind, type NightTarget } from "@/lib/daily-tasks/night-before";
import type { NightList } from "@/lib/daily-tasks/types";

export function NightBeforeCard({
  kind,
  target,
  day,
  list,
  onOpen,
  onDismiss,
}: {
  kind: NightCardKind;
  target: NightTarget;
  /** "today" after midnight: the dump plans the day that has begun. */
  day: "tomorrow" | "today";
  /** The list held for the night's day ("held" only). */
  list: NightList | null;
  /** Plan (prompt) or Open list (held): the sheet. */
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const colors = useColors();

  // "shown" once per evening and card in this launch.
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    const tag = `${kind}:${target.nightOf}`;
    if (shownFor.current === tag) return;
    shownFor.current = tag;
    track("night_before", { step: "card", action: "shown", kind, source: "today" });
  }, [kind, target.nightOf]);

  const held = kind === "held" && list !== null;
  return (
    <View
      className="rounded-3xl border p-5 gap-3"
      style={{ borderColor: colors.border, backgroundColor: colors.surface }}
      testID={held ? "night-before-held" : "night-before-card"}
    >
      <View className="flex-row items-start gap-2">
        <Ionicons name="moon-outline" size={20} color={colors.primary} style={{ marginTop: 2 }} />
        <View className="flex-1 gap-1">
          {/* Wraps beside the 44-pt ×, at any text size. */}
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={2}
            style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontWeight: "700", fontSize: 18 }}
          >
            {held ? NIGHT_COPY.heldTitle : NIGHT_COPY.cardTitle}
          </Text>
          <Text className="text-sm" style={{ color: colors.muted }} testID="night-before-card-body">
            {held ? heldLine(list) : NIGHT_COPY.cardBody}
          </Text>
        </View>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={held ? NIGHT_COPY.heldDismiss : NIGHT_COPY.cardDismiss}
          accessibilityHint={held ? "Hides this card tonight. Your list is kept till morning." : "Hides this card tonight"}
          hitSlop={12}
          style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "flex-start" }}
          testID="night-before-dismiss"
        >
          <Ionicons name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityHint={held ? `Your list for ${day}, to change` : undefined}
        hitSlop={8}
        className="self-start rounded-full px-4 py-2"
        style={{
          minHeight: 44,
          justifyContent: "center",
          backgroundColor: held ? `${colors.primary}16` : colors.primary,
        }}
        testID={held ? "night-before-open" : "night-before-start"}
      >
        <Text style={{ color: held ? colors.primaryInk : colors.onPrimary, fontWeight: "700", fontSize: 15 }}>
          {held ? NIGHT_COPY.heldOpen : day === "today" ? NIGHT_COPY.cardButtonToday : NIGHT_COPY.cardButton}
        </Text>
      </Pressable>
    </View>
  );
}
