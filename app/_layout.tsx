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

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  // Bundle the real display + body fonts so the playful look actually renders.
  // GATE render on loaded so no text mounts with the system font first (the
  // earlier bug: text rendered before fonts registered and never swapped).
  const [fontsLoaded, fontError] = useFonts({
    "Baloo2-Medium": require("@/assets/fonts/Baloo2-500.ttf"),
    "Baloo2-SemiBold": require("@/assets/fonts/Baloo2-600.ttf"),
    "Baloo2-Bold": require("@/assets/fonts/Baloo2-700.ttf"),
    "Baloo2-ExtraBold": require("@/assets/fonts/Baloo2-800.ttf"),
    "Nunito-SemiBold": require("@/assets/fonts/Nunito-600.ttf"),
    "Nunito-Bold": require("@/assets/fonts/Nunito-700.ttf"),
    "Nunito-ExtraBold": require("@/assets/fonts/Nunito-800.ttf"),
  });

  // Wait for fonts so text doesn't flash in the system font first — but if they
  // fail to load, render anyway (degrade to system font, never a blank app).
  if (!fontsLoaded && !fontError) return null;

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
