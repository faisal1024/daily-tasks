import { useReducedMotion } from "react-native-reanimated";

/** Sheets slide up, or simply fade in when Reduce Motion is on. */
export function useSheetAnimation(): "slide" | "fade" {
  return useReducedMotion() ? "fade" : "slide";
}
