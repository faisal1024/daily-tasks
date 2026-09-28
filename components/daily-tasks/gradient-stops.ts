// Shared indigo gradient stops. Darker in dark mode to soften the seam against a
// dark body (matches the Today hero). Kept in a plain module (no React Native
// imports) so the contrast tests can check the text drawn on top of them.
export const GRADIENT_LIGHT = ["#5B52E8", "#6258E9", "#6A61EB"] as const;
export const GRADIENT_DARK = ["#3C36A8", "#453EBE", "#504AD4"] as const;
