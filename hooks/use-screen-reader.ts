import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** VoiceOver / TalkBack is on, kept fresh (false until the first answer). */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    // Wrapped: a stubbed or missing answer reads as "off", never a crash.
    void Promise.resolve(AccessibilityInfo.isScreenReaderEnabled?.())
      .then((on) => {
        if (live) setEnabled(on === true);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setEnabled);
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);
  return enabled;
}
