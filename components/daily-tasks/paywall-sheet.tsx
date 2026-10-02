import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { useColors } from "@/hooks/use-colors";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import { PRIVACY_URL, TERMS_URL } from "@/lib/daily-tasks/links";
import { getNotificationPermissionStatus } from "@/lib/daily-tasks/notifications";
import {
  defaultPackageId,
  monthlyNudgeText,
  paywallHeadline,
  paywallSubhead,
  planLabel,
  PLUS_BENEFITS,
  purchaseButtonLabel,
  purchaseTerms,
  shownWinBackOffer,
  sortPackages,
  trialTimeline,
  trialTimelineLabel,
  visiblePackages,
  type PaywallSource,
  type PlusPackage,
} from "@/lib/daily-tasks/plus";
import { usePlus } from "@/lib/daily-tasks/plus-context";
import type { PurchaseOutcome } from "@/lib/daily-tasks/purchases";

type LoadState = "loading" | "ready" | "error";

interface PaywallSheetProps {
  source: PaywallSource | null;
  onClose: () => void;
  /** Called once iOS has actually presented the sheet. */
  onShown?: () => void;
  /** A purchase started earlier is still running (buy stays disabled). */
  purchasing?: boolean;
  loadPackages: () => Promise<PlusPackage[]>;
  onPurchase: (pkg: PlusPackage) => Promise<PurchaseOutcome>;
  onRestore: () => Promise<boolean | null>;
  /** Tasks first run set (the onboarding headline echoes it). */
  taskCount?: number;
  /** Notifications are allowed, so the trial reminder can actually be sent. */
  remindersAllowed?: boolean;
  /** The monthly nudge was tapped (analytics live in plus-context). */
  onMonthlyNudge?: () => void;
}

/** After an offer purchase fails: the plans are reloaded, never bought at full price. */
export const OFFER_GONE_MESSAGE = "That offer isn't available any more. Here are the current prices.";
/** Any other failed purchase (the plan and its offer, if any, still stand). */
export const PURCHASE_FAILED_MESSAGE = "The purchase didn't go through. If you were charged, tap Restore purchases.";

/** Said a moment after StoreKit's sheet goes, so its dismissal doesn't cut it off. */
const NUDGE_ANNOUNCE_DELAY_MS = 500;
/** text-sm line height and the timeline dot, before Dynamic Type scaling. */
const TIMELINE_LINE_HEIGHT = 20;
const TIMELINE_DOT = 9;

// After backing out of the yearly plan: the monthly line, offered once per open.
type MonthlyNudge = "none" | "shown" | "done";

export function PaywallSheet({
  source,
  onClose,
  onShown,
  purchasing = false,
  loadPackages,
  onPurchase,
  onRestore,
  taskCount,
  remindersAllowed = false,
  onMonthlyNudge,
}: PaywallSheetProps) {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  // The dot sits on the first line's centre at any text size.
  const scale = Math.max(fontScale || 1, 1);
  const dotSize = Math.round(TIMELINE_DOT * Math.min(scale, 1.6));
  const dotOffset = Math.max(0, (TIMELINE_LINE_HEIGHT * scale - dotSize) / 2);
  const sheetAnimation = useSheetAnimation();
  const insets = useSafeAreaInsets();
  const visible = source !== null;
  const [load, setLoad] = useState<LoadState>("loading");
  const [packages, setPackages] = useState<PlusPackage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"purchase" | "restore" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nudge, setNudge] = useState<MonthlyNudge>("none");
  // Bumped per open: a load that finishes after close/reopen is ignored.
  const session = useRef(0);
  const nudgeAnnounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (nudgeAnnounceTimer.current) clearTimeout(nudgeAnnounceTimer.current);
    },
    [],
  );

  /**
   * `reselect`: after a reload, keep this plan selected (when it's still
   * offered) and say `notice(plan)` once the plans are back.
   */
  const fetchPackages = async (
    reselect: { id: string; notice: (plan: PlusPackage | null) => string } | null = null,
  ) => {
    const mine = ++session.current;
    setLoad("loading");
    setMessage(null);
    // Never leave a previous open's plan selectable while reloading or failed.
    setPackages([]);
    setSelectedId(null);
    try {
      // Lifetime only when opened from Settings: the trial plans lead elsewhere.
      const loaded = sortPackages(visiblePackages(await loadPackages(), source));
      if (mine !== session.current) return;
      if (loaded.length === 0) {
        setLoad("error");
        return;
      }
      setPackages(loaded);
      const kept = reselect ? (loaded.find((pkg) => pkg.id === reselect.id) ?? null) : null;
      setSelectedId(kept ? kept.id : defaultPackageId(loaded));
      setLoad("ready");
      if (reselect) setMessage(reselect.notice(kept));
    } catch {
      if (mine === session.current) setLoad("error");
    }
  };

  useEffect(() => {
    if (visible) {
      setBusy(null);
      setNudge("none");
      void fetchPackages();
    } else {
      session.current += 1;
      if (nudgeAnnounceTimer.current) {
        clearTimeout(nudgeAnnounceTimer.current);
        nudgeAnnounceTimer.current = null;
      }
    }
    // fetchPackages only depends on props that are stable per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const selected = packages.find((pkg) => pkg.id === selectedId) ?? null;
  const monthly = packages.find((pkg) => pkg.kind === "monthly") ?? null;
  const timeline = trialTimeline(selected, { remindersAllowed });
  const nudgeText = monthly ? monthlyNudgeText(monthly) : null;
  const showNudge = nudge === "shown" && nudgeText !== null && selected?.kind !== "monthly";

  const select = (pkg: PlusPackage) => {
    setSelectedId(pkg.id);
    // Monthly chosen by any route: the line has done its job.
    if (pkg.kind === "monthly") setNudge((current) => (current === "none" ? current : "done"));
  };

  const takeNudge = () => {
    if (!monthly) return;
    select(monthly);
    onMonthlyNudge?.();
  };

  // accessibilityLiveRegion is Android-only: tell VoiceOver about status changes.
  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  useEffect(() => {
    if (load === "error") {
      AccessibilityInfo.announceForAccessibility("Plans couldn't load. Try again.");
    }
  }, [load]);

  const buy = async () => {
    if (!selected || busy || purchasing) return;
    const mine = session.current;
    setBusy("purchase");
    setMessage(null);
    const outcome = await onPurchase(selected);
    // The sheet was closed (and maybe reopened) meanwhile: this result belongs
    // to that earlier open, so it mustn't close or message the current one.
    if (mine !== session.current) return;
    setBusy(null);
    if (outcome === "purchased") onClose();
    else if (outcome === "cancelled") {
      // Backed out of the yearly plan: once per open, offer the smaller step.
      if (selected.kind === "annual" && monthly && nudge === "none") {
        setNudge("shown");
        const text = monthlyNudgeText(monthly);
        if (nudgeAnnounceTimer.current) clearTimeout(nudgeAnnounceTimer.current);
        nudgeAnnounceTimer.current = setTimeout(() => {
          nudgeAnnounceTimer.current = null;
          announcePolitely(text);
        }, NUDGE_ANNOUNCE_DELAY_MS);
      }
    } else if (outcome === "pending") {
      setMessage("Your purchase is waiting for approval. Plus unlocks as soon as it goes through.");
    } else if (outcome === "failed" && shownWinBackOffer(selected)) {
      // The offer may have lapsed (eligibility changes): show today's prices
      // again and let them choose; never retry at full price on their behalf.
      // (The plans are cleared while they reload, so nothing can be bought meanwhile.)
      // Only "offer gone" when the reloaded plan really lost it: a network or
      // StoreKit hiccup (or a charge without Plus yet) gets the usual message.
      await fetchPackages({
        id: selected.id,
        notice: (plan) => (shownWinBackOffer(plan) ? PURCHASE_FAILED_MESSAGE : OFFER_GONE_MESSAGE),
      });
    } else if (outcome === "failed") {
      setMessage(PURCHASE_FAILED_MESSAGE);
    }
  };

  const restore = async () => {
    if (busy) return;
    const mine = session.current;
    setBusy("restore");
    setMessage(null);
    const active = await onRestore();
    if (mine !== session.current) return;
    setBusy(null);
    if (active) onClose();
    else if (active === false) setMessage("No Plus purchase was found for this Apple ID.");
    else setMessage("Couldn't restore right now. Check your connection and try again.");
  };

  const open = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <Modal
      visible={visible}
      // Always closable, even mid-purchase: a late result still arrives
      // through RevenueCat's listener, so nobody can get stuck here.
      onRequestClose={onClose}
      onShow={onShown}
      animationType={sheetAnimation}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <View style={{ flex: 1, backgroundColor: colors.background }} testID="paywall-sheet">
        <View
          className="flex-row justify-end px-5"
          style={{ paddingTop: Platform.OS === "ios" ? 16 : insets.top + 12 }}
        >
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close. Not now"
            hitSlop={12}
            testID="paywall-close"
          >
            <Ionicons name="close" size={28} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 24, gap: 18 }}>
          <View className="gap-2 items-center">
            <View
              className="w-14 h-14 rounded-2xl items-center justify-center"
              style={{ backgroundColor: `${colors.primary}1f` }}
            >
              <Ionicons name="sparkles" size={28} color={colors.primary} />
            </View>
            <Text
              accessibilityRole="header"
              className="text-3xl text-foreground text-center"
              style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}
            >
              {source ? paywallHeadline(source, { taskCount }) : ""}
            </Text>
            <Text className="text-base text-center" style={{ color: colors.muted }}>
              {source ? paywallSubhead(source, { taskCount }) : ""}
            </Text>
          </View>

          <View className="gap-3">
            {PLUS_BENEFITS.map((benefit) => (
              <View key={benefit.title} className="flex-row gap-3 items-start">
                <Ionicons
                  name={benefit.icon as React.ComponentProps<typeof Ionicons>["name"]}
                  size={22}
                  color={colors.primary}
                />
                <View className="flex-1">
                  <Text className="text-base text-foreground" style={{ fontWeight: "700" }}>
                    {benefit.title}
                  </Text>
                  <Text className="text-sm" style={{ color: colors.muted }}>
                    {benefit.detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {load === "loading" && (
            <View className="items-center py-6" accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.primary} accessibilityLabel="Loading plans" />
            </View>
          )}

          {load === "error" && (
            <View className="items-center gap-3 py-4" testID="paywall-error">
              <Text className="text-sm text-center" style={{ color: colors.muted }}>
                Plans couldn&apos;t load. Check your connection and try again.
              </Text>
              <Pressable
                onPress={() => void fetchPackages()}
                accessibilityRole="button"
                className="rounded-full px-5 py-2"
                style={{ backgroundColor: `${colors.primary}16` }}
              >
                <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                  Try again
                </Text>
              </Pressable>
            </View>
          )}

          {load === "ready" && (
            <View className="gap-3" accessibilityRole="radiogroup">
              {packages.map((pkg) => {
                const label = planLabel(pkg);
                const on = pkg.id === selectedId;
                return (
                  <Pressable
                    key={pkg.id}
                    onPress={() => select(pkg)}
                    disabled={busy !== null}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on, selected: on }}
                    accessibilityLabel={[label.title, label.price, label.detail, label.badge]
                      .filter(Boolean)
                      .join(", ")}
                    className="rounded-2xl border-2 p-4 flex-row items-center gap-3"
                    style={{
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: colors.surface,
                    }}
                    testID={`paywall-plan-${pkg.kind}`}
                  >
                    <Ionicons
                      name={on ? "radio-button-on" : "radio-button-off"}
                      size={22}
                      color={on ? colors.primary : colors.muted}
                    />
                    <View className="flex-1">
                      <Text className="text-base text-foreground" style={{ fontWeight: "700" }}>
                        {label.title}
                      </Text>
                      {label.detail && (
                        <Text className="text-xs" style={{ color: colors.muted }}>
                          {label.detail}
                        </Text>
                      )}
                    </View>
                    <View className="items-end gap-1">
                      {label.badge && (
                        // A tinted chip, never filled: the billed price stays the
                        // most prominent thing on the plan (App Review 3.1.2).
                        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: `${colors.primary}1F` }}>
                          <Text className="text-xs font-semibold" style={{ color: colors.primaryInk }}>
                            {label.badge}
                          </Text>
                        </View>
                      )}
                      <Text className="text-base text-foreground font-bold" testID={`paywall-price-${pkg.kind}`}>
                        {label.price}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {load === "ready" && timeline && (
            <View
              // One element for VoiceOver: the whole timeline in a sentence.
              accessible
              accessibilityRole="text"
              accessibilityLabel={trialTimelineLabel(timeline)}
              className="rounded-2xl px-4 py-3 gap-2"
              // Surface, not a faint primary tint: that all but vanished in dark mode.
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
              testID="paywall-trial-timeline"
            >
              {timeline.map((step, index) => (
                <View key={step.when} className="flex-row items-start gap-3">
                  <View className="items-center" style={{ paddingTop: dotOffset }}>
                    <View
                      className="rounded-full"
                      style={{
                        width: dotSize,
                        height: dotSize,
                        backgroundColor: index === 0 ? colors.primary : "transparent",
                        borderWidth: 2,
                        borderColor: colors.primary,
                      }}
                    />
                  </View>
                  <Text className="flex-1 text-sm text-foreground">
                    <Text style={{ fontWeight: "700" }}>{step.when}</Text>
                    {`  ${step.what}`}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {message && (
            <Text
              className="text-sm text-center"
              style={{ color: colors.muted }}
              accessibilityLiveRegion="polite"
              testID="paywall-message"
            >
              {message}
            </Text>
          )}

          <Pressable
            onPress={() => void buy()}
            disabled={!selected || busy !== null || purchasing}
            accessibilityRole="button"
            accessibilityLabel={purchaseButtonLabel(selected)}
            accessibilityState={{
              disabled: !selected || busy !== null || purchasing,
              busy: busy === "purchase" || purchasing,
            }}
            className="rounded-2xl py-4 items-center"
            style={{
              backgroundColor: colors.primary,
              opacity: selected && !busy && !purchasing ? 1 : 0.5,
            }}
            testID="paywall-buy"
          >
            {busy === "purchase" || purchasing ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text className="text-lg" style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: colors.onPrimary }}>
                {purchaseButtonLabel(selected)}
              </Text>
            )}
          </Pressable>

          {/* Button, then what it bills, then the monthly nudge. */}
          {selected && (
            <Text className="text-xs text-center" style={{ color: colors.muted }} testID="paywall-terms">
              {purchaseTerms(selected)}
            </Text>
          )}

          {showNudge && nudgeText && (
            <Pressable
              onPress={takeNudge}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel={nudgeText}
              accessibilityHint="Selects the monthly plan"
              hitSlop={8}
              className="self-center"
              testID="paywall-monthly-nudge"
            >
              <Text className="text-sm text-center" style={{ color: colors.primary }}>
                {nudgeText}
              </Text>
            </Pressable>
          )}

          {/* Wraps at large text sizes (a row gap between the lines) instead of clipping. */}
          <View className="flex-row flex-wrap justify-center gap-x-5 gap-y-3" testID="paywall-footer">
            <Pressable
              onPress={() => void restore()}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel="Restore purchases"
              accessibilityState={{ busy: busy === "restore", disabled: busy !== null }}
              hitSlop={8}
              testID="paywall-restore"
            >
              {busy === "restore" ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                  Restore purchases
                </Text>
              )}
            </Pressable>
            <Pressable onPress={() => open(TERMS_URL)} accessibilityRole="link" hitSlop={8}>
              <Text className="text-sm" style={{ color: colors.muted }}>
                Terms of Use
              </Text>
            </Pressable>
            <Pressable onPress={() => open(PRIVACY_URL)} accessibilityRole="link" hitSlop={8}>
              <Text className="text-sm" style={{ color: colors.muted }}>
                Privacy
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Connects the sheet to the Plus context. Mounted once near the app root. */
export function PaywallHost() {
  const plus = usePlus();
  const open = plus.paywallSource !== null;
  // The trial timeline only promises the reminder when it can be delivered.
  const [remindersAllowed, setRemindersAllowed] = useState(false);
  useEffect(() => {
    if (!open) return;
    // Re-checked every open (they may have turned notifications off meanwhile).
    setRemindersAllowed(false);
    let cancelled = false;
    getNotificationPermissionStatus()
      .then((status) => {
        if (!cancelled) setRemindersAllowed(status === "granted");
      })
      .catch(() => {
        if (!cancelled) setRemindersAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);
  return (
    <PaywallSheet
      source={plus.paywallSource}
      onClose={plus.closePaywall}
      onShown={plus.markPaywallShown}
      purchasing={plus.purchasing}
      loadPackages={plus.loadPaywallPackages}
      onPurchase={plus.purchase}
      onRestore={plus.restore}
      taskCount={plus.paywallTaskCount}
      remindersAllowed={remindersAllowed}
      onMonthlyNudge={plus.trackMonthlyNudge}
    />
  );
}
