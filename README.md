# Superflux Brand Calendar — static site

A single static page that renders the brand calendar from `calendar-data.js`. Deploy once; the weekly Cowork task only ever rewrites `calendar-data.js`.

## Files

- `index.html` — the page. No build step, no dependencies. Do not edit for content changes.
- `calendar-data.js` — the only file the weekly job rewrites. Generated; do not edit by hand.
- `data/events.csv` — the form responses, pushed from the sheet by the Apps Script. Do not edit by hand.
- `apps-script/PushCalendarCsv.gs` — the script that lives in the responses sheet and pushes `data/events.csv`.
- `scripts/build-calendar-data.mjs` — builds `calendar-data.js` from `data/events.csv`.
- `scripts/links.mjs` — owns calendar-name → Brand Reference slug lookup.
- `scripts/validate-links.mjs` — the gate the workflow runs before committing.
- `scripts/monday-check.mjs` — read-only weekly check run by Adam's Monday scheduled task: sync
  freshness, empty months, and the week's diff. Prints which email to send; never sends anything itself.
- `beer-links.json` — the reviewed name → slug map. Edited by a person, never generated.
- `scripts/og-card.html` — source for the link-preview image. Re-render after editing:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --window-size=1200,630 --screenshot=assets/og.png scripts/og-card.html`
- `assets/` — Superflux badge. The Founders Grotesk `.woff2` files live here locally but are
  **git-ignored**: they are licensed and must not be redistributed in a public repo. They are
  served from a Vercel Blob store instead — see "Fonts" below.

## Fonts

Founders Grotesk is commercially licensed, so the font files are not in this repo. They are
uploaded once to a public Vercel Blob store (`superflux-fonts`) and referenced by absolute URL
from the `@font-face` rules in `index.html`:

```
https://tcreadmlo1botdmp.public.blob.vercel-storage.com/fonts/founders-grotesk-web-{regular,medium,light-italic}.woff2
```

They are already uploaded; nothing routine needs to touch them. To replace one:

```bash
vercel blob put assets/founders-grotesk-web-regular.woff2 \
  --pathname fonts/founders-grotesk-web-regular.woff2 --access public
```

Keep local copies of the `.woff2` files in `assets/` for reference — a fresh `git clone` will not
have them, and the page will fall back to Montserrat / system sans until they are re-uploaded.

## Deploy (Vercel)

1. Create a GitHub repo `superflux-brand-calendar` and push this folder as the root.
2. In Vercel: New Project → import the repo → Framework preset "Other", no build command, output directory `.` → Deploy.
3. Every push to `main` redeploys. The URL is stable; that's the link for Slack. The page opens on the current month automatically and each month has its own hash (`…/#2026-10`), so a link can point at a specific month.

## Weekly task contract

`calendar-data.js` is **generated** — do not edit it by hand. The data flows:

1. **Sheet → repo.** `apps-script/PushCalendarCsv.gs` runs inside the "Superflux Events Calendar
   Submission (Responses)" sheet (Extensions -> Apps Script) on every form submission and hourly.
   It writes the "Form Responses 1" tab to `data/events.csv` via the GitHub API, only when the
   contents changed. It runs as the sheet owner inside the domain, so the sheet stays unpublished
   and unshared — the shared drives block external sharing, which is why the old published-to-web
   CSV stopped working.
2. **Repo → site.** A push to `data/events.csv` triggers the `sync-calendar-data` workflow, which runs
   `scripts/build-calendar-data.mjs` and commits `calendar-data.js` only when it differs; that push
   redeploys the site. The workflow also runs hourly (to roll the three-month window forward) and on
   manual dispatch.

The Apps Script authenticates with a fine-grained GitHub token stored in the script's properties
(`GITHUB_TOKEN`), scoped to this repo with "Contents: Read and write" and nothing else. When it
expires, generate a new one and replace the property. Setup steps are at the top of the `.gs` file;
if the sheet is ever moved or copied, the script goes with it, but triggers must be reinstalled by
running `installTriggers()` once.

If the build script can't read a valid responses CSV (wrong file, sign-in page, HTTP error) it exits
non-zero and the workflow fails, leaving the last good calendar live rather than blanking it.

A green run means the data is current, not just that nothing changed. The workflow also fails when:

- **the sheet push has gone quiet.** On every successful run the Apps Script sends a `sheet-heartbeat`
  repository_dispatch, even when nothing changed. `scripts/check-freshness.mjs` fails the run if
  neither a heartbeat nor a `data/events.csv` commit has arrived in 6 hours (`FRESHNESS_MAX_HOURS`).
  If it's red: open the sheet's Apps Script project → Executions (errors) and Triggers (both
  `pushCalendarCsv` triggers present), and check the `GITHUB_TOKEN` script property hasn't expired.
- **a displayed month has no dated events.** The LTO runs alone should always cover all three months,
  so an empty month means stale input. The build exits before writing `calendar-data.js`.

To run it by hand:

```bash
gh workflow run sync-calendar-data.yml          # via Actions
node scripts/build-calendar-data.mjs            # locally, from data/events.csv
```

Which sheet column maps to which category is decided by `categorise()` in the script — that is the
one place to edit when a new event type appears or a release is filed under the wrong colour. The
script also collapses duplicate submissions, clamps everything to the rolling three-month window,
and turns "every Saturday and Sunday"-style rules into `recurring` entries (nth-weekday rules such
as "every first Monday" are not supported and are skipped with a warning).

The generated file has this shape:

```js
window.SFX_CALENDAR = {
  months: [ { id: "2026-09", label: "September 2026" }, … ],   // months to show, in order
  categories: [ { id: "core", label: "Standing Order" }, … ],    // legend, in order
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

## Linking chips to the Brand Reference

Chips, span bars and sidebar rows link to `superflux-brand-reference.vercel.app/beer/<slug>`
when — and only when — `beer-links.json` says which slug a calendar item means. Everything
else renders as a plain, unlinked chip. The link target is the `REF` constant at the top of
the script in `index.html`.

**Never match names to slugs automatically.** They do not correspond, in either direction.
`Exp. DIPA #1` looks like `experimental-ipa-81` and is actually `experimental-dipa-1`;
`Drip Tiramisu Coffee Stout` is `drip-2026` and no algorithm can get there from the name;
`The Creamery Pumpkin Pie` looks like `heavy-fruit-pumpkin-pie`, which is a different brand
family with different allergens. Reference records carry allergen data, so a wrong link is a
safety problem. Auto-matching may propose an entry for review; it may never write one.

### The three buckets

| Bucket | Meaning | Renders |
|---|---|---|
| `links` | Verified, and the page is live in `beers.json` | linked |
| `pending` | Slug verified in the canon, page not published yet | plain chip |
| `unlinked` | Reviewed, deliberately not linked — with the reason | plain chip |

`pending` exists because the canon runs ahead of the site: a slug can be real in the canon and
still 404 until the reference's `canon-sync` PR merges. Move an entry from `pending` to `links`
once its page is live. `unlinked` records that a person looked and said no, so the same
question isn't reopened every month.

Items in categories `event`, `burger` and `food` never link and need no entry.

### Adding a beer

1. Find the slug in the reference's `beers.json`, or on the beer's own page URL.
2. Add `"<exact calendar name>": "<slug>"` to `links` if the page is live, `pending` if not.
3. Bump `generated`. `node scripts/build-calendar-data.mjs && node scripts/validate-links.mjs`.

Names are matched through `canonKey()` in `scripts/links.mjs`, which absorbs harmless drift —
case, apostrophes, a leading `$1 `, a trailing ` LTO`, a trailing `(… Collab)`. It deliberately
does **not** strip brand-family words like "The Creamery" or "Heavy Fruit", because doing so is
exactly what makes different beers look identical.

### What fails the build, and what only warns

Fails: a malformed slug, a name in two buckets, two names normalising to the same key, a slug
in `calendar-data.js` that the map doesn't sanction, a slug on a non-beer category, or a map
more than 90 days old. Warns: a calendar item in no bucket — it renders unlinked, because one
unreviewed new beer must never stall the whole Monday sync.

Two known limits. Most staff sign in with personal addresses and the reference is gated on a
Google allow-list, so following a link needs an allow-listed account. And the calendar only
covers a rolling three months, so links disappear with the months that age out — that is the
window working, not a bug.

## Categories → sidebar section → colour

| `cat` | Legend label | Sidebar section | Colour |
|---|---|---|---|
| `core` | Standing Order | Releases this month | `#2D5BE3` |
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
