# Punch Card — Swing Day Tracker

A tiny offline web app for ticking off the days of a work swing. Tap a day to punch
it out, watch the ring fill, and get confetti when the swing is done. No accounts,
no server — everything is saved in your device's browser storage.

- Any number of swings, each with its own name, length (1–90 days) and start date
- Tap-to-punch grid with dates and a highlighted "today"
- Progress ring, days-to-go and last-day countdown
- Backup and restore as a JSON file
- Installs to the iOS home screen and works offline

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole UI |
| `styles.css` | Styling |
| `app.js` | State, storage, rendering |
| `sw.js` | Service worker — offline caching |
| `manifest.webmanifest` | Home-screen app metadata |
| `icons/` | App icons |

No build step, no dependencies. Open `index.html` in any browser, or serve the
folder locally with `python3 -m http.server`.

## Publish it on GitHub Pages (free)

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Source**, pick **Deploy from a branch**.
4. Choose the branch holding these files and folder **/ (root)**, then **Save**.
5. Wait a minute, then open `https://<your-username>.github.io/<repo-name>/`.

All paths are relative, so it works from a repo subfolder without any config.

## Put it on your iPhone

1. Open the Pages URL in **Safari** (it must be Safari for the install to work).
2. Tap the **Share** button, then **Add to Home Screen**.
3. Launch it from the home screen — full screen, no browser chrome, works with no signal.

## About your data

Swings are stored in `localStorage` on the device that punched them. They are not
synced anywhere. Clearing Safari's website data, or deleting the home-screen app,
can remove them — use **⋮ → Export backup** now and then, and **Import backup** to
restore onto a new phone.

## Updating

Edit the files and push. The service worker serves the cached copy first and
refreshes in the background, so a change lands on the next launch. To force it
sooner, bump `CACHE` in `sw.js`.
