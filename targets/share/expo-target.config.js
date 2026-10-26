// "Three Today" in the share sheet (1.6 E): text and links from any app are
// saved for later through the App Group (see ShareViewController.swift and
// lib/daily-tasks/capture.ts). Linked into the Xcode project by
// @bacons/apple-targets at prebuild, like the widget (targets/widget).
// Needs its own provisioning profile for com.faisalislam.dailytasks.share
// (EAS makes it on an interactive build; see docs/2026-10-v1.6.md, 1.6 E).
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "share",
  name: "ThreeTodayShare",
  displayName: "Three Today",
  bundleIdentifier: ".share",
  // The app's own minimum: sharing works wherever the app does.
  deploymentTarget: "15.1",
  frameworks: ["Social", "UniformTypeIdentifiers"],
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
