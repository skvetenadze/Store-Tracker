# Resell Tracker — Custom Accent Studio Update

A targeted update to the existing premium Resell Tracker. Purple is again the default, with an adjustable color slider for all matching interface accent shades. Existing functionality and database/API architecture are retained.

## Changes

- **Color Studio under Settings → Appearance:** Purple (default), Green, Orange, Blue, Pink presets plus a 0–359° live hue slider. The hue adjusts dark/light theme surfaces, borders, glow, text tints, navigation, selected states, action buttons, sales charts, and the standalone PIN screen. The selected hue is stored in browser `localStorage` as `rt-accent-hue`. No account-level setting or new database column is needed.
- **Inventory status colors:** Dark and light status badge color variables have been restored exactly from the originally supplied `index.html`. These colors are deliberately **independent** from the general website accent. On the first load of this update, previous custom badge overrides are cleared once to restore the exact original palette; future manually customized badge colors continue to save as usual.
- **Quick Actions:** Only Add item and Supplier remain. The card's vertical padding, button sizes, and overall footprint are reduced. Import/Export remain accessible in the desktop top bar and mobile More menu.
- **Inbound Shipments:** Cards now display `BATCH 01`, `BATCH 02`, etc., instead of the title describing product names and quantities. The batch date, total units incoming, tracking number, copy button, and carrier link remain. Grouping still uses last-updated local date and tracking number, not carrier-verified ship dates.
- **KPI bar charts:** The Total Profit, Total Revenue, and Items Sold charts now use the full card width with responsive chart dimensions and significantly taller bars on desktop and phones. Positive profit retains its green semantic color; revenue/count bars and the featured revenue graph follow the selected interface accent.
- The previously implemented Delivered at Home inventory default, sold-excluded Status Breakdown, shipment grouping, responsive mobile navigation, desktop sidebar Preferences position, View Reports-only overview header, and undistorted featured chart remain intact.

## Project files

- `index.html`: application frontend and original data/business logic, with the new theme controls and chart layouts
- `premium.css`: design system, responsive styles, and hue-driven color tokens
- `server.js`: Express backend and standalone PIN page styled to honor the saved hue
- `db.js`, `package.json`, `.gitignore`, `.gitattributes`: original project dependencies and config
- `tests/smoke.js`: code and markup checks; run via `npm test`
- `tests/browser_theme_check.py`: optional Playwright visual and interaction checks using sample data. No production DB used.

## Install/deploy

1. Back up your current project and PostgreSQL database.
2. Replace the frontend/style/backend files with these copies in your existing repository, retaining the Railway environment values.
3. Run `npm install` then `npm test`.
4. Verify the updated app on a staging Railway service/database and test inventory writes, templates, import/export, authentication, and both desktop/mobile views before production deployment.

## Security notes

This is a UI-focused update, not a security overhaul. The previously identified WebAuthn biometric endpoint in the supplied backend does not validate assertion signatures, and the original environment secret fallbacks and full-table save behavior remain. Fix these in a separate backend security/data-integrity update before trusting biometrics on a publicly accessible deployment.
