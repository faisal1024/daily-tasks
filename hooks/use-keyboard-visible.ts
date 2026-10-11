import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

/** The on-screen keyboard is up (someone is typing). */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible?.() ?? false);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setVisible(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return visible;
}
