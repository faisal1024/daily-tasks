// Spoken cues for VoiceOver / TalkBack, shared by the timer views and hooks.
import { AccessibilityInfo, Platform } from "react-native";

/** Read out after the button's own label, and without cutting anything off. */
export function announcePolitely(text: string): void {
  if (Platform.OS === "ios" && typeof AccessibilityInfo.announceForAccessibilityWithOptions === "function") {
    AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true });
    return;
  }
  AccessibilityInfo.announceForAccessibility(text);
}
