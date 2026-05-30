import { Linking, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import type { UpdateInfo } from "@/lib/daily-tasks/app-update";

interface UpdateBannerProps {
  update: UpdateInfo;
  onDismiss: () => void;
}

export function UpdateBanner({ update, onDismiss }: UpdateBannerProps) {
  const colors = useColors();

  const openStore = () => {
    // storeUrl is already sanitized to https upstream; re-check defensively.
    if (update.storeUrl && /^https:\/\//i.test(update.storeUrl)) {
      Linking.openURL(update.storeUrl).catch(() => {});
    }
    onDismiss();
  };

  return (
    <View
      className="bg-surface rounded-2xl p-4 border"
      style={{ borderColor: colors.primary }}
    >
      <View className="flex-row items-start gap-3">
        <Ionicons name="sparkles" size={20} color={colors.primary} />
        <View className="flex-1 gap-1">
          <Text className="text-sm font-semibold text-foreground">
            A new version is available
          </Text>
          <Text className="text-xs text-muted">
            Version {update.latestVersion} is ready. Update for the latest improvements.
          </Text>
          <View className="flex-row gap-2 mt-2">
            {update.storeUrl ? (
              <Pressable
                onPress={openStore}
                className="rounded-full px-4 py-2"
                style={{ backgroundColor: colors.primary }}
              >
                <Text
                  className="text-xs font-semibold"
                  style={{ color: colors.background }}
                >
                  Update
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onDismiss}
              className="rounded-full px-4 py-2 border"
              style={{ borderColor: colors.border }}
            >
              <Text className="text-xs font-semibold text-muted">Later</Text>
            </Pressable>
          </View>
        </View>
        <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss update notice">
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}
