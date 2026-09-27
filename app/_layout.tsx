import "@/global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import "@/lib/_core/nativewind-pressable";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider } from "@/lib/theme-provider";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { PlusProvider } from "@/lib/daily-tasks/plus-context";
import { PaywallHost } from "@/components/daily-tasks/paywall-sheet";
import { ErrorBoundary } from "@/components/error-boundary";

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  return (
    // Outermost, so a failure anywhere below (theme included) shows the calm
    // fallback instead of a blank screen. The fallback uses plain colours.
    <ErrorBoundary>
      <ThemeProvider>
        <SafeAreaProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <PlusProvider>
              <DailyTasksProvider>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(tabs)" />
                </Stack>
                <PaywallHost />
                <StatusBar style="auto" />
              </DailyTasksProvider>
            </PlusProvider>
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
