# Punch Card — FIFO Swing Tracker

A tiny offline web app for FIFO work. Set your roster cycle once and it works out
every swing from now until forever — then you punch out the days one at a time.
No accounts, no server; everything is saved in your device's browser storage.

## How it works

Your **roster** is the source of truth. You describe one cycle as a list of blocks
(14 days on → 14 off, or 7 days → 7 nights → 14 off, whatever yours is) and anchor
it to a single fly-in date. The cycle repeats forwards and backwards from there, so
swings never need creating by hand.

**Punches are stored against calendar dates**, not against a swing number. Fix a
wrong fly-in date or add a night block later and the days you already ticked stay
attached to the dates you actually worked.

### Swing tab
The swing you're in right now, as a grid of tap-to-punch days. Each day shows its
real date and shift colour, day 1 is marked ✈ fly in, the last day ✈ fly out. A ring
tracks your progress, and the last punch of a swing sets off the confetti. Arrows step
back and forward through swings for anything you forgot to tick. On R&R it flips to a
countdown to your next fly-in and shows the coming swing.

### Calendar tab
A month at a glance for everyone you've added — ochre day shifts, indigo nights,
green R&R, ✈ on travel days, ✓ on days you've punched. Tap any day, or use the date
field, for the full rundown: who's on, which day of the swing, and what changes next.

### Roster tab
Name, fly-in date, and the block builder, plus one-tap presets for the usual
rosters (14:14, 14:7, 8:6, 7D:7N:14 off, 28:7 and more). Add crew here to see their
swings beside yours on the calendar.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole UI — three tabs |
| `styles.css` | Styling |
| `app.js` | Roster maths, state, storage, rendering |
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

Rosters and punches are stored in `localStorage` on the device that made them. They
are not synced anywhere. Clearing Safari's website data, or deleting the home-screen
app, can remove them — use **⋮ → Export backup** now and then, and **Import backup**
to restore onto a new phone.

Swings from the older hand-made version are migrated automatically on first load:
every tick is re-keyed to its date, and a cycle is seeded from the most recent swing
so it only needs its off-block adjusting. Old backup files still import too.

## Updating

Edit the files and push. The service worker serves the cached copy first and
refreshes in the background, so a change lands on the next launch. To force it
sooner, bump `CACHE` in `sw.js`.
