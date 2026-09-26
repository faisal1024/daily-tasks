import { configDefaults, defineConfig } from "vitest/config";

// Vitest runs the pure-logic suite in tests/. React Native component tests live
// in tests/ui and run under Jest (jest-expo) — see "jest" in package.json.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "tests/ui/**"],
  },
});
