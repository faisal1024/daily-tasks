import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, Platform, View } from "react-native";
import { colorScheme as nativewindColorScheme, vars } from "nativewind";

import { SchemeColors, type ColorScheme } from "@/constants/theme";

type ThemeContextValue = {
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readSystemScheme(): ColorScheme {
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

/**
 * The system appearance, live: Light/Dark switched in Control Centre or on a
 * schedule arrives while the app runs (Appearance's change events, which
 * also cover a change made while the app was in the background). iOS may
 * flip it briefly while the app is in the background (to snapshot both for
 * the app switcher); it flips back the same way, so following every event
 * ends on the right scheme.
 */
export function useSystemScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(readSystemScheme);
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setScheme(colorScheme === "dark" ? "dark" : "light");
    });
    // Anything that changed between the first read and subscribing.
    setScheme(readSystemScheme());
    return () => subscription.remove();
  }, []);
  return scheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemScheme();
  // null follows the system (the default); a scheme set here pins it.
  const [override, setOverride] = useState<ColorScheme | null>(null);
  const colorScheme = override ?? systemScheme;

  const applyScheme = useCallback((scheme: ColorScheme, followSystem: boolean) => {
    if (Platform.OS !== "web") {
      // NativeWind's set() calls Appearance.setColorScheme, which pins the
      // whole app (and stops system changes arriving). Following the system,
      // it's told "system" (which unpins); only an explicit choice pins.
      nativewindColorScheme.set(followSystem ? "system" : scheme);
      return;
    }
    nativewindColorScheme.set(scheme);
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.dataset.theme = scheme;
      root.classList.toggle("dark", scheme === "dark");
      const palette = SchemeColors[scheme];
      Object.entries(palette).forEach(([token, value]) => {
        root.style.setProperty(`--color-${token}`, value);
      });
    }
  }, []);

  const setColorScheme = useCallback((scheme: ColorScheme) => {
    setOverride(scheme);
  }, []);

  useEffect(() => {
    applyScheme(colorScheme, override === null);
  }, [applyScheme, colorScheme, override]);

  const themeVariables = useMemo(
    () =>
      // Every token, so Tailwind classes for newer tokens (onPrimary, onError)
      // resolve natively too, matching the web branch above.
      vars(
        Object.fromEntries(
          Object.entries(SchemeColors[colorScheme]).map(([token, value]) => [`color-${token}`, value]),
        ),
      ),
    [colorScheme],
  );

  const value = useMemo(
    () => ({
      colorScheme,
      setColorScheme,
    }),
    [colorScheme, setColorScheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, themeVariables]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return ctx;
}
