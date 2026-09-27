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
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { useColors } from "@/hooks/use-colors";
import { PRIVACY_URL, TERMS_URL } from "@/lib/daily-tasks/links";
import {
  defaultPackageId,
  paywallHeadline,
  planLabel,
  PLUS_BENEFITS,
  purchaseButtonLabel,
  purchaseTerms,
  sortPackages,
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
}

export function PaywallSheet({
  source,
  onClose,
  onShown,
  purchasing = false,
  loadPackages,
  onPurchase,
  onRestore,
}: PaywallSheetProps) {
  const colors = useColors();
  const sheetAnimation = useSheetAnimation();
  // White on the light-mode indigo passes contrast; on the lighter dark-mode
  // indigo it doesn't, so use the dark background colour for text there.
  const onPrimary = useColorScheme() === "dark" ? colors.background : "#fff";
  const insets = useSafeAreaInsets();
  const visible = source !== null;
  const [load, setLoad] = useState<LoadState>("loading");
  const [packages, setPackages] = useState<PlusPackage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"purchase" | "restore" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Bumped per open: a load that finishes after close/reopen is ignored.
  const session = useRef(0);

  const fetchPackages = async () => {
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
      setSelectedId(defaultPackageId(loaded));
      setLoad("ready");
    } catch {
      if (mine === session.current) setLoad("error");
    }
  };

  useEffect(() => {
    if (visible) {
      setBusy(null);
      void fetchPackages();
    } else {
      session.current += 1;
    }
    // fetchPackages only depends on props that are stable per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const selected = packages.find((pkg) => pkg.id === selectedId) ?? null;

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
    else if (outcome === "pending") {
      setMessage("Your purchase is waiting for approval. Plus unlocks as soon as it goes through.");
    } else if (outcome === "failed") {
      setMessage("The purchase didn't go through. If you were charged, tap Restore purchases.");
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
              {source ? paywallHeadline(source) : ""}
            </Text>
            <Text className="text-base text-center" style={{ color: colors.muted }}>
              {source === "win_back"
                ? "Your three tasks stay free. Plus brings back AI sorting, break it down and calendar planning."
                : "Your three tasks stay free forever. Plus adds the AI helpers."}
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
                    onPress={() => setSelectedId(pkg.id)}
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
                        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: colors.primary }}>
                          <Text className="text-xs font-semibold" style={{ color: onPrimary }}>
                            {label.badge}
                          </Text>
                        </View>
                      )}
                      <Text className="text-sm text-foreground font-semibold">{label.price}</Text>
                    </View>
                  </Pressable>
                );
              })}
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
              <ActivityIndicator color={onPrimary} />
            ) : (
              <Text className="text-lg" style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: onPrimary }}>
                {purchaseButtonLabel(selected)}
              </Text>
            )}
          </Pressable>

          {selected && (
            <Text className="text-xs text-center" style={{ color: colors.muted }} testID="paywall-terms">
              {purchaseTerms(selected)}
            </Text>
          )}

          <View className="flex-row justify-center gap-5">
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
                Terms
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
  return (
    <PaywallSheet
      source={plus.paywallSource}
      onClose={plus.closePaywall}
      onShown={plus.markPaywallShown}
      purchasing={plus.purchasing}
      loadPackages={plus.loadPackages}
      onPurchase={plus.purchase}
      onRestore={plus.restore}
    />
  );
}
