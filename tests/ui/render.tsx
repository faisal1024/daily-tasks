import type { ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider } from "@/lib/theme-provider";

const METRICS = {
  frame: { x: 0, y: 0, width: 440, height: 956 },
  insets: { top: 62, left: 0, right: 0, bottom: 34 },
};

function Providers({ children }: { children: ReactElement }) {
  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
    </ThemeProvider>
  );
}

/**
 * Render with the same providers the app root uses (theme + safe area). The
 * returned `rerender` keeps the providers too.
 */
export async function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const result = await render(ui, { ...options, wrapper: Providers });
  return result;
}
