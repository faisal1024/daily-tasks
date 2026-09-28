// ThemeProvider: the native CSS variables NativeWind classes resolve against.
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { vars } from "nativewind";

import { SchemeColors } from "@/constants/theme";
import { ThemeProvider } from "@/lib/theme-provider";

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
