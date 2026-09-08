# Superflux Brand Calendar — static site

A single static page that renders the brand calendar from `calendar-data.js`. Deploy once; the weekly Cowork task only ever rewrites `calendar-data.js`.

## Files

- `index.html` — the page. No build step, no dependencies. Do not edit for content changes.
- `calendar-data.js` — the only file the weekly task touches.
- `assets/` — Founders Grotesk (Regular, Medium, Light Italic), Superflux badge.

## Deploy (Vercel)

1. Create a GitHub repo `superflux-brand-calendar` and push this folder as the root.
2. In Vercel: New Project → import the repo → Framework preset "Other", no build command, output directory `.` → Deploy.
3. Every push to `main` redeploys. The URL is stable; that's the link for Slack. The page opens on the current month automatically and each month has its own hash (`…/#2026-10`), so a link can point at a specific month.

## Weekly task contract

The task reads the Drive form responses and writes `calendar-data.js` in this shape, then commits and pushes to `main`:

```js
window.SFX_CALENDAR = {
  months: [ { id: "2026-09", label: "September 2026" }, … ],   // months to show, in order
  categories: [ { id: "core", label: "Core release" }, … ],    // legend, in order
  items: [
    // One-day item (release or event)
    { name: "Evergreen", cat: "core", date: "2026-09-15" },
    // Date-range item (on tap / wholesale window) — renders as a bar across each week it touches
    { name: "$1 Colour & Shape LTO", cat: "lto", start: "2026-09-20", end: "2026-10-17" }
  ],
  recurring: [
    // weekdays: 0 = Sunday … 6 = Saturday
    { name: "Burger Day", cat: "burger", weekdays: [0, 6] }
  ]
};
```

Rules:
- Dates are ISO `YYYY-MM-DD`. An item has either `date` OR `start`+`end`, never both.
- Use full names — nothing is truncated, chips wrap.
- Keep `months` covering the current month or the page falls back to the first month listed. Rolling three months (current + 2) is the intended window; older months can be dropped.
- Every `cat` must be one of the IDs below. Unknown categories render black.

## Categories → sidebar section → colour

| `cat` | Legend label | Sidebar section | Colour |
|---|---|---|---|
| `core` | Core release | Releases this month | `#2D5BE3` |
| `exp` | Experimental | Releases this month | `#F26B1F` |
| `fruit` | Heavy Fruit | Releases (date) / On tap (range) | `#E8378A` |
| `creamery` | The Creamery | Releases this month | `#F2C230` |
| `collab` | Collab | Releases this month | `#2FA86B` |
| `release` | New release | Releases this month | `#7A4BD9` |
| `lto` | Wholesale $1 LTO | Wholesale | `#F8BDD7` |
| `event` | Event | Releases this month | white, black outline |
| `burger` / `food` | Food | Food | `#000000` |

Colours are approximations of the Experimental IPA can palette and live in the `COLORS` map at the top of the script in `index.html`. Text colour flips black/white automatically by luminance. Add a category by adding it to `COLORS` and to `categories` in the data file.

## Design notes

Founders Grotesk throughout; caps are tracked, lowercase never is. Square corners, black rules, no shadows. Layout: header (badge · month title · month nav) → legend → 7-column grid with span bars per week and wrapping chips per day → 280px right column (Releases · On tap · Wholesale · Food) → footer. Below 760px the right column drops under the grid.
