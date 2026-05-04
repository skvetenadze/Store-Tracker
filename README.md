# Resell Tracker Web Version

This is the Railway-ready web version of the Electron Resell Tracker app.

## Run locally

```bash
npm install
npm start
```

Open:

```txt
http://localhost:3000
```

## Deploy to Railway

1. Push this folder to GitHub.
2. Railway → New Project → Deploy from GitHub Repo.
3. Railway will run `npm install` and `npm start` automatically.
4. Go to Settings / Networking and generate a public domain.

## Notes

This version keeps the same UI and app behavior, but replaces Electron desktop file storage with browser localStorage.
CSV import/export still works in the browser.
