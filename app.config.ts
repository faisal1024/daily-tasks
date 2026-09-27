import type { ExpoConfig } from "expo/config";

const bundleId = "com.faisalislam.dailytasks";

const env = {
  appName: "Three Today",
  appSlug: "daily-tasks",
  scheme: "dailytasks",
  iosBundleId: bundleId,
  androidPackage: bundleId,
  momentumAiProxyUrl: process.env.EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL ?? null,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.1.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    // Shared with the home/lock-screen widget (targets/widget).
    entitlements: {
      "com.apple.security.application-groups": [`group.${env.iosBundleId}`],
    },
    "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false
      }
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#022266",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    // Calendar planning is iOS-only; expo-calendar would add these otherwise.
    blockedPermissions: ["android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR"],
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    permissions: ["POST_NOTIFICATIONS"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "@bacons/apple-targets",
    "expo-notifications",
    [
      "expo-calendar",
      {
        calendarPermission:
          "Used to plan today's three around your events, only if you turn it on. Event titles and times are sent to our AI service to make suggestions and aren't stored.",
        remindersPermission:
          "Used to plan today's three around what's due, only if you turn it on. Reminder titles and due times are sent to our AI service to make suggestions and aren't stored.",
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    momentumAiProxyUrl: env.momentumAiProxyUrl,
    eas: {
      projectId: "e67ec287-0ca6-48c4-bc9e-d106aec8d145",
    },
  },
  owner: "faisalislam1024",
};

export default config;
