// ThemeProvider: the native CSS variables NativeWind classes resolve against.
import { Appearance, Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { colorScheme as nativewindColorScheme, vars } from "nativewind";

import { SchemeColors } from "@/constants/theme";
import { ThemeProvider, useThemeContext } from "@/lib/theme-provider";

// Pass-through spy: the real vars() returns an opaque style, so record its input.
jest.mock("nativewind", () => {
  const actual = jest.requireActual("nativewind");
  return { ...actual, vars: jest.fn(actual.vars) };
});

it("gives native every theme token as a CSS variable, including onError and onPrimary", async () => {
  await render(
    <ThemeProvider>
      <Text>child</Text>
    </ThemeProvider>,
  );
  expect(screen.getByText("child")).toBeOnTheScreen();
  const variables = jest.mocked(vars).mock.calls.at(-1)?.[0];
  expect(variables).toEqual(
    expect.objectContaining({
      "color-onError": SchemeColors.light.onError,
      "color-onPrimary": SchemeColors.light.onPrimary,
    }),
  );
  // No token left out (a hand-written list silently drops new ones).
  expect(Object.keys(variables ?? {}).sort()).toEqual(
    Object.keys(SchemeColors.light)
      .map((token) => `color-${token}`)
      .sort(),
  );
});

// U2 (1.3 polish): the app follows the system's Light/Dark live. NativeWind's
// set("light" | "dark") pins Appearance (the old bug), so it's told "system".
describe("following the system appearance", () => {
  function Scheme() {
    return <Text testID="scheme">{useThemeContext().colorScheme}</Text>;
  }

  it("switches when the system changes while active, and never pins Appearance", async () => {
    const listeners: ((prefs: { colorScheme: "light" | "dark" | null }) => void)[] = [];
    const getScheme = jest.spyOn(Appearance, "getColorScheme").mockReturnValue("light");
    const add = jest.spyOn(Appearance, "addChangeListener").mockImplementation((listener) => {
      listeners.push(listener as (prefs: { colorScheme: "light" | "dark" | null }) => void);
      return { remove: jest.fn() } as unknown as ReturnType<typeof Appearance.addChangeListener>;
    });
    const set = jest.spyOn(nativewindColorScheme, "set");
    try {
      await render(
        <ThemeProvider>
          <Scheme />
        </ThemeProvider>,
      );
      expect(screen.getByTestId("scheme")).toHaveTextContent("light");
      getScheme.mockReturnValue("dark");
      await act(async () => listeners.forEach((listener) => listener({ colorScheme: "dark" })));
      expect(screen.getByTestId("scheme")).toHaveTextContent("dark");
      await act(async () => listeners.forEach((listener) => listener({ colorScheme: "light" })));
      expect(screen.getByTestId("scheme")).toHaveTextContent("light");
      expect(set).toHaveBeenCalledWith("system");
      expect(set).not.toHaveBeenCalledWith("light");
      expect(set).not.toHaveBeenCalledWith("dark");
    } finally {
      getScheme.mockRestore();
      add.mockRestore();
      set.mockRestore();
    }
  });
});

it('setColorScheme pins a scheme, and "system" follows the system again', async () => {
  const getScheme = jest.spyOn(Appearance, "getColorScheme").mockReturnValue("light");
  const set = jest.spyOn(nativewindColorScheme, "set");
  let api: ReturnType<typeof useThemeContext> | null = null;
  function Probe() {
    api = useThemeContext();
    return <Text testID="scheme">{api.colorScheme}</Text>;
  }
  try {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => api!.setColorScheme("dark"));
    expect(screen.getByTestId("scheme")).toHaveTextContent("dark");
    expect(set).toHaveBeenLastCalledWith("dark");
    await act(async () => api!.setColorScheme("system"));
    expect(screen.getByTestId("scheme")).toHaveTextContent("light");
    expect(set).toHaveBeenLastCalledWith("system");
  } finally {
    getScheme.mockRestore();
    set.mockRestore();
  }
});
