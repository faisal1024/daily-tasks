/** @type {const} */
// Playful-but-calm palette: a friendly indigo primary + warm coral accent over
// soft, low-saturation surfaces. Approachable and gamified without feeling loud.
const themeColors = {
  primary: { light: '#5B52E8', dark: '#8B82FF' },
  // Text and icons on a primary fill (dark text on the lighter dark-mode primary).
  onPrimary: { light: '#FFFFFF', dark: '#161420' },
  accent: { light: '#FF7A6B', dark: '#FF8F80' },
  background: { light: '#FBFAFF', dark: '#161420' },
  surface: { light: '#F3F1FC', dark: '#221F30' },
  foreground: { light: '#1E1B2E', dark: '#F3F1FB' },
  // Light muted darkened from #79748F for WCAG AA (4.5:1) on the light background.
  muted: { light: '#6A6580', dark: '#A8A3C0' },
  border: { light: '#E8E4F6', dark: '#332F45' },
  success: { light: '#16C784', dark: '#37D9A0' },
  warning: { light: '#F5A524', dark: '#FBBF24' },
  // Light error darkened from #F4525F so white text/icons on it (and the error
  // as text on the light surface) meet WCAG AA (4.5:1). Dark stays light: it is
  // also error text on the dark surface, which any darker red would fail.
  error: { light: '#D12B3B', dark: '#FB7185' },
  // Text and icons on an error fill (dark text on the lighter dark-mode error).
  onError: { light: '#FFFFFF', dark: '#161420' },
};

module.exports = { themeColors };
