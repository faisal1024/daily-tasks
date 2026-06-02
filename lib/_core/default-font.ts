// Make the friendly body font (Nunito) the app-wide default for ALL <Text> and
// <TextInput>, so the whole app feels different — not just the few headings that
// set fontFamily explicitly. Headings still override with Fredoka (DisplayFont).
//
// RN custom fonts don't respond to fontWeight, so the default family carries a
// medium weight; components that want bolder body text set Nunito-Bold/ExtraBold.
import { Text, TextInput } from "react-native";

import { BodyFont } from "./theme";

type WithDefaults = { defaultProps?: { style?: unknown } };

export function applyDefaultFont() {
  const base = { fontFamily: BodyFont.semibold };

  const textAny = Text as unknown as WithDefaults;
  textAny.defaultProps = textAny.defaultProps ?? {};
  textAny.defaultProps.style = [base, textAny.defaultProps.style];

  const inputAny = TextInput as unknown as WithDefaults;
  inputAny.defaultProps = inputAny.defaultProps ?? {};
  inputAny.defaultProps.style = [base, inputAny.defaultProps.style];
}
