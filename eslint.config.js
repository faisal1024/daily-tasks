// https://docs.expo.dev/guides/using-eslint/
import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["**/*.{tsx,jsx}"],
    rules: {
      // React Native <Text> renders raw apostrophes correctly; the DOM-oriented
      // unescaped-entities rule produces false positives that contradict the
      // app's "no HTML-escaped copy" guideline.
      "react/no-unescaped-entities": "off",
    },
  },
]);
