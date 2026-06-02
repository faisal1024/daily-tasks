import "@/global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import "@/lib/_core/nativewind-pressable";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider } from "@/lib/theme-provider";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { applyDefaultFont } from "@/lib/_core/default-font";

applyDefaultFont();

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  // Bundle the real display + body fonts so the playful look actually renders.
  // Don't block the UI on load — the system font shows for the first frame and
  // swaps in once these resolve.
  useFonts({
    "Fredoka-Regular": require("@/assets/fonts/Fredoka-400.ttf"),
    "Fredoka-Medium": require("@/assets/fonts/Fredoka-500.ttf"),
    "Fredoka-SemiBold": require("@/assets/fonts/Fredoka-600.ttf"),
    "Fredoka-Bold": require("@/assets/fonts/Fredoka-700.ttf"),
    "Nunito-SemiBold": require("@/assets/fonts/Nunito-600.ttf"),
    "Nunito-Bold": require("@/assets/fonts/Nunito-700.ttf"),
    "Nunito-ExtraBold": require("@/assets/fonts/Nunito-800.ttf"),
  });

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <DailyTasksProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
            </Stack>
            <StatusBar style="auto" />
          </DailyTasksProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
