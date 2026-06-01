# Build Resources

electron-builder looks here for packaging assets. Drop in the
following files when you have them and the next `npm run package`
will pick them up automatically:

- `icon.png` — 1024×1024 PNG. electron-builder generates the
  macOS `.icns` from this. Without it, the dock shows the default
  Electron icon.
- `background.png` (optional) — 540×380 or 540×380@2x. DMG drag-
  to-install background. Without it, the DMG window is plain.
- `entitlements.mac.plist` (optional) — if/when we enable code
  signing + notarization.
