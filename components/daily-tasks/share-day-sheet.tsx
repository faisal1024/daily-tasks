// "Share your day" (1.5 D): a preview of the finished day as an image, a
// switch to leave the task names out, and Share, which opens the iOS share
// sheet with the picture. The words are decided in lib/daily-tasks/share-card.ts.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, Share, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef, releaseCapture } from "react-native-view-shot";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { track } from "@/lib/daily-tasks/analytics";
import {
  SHARE_CARD_BRAND,
  SHARE_CARD_INK,
  SHARE_CARD_PURPLE,
  shareCardModel,
  shareNamesChoice,
  type ShareCardModel,
  type ShareCardTask,
} from "@/lib/daily-tasks/share-card";

export const SHARE_DAY_COPY = {
  button: "Share your day",
  title: "Share your day",
  names: "Show task names",
  namesHidden: "Task names are hidden in Settings, so the picture leaves them out.",
  share: "Share",
  close: "Close",
  failed: "Couldn't make the picture. Try again.",
} as const;

/** The picture's width in points (it's captured at the screen's scale). */
const CARD_WIDTH = 320;
/** The sun-and-check logomark beside the app's name (a small copy of assets/brand/icon-1024-rounded.png). */
const LOGOMARK = require("../../assets/brand/logomark-96.png");

export function ShareDaySheet({
  visible,
  tasks,
  daysShowedUp,
  dateLabel,
  hideTaskNames,
  onClose,
}: {
  visible: boolean;
  tasks: ShareCardTask[];
  daysShowedUp: number;
  dateLabel: string;
  /** Settings › Reminders › "Hide task names": the picture never shows them then. */
  hideTaskNames: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const sheetAnimation = useSheetAnimation();
  const choice = shareNamesChoice(hideTaskNames);
  const [showNames, setShowNames] = useState(choice.initial);
  const [sharing, setSharing] = useState(false);
  const [failed, setFailed] = useState(false);
  const sharingRef = useRef(false);
  const cardRef = useRef<View>(null);

  // Each opening starts from the setting.
  useEffect(() => {
    if (!visible) return;
    setShowNames(shareNamesChoice(hideTaskNames).initial);
    setFailed(false);
  }, [visible, hideTaskNames]);

  const model = shareCardModel({ tasks, daysShowedUp, dateLabel, showNames: showNames && choice.canShow });

  const share = async () => {
    if (sharingRef.current || !cardRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    setFailed(false);
    let uri: string | null = null;
    try {
      uri = await captureRef(cardRef, { format: "png", quality: 1, result: "tmpfile" });
      const url = uri.startsWith("file://") ? uri : `file://${uri}`;
      const result = await Share.share({ url });
      if (result.action === Share.sharedAction) {
        // Counts only: never a task or the picture.
        track("finish_card_shared", { count: tasks.length, kind: model.rows ? "names" : "no_names" });
        onClose();
      }
    } catch {
      setFailed(true);
    } finally {
      // The picture can hold task names: it doesn't stay in the app's temp folder.
      if (uri) {
        try {
          releaseCapture(uri);
        } catch {
          // Gone already, or iOS clears it: nothing to do.
        }
      }
      sharingRef.current = false;
      setSharing(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType={sheetAnimation}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <View
        className="flex-1"
        style={{ backgroundColor: colors.background, paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12 }}
        accessibilityViewIsModal
        testID="share-day-sheet"
      >
        <View className="flex-row items-center justify-between gap-3 px-5">
          <Text
            accessibilityRole="header"
            className="flex-1 text-2xl text-foreground"
            style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}
          >
            {SHARE_DAY_COPY.title}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={SHARE_DAY_COPY.close}
            hitSlop={10}
            className="items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
            testID="share-day-close"
          >
            <Ionicons name="close" size={26} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 18, alignItems: "center" }}>
          <ShareCard model={model} cardRef={cardRef} />

          {choice.canShow ? (
            <View
              className="flex-row items-center justify-between gap-3 self-stretch rounded-2xl border px-4"
              style={{ borderColor: colors.border, backgroundColor: colors.surface, minHeight: 52 }}
            >
              <Text className="flex-1 text-base text-foreground">{SHARE_DAY_COPY.names}</Text>
              <Switch
                value={showNames}
                onValueChange={setShowNames}
                accessibilityLabel={SHARE_DAY_COPY.names}
                trackColor={{ true: colors.primary, false: colors.border }}
                testID="share-day-names"
              />
            </View>
          ) : (
            <Text className="text-sm self-stretch" style={{ color: colors.muted }} testID="share-day-names-hidden">
              {SHARE_DAY_COPY.namesHidden}
            </Text>
          )}

          {failed ? (
            <Text className="text-sm self-stretch" style={{ color: colors.error }} accessibilityLiveRegion="polite" testID="share-day-failed">
              {SHARE_DAY_COPY.failed}
            </Text>
          ) : null}

          <Pressable
            onPress={() => void share()}
            disabled={sharing}
            accessibilityRole="button"
            accessibilityLabel={SHARE_DAY_COPY.share}
            accessibilityHint="Opens the share sheet with this picture"
            accessibilityState={{ disabled: sharing, busy: sharing }}
            className="self-stretch rounded-2xl py-4 flex-row items-center justify-center gap-2"
            style={{ backgroundColor: colors.primary, minHeight: 50 }}
            testID="share-day-share"
          >
            {sharing ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Ionicons name="share-outline" size={18} color={colors.onPrimary} />
            )}
            <Text className="text-base font-semibold" style={{ color: colors.onPrimary }}>
              {SHARE_DAY_COPY.share}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** The picture itself: brand purple whatever the theme, so it reads the same wherever it's posted. */
function ShareCard({ model, cardRef }: { model: ShareCardModel; cardRef: React.RefObject<View | null> }) {
  const spoken = model.rows
    ? `${model.dayLabel}, ${model.dateLabel}. ${model.rows.map((row) => `${row.text}${row.done ? ", done" : ""}`).join(". ")}. ${model.summary}. ${SHARE_CARD_BRAND}`
    : `${model.dayLabel}, ${model.dateLabel}. ${model.summary}. ${SHARE_CARD_BRAND}`;
  return (
    <View
      ref={cardRef}
      // Kept as its own native view, so it can be captured.
      collapsable={false}
      accessible
      accessibilityLabel={`Picture: ${spoken}`}
      testID="share-day-card"
      style={{ width: CARD_WIDTH, borderRadius: 28, padding: 26, gap: 20, backgroundColor: SHARE_CARD_PURPLE }}
    >
      <View className="flex-row items-center justify-between gap-3">
        <View style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: "rgba(255,255,255,0.18)" }}>
          <Text
            style={{ color: SHARE_CARD_INK, fontFamily: Fonts.rounded, fontWeight: "800", fontSize: 22 }}
            allowFontScaling={false}
            testID="share-day-label"
          >
            {model.dayLabel}
          </Text>
        </View>
        <Text
          style={{ color: SHARE_CARD_INK, opacity: 0.85, fontSize: 13, fontWeight: "600", flexShrink: 1, textAlign: "right" }}
          allowFontScaling={false}
          numberOfLines={1}
        >
          {model.dateLabel}
        </Text>
      </View>

      {model.rows ? (
        <View style={{ gap: 12 }} testID="share-day-rows">
          {model.rows.map((row, index) => (
            <View key={index} className="flex-row items-center gap-3">
              <Ionicons name={row.done ? "checkmark-circle" : "ellipse-outline"} size={24} color={SHARE_CARD_INK} />
              <Text
                style={{
                  flex: 1,
                  color: SHARE_CARD_INK,
                  fontSize: 17,
                  fontWeight: "600",
                }}
                allowFontScaling={false}
                numberOfLines={2}
              >
                {row.text}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text
        style={{ color: SHARE_CARD_INK, fontFamily: Fonts.rounded, fontWeight: "800", fontSize: model.rows ? 28 : 48 }}
        allowFontScaling={false}
        testID="share-day-summary"
      >
        {model.summary}
      </Text>

      <View className="flex-row items-center gap-2">
        <Image source={LOGOMARK} style={{ width: 24, height: 24, borderRadius: 6 }} accessibilityIgnoresInvertColors testID="share-day-logomark" />
        <Text style={{ color: SHARE_CARD_INK, fontWeight: "700", fontSize: 15 }} allowFontScaling={false}>
          {SHARE_CARD_BRAND}
        </Text>
      </View>
    </View>
  );
}
