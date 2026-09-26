const { themeColors } = require("./theme.config");
const plugin = require("tailwindcss/plugin");

const tailwindColors = Object.fromEntries(
  Object.entries(themeColors).map(([name, swatch]) => [
    name,
    {
      DEFAULT: `var(--color-${name})`,
      light: swatch.light,
      dark: swatch.dark,
    },
  ]),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  // Scan all component and app files for Tailwind classes
  content: ["./app/**/*.{js,ts,tsx}", "./components/**/*.{js,ts,tsx}", "./lib/**/*.{js,ts,tsx}", "./hooks/**/*.{js,ts,tsx}"],

  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: tailwindColors,
      // Bundled fonts as NativeWind classes (font-display / font-body…), so the
      // family is emitted by NativeWind itself — avoids inline-style vs className
      // conflicts that were silently dropping fontFamily.
      fontFamily: {
        display: ["Baloo2-Bold"],
        "display-semibold": ["Baloo2-SemiBold"],
        body: ["Nunito-SemiBold"],
        "body-bold": ["Nunito-Bold"],
        "body-extrabold": ["Nunito-ExtraBold"],
      },
    },
  },
  plugins: [
    plugin(({ addVariant }) => {
      addVariant("light", ':root:not([data-theme="dark"]) &');
      addVariant("dark", ':root[data-theme="dark"] &');
    }),
  ],
};
