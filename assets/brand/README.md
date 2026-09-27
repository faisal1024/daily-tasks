# Brand icon

- `icon-source.webp`: the original artwork (rounded square with a glossy rim and
  transparent corners). Keep it: every other icon is generated from it.
- `appstore-icon-1024.png`: full-bleed, opaque 1024×1024 (the rim is cropped away and
  the corners filled; iOS applies its own rounded mask). This is also
  `assets/images/icon.png`, the icon App Store Connect takes from the build.
- `icon-1024-rounded.png`: the same with iOS-like rounded transparent corners
  (used for the splash screen and favicon).

Generated app assets (`assets/images/`): `icon.png`, `splash-icon.png`, `favicon.png`,
`android-icon-background.png` (artwork padded so the adaptive mask keeps the rays),
`android-icon-foreground.png` (transparent), `android-icon-monochrome.png` (sun
silhouette for themed icons). Adaptive icon `backgroundColor` `#022266` is only a
fallback (Expo uses the background image when one is set).
