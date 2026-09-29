// Adds the focus session's App Intents (1.3) to the APP target at prebuild.
//
// Why the app target: App Shortcuts (Siri "Start my next task") are read from
// the app's App Intents metadata, which Xcode extracts only for Swift built in
// the app target itself (not from a pod / static library), and an intent that
// opens the app (or a Live Activity button) runs in the app's process.
// @bacons/apple-targets only makes extension targets (its "app-intent" type is
// a separate ExtensionKit extension), so this small plugin copies the Swift
// sources next to AppDelegate.swift and adds them to the app's Sources phase.
//
// Sources:
// - targets/widget/FocusIntents.swift: shared with the widget extension (one
//   source; the Live Activity's buttons need the same intent types in both);
// - native/app/*.swift: app only (FocusShortcuts, the AppShortcutsProvider).
// ios/ is generated (CNG), so the copies are rewritten on every prebuild.
const fs = require("fs");
const path = require("path");
const { IOSConfig, withDangerousMod, withXcodeProject } = require("expo/config-plugins");

function sourceFiles(projectRoot) {
  const appDir = path.join(projectRoot, "native", "app");
  const appOnly = fs.existsSync(appDir)
    ? fs
        .readdirSync(appDir)
        .filter((name) => name.endsWith(".swift"))
        .sort()
        .map((name) => path.join(appDir, name))
    : [];
  return [path.join(projectRoot, "targets", "widget", "FocusIntents.swift"), ...appOnly];
}

const withCopiedSources = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const { projectRoot, platformProjectRoot, projectName } = cfg.modRequest;
      const dest = path.join(platformProjectRoot, projectName);
      fs.mkdirSync(dest, { recursive: true });
      for (const file of sourceFiles(projectRoot)) {
        fs.copyFileSync(file, path.join(dest, path.basename(file)));
      }
      return cfg;
    },
  ]);

const withSourcesInAppTarget = (config) =>
  withXcodeProject(config, (cfg) => {
    const { projectRoot, projectName } = cfg.modRequest;
    const project = cfg.modResults;
    const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName });
    for (const file of sourceFiles(projectRoot)) {
      const filepath = `${projectName}/${path.basename(file)}`;
      if (project.hasFile(filepath)) continue;
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project,
        targetUuid: target.uuid,
      });
    }
    return cfg;
  });

module.exports = function withFocusAppIntents(config) {
  return withSourcesInAppTarget(withCopiedSources(config));
};
