/** @type {const} */
// Playful-but-calm palette: a friendly indigo primary + warm coral accent over
// soft, low-saturation surfaces. Approachable and gamified without feeling loud.
const themeColors = {
  primary: { light: '#5B52E8', dark: '#8B82FF' },
  // Text and icons on a primary fill (dark text on the lighter dark-mode primary).
  onPrimary: { light: '#FFFFFF', dark: '#161420' },
  // Text and icons on a primary *tint* (primary at ~12% over the surface):
  // plain primary is under 4.5:1 there, this ink is AA in both modes.
  primaryInk: { light: '#4A40D0', dark: '#9B94FF' },
  accent: { light: '#FF7A6B', dark: '#FF8F80' },
  background: { light: '#FBFAFF', dark: '#161420' },
  surface: { light: '#F3F1FC', dark: '#221F30' },
  foreground: { light: '#1E1B2E', dark: '#F3F1FB' },
  // Light muted darkened from #79748F for WCAG AA (4.5:1) on the light background.
  muted: { light: '#6A6580', dark: '#A8A3C0' },
  // Card and divider hairlines only: too faint (~1.2:1) to outline a control.
  border: { light: '#E8E4F6', dark: '#332F45' },
  // Outlines of interactive controls (empty tick circles, pick rows, inputs):
  // at least 3:1 on the background and surface in both modes (WCAG 1.4.11).
  controlBorder: { light: '#857F9E', dark: '#7C7794' },
  // Light success darkened from #16C784 (2.2:1 under a white tick) so the fill
  // is 3:1+ on the background and surface and white on it is AA (4.5:1).
  success: { light: '#0E875D', dark: '#37D9A0' },
  // Text and icons on a success fill (dark text on the lighter dark-mode success).
  onSuccess: { light: '#FFFFFF', dark: '#161420' },
  // Success as small text on the background or a surface (AA in both modes).
  successInk: { light: '#0B7A55', dark: '#37D9A0' },
  warning: { light: '#F5A524', dark: '#FBBF24' },
  // Light error darkened from #F4525F so white text/icons on it (and the error
  // as text on the light surface) meet WCAG AA (4.5:1). Dark stays light: it is
  // also error text on the dark surface, which any darker red would fail.
  error: { light: '#D12B3B', dark: '#FB7185' },
  // Text and icons on an error fill (dark text on the lighter dark-mode error).
  onError: { light: '#FFFFFF', dark: '#161420' },
};

module.exports = { themeColors };
