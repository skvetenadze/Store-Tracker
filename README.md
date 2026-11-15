# Resell Tracker — Neutral Black Theme

**Color-only update** of the previously supplied custom-color dashboard.

The interface again uses the original near-black/charcoal foundation (`#0d0d0d`, `#161616`, `#1e1e1e`) with subtle neutral panels and borders instead of coloring every surface purple or green. Purple remains the default accent. Settings → Appearance → Workspace color retains the Green, Orange, Blue, Pink presets and fine-tuning slider; selecting a new accent changes highlights, controls, navigation selection and charts, **not** the black/gray surfaces. The light theme has neutral grays and whites as well.

The source app's exact original dark/light inventory status badges remain independent from the accent. All inventory, shipment, navigation, dashboard, analytics, supplier, email, auth, mobile layout and database/API logic remain unchanged. The standalone PIN page now uses the same neutral black theme and synced accent.

### Deploy

To apply this **color-only** update over the last ZIP, replacing just `premium.css`, `index.html`, and `server.js` is sufficient. `index.html` only changes the setting's descriptive sentence; `server.js` only changes the standalone PIN page CSS. The other included files are copies for convenience. Back up your current repository before deploying.

### Local tests

`npm test` runs static checks. The optional Playwright browser check uses in-memory sample data, not a real database.

**Security:** This design update does not change the existing WebAuthn verification or data-write behavior, which should be separately reviewed before production deployment.
