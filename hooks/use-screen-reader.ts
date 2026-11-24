import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** VoiceOver / TalkBack is on, kept fresh (false until the first answer). */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    // A change event is newer than the first answer: a late answer is ignored.
    let changed = false;
    // Wrapped: a stubbed or missing answer reads as "off", never a crash.
    void Promise.resolve(AccessibilityInfo.isScreenReaderEnabled?.())
      .then((on) => {
        if (live && !changed) setEnabled(on === true);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", (on) => {
      changed = true;
      setEnabled(on);
    });
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);
  return enabled;
}
