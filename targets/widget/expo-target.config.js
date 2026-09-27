// Home-screen + lock-screen widgets for Today's three (Phase 5).
// Shares state with the app through the App Group below (see
// lib/daily-tasks/widget-bridge.ts). Interactive buttons need iOS 17.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "DailyTasksWidget",
  displayName: "Three Today",
  bundleIdentifier: ".widget",
  deploymentTarget: "17.0",
  colors: {
    $widgetBackground: { light: "#FBFAFF", dark: "#161420" },
    $accent: { light: "#5B52E8", dark: "#8B82FF" },
    primary: { light: "#5B52E8", dark: "#8B82FF" },
    muted: { light: "#6A6580", dark: "#A8A3C0" },
    foreground: { light: "#1E1B2E", dark: "#F3F1FB" },
    success: { light: "#16C784", dark: "#37D9A0" },
  },
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
