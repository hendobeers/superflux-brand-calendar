# Superflux Brand Calendar — static site

A single static page that renders the brand calendar from `calendar-data.js`. Deploy once; the weekly Cowork task only ever rewrites `calendar-data.js`.

## Files

- `index.html` — the page. No build step, no dependencies. Do not edit for content changes.
- `calendar-data.js` — the only file the weekly job rewrites. Generated; do not edit by hand.
- `scripts/build-calendar-data.mjs` — builds `calendar-data.js` from the events sheet.
- `scripts/links.mjs` — owns calendar-name → Brand Reference slug lookup.
- `scripts/validate-links.mjs` — the gate the workflow runs before committing.
- `beer-links.json` — the reviewed name → slug map. Edited by a person, never generated.
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

`calendar-data.js` is **generated** — do not edit it by hand. `scripts/build-calendar-data.mjs`
reads the published-to-web CSV of the events form-responses sheet and writes the file. The
`sync-calendar-data` workflow runs it Mondays at 09:30 UTC (~02:30 Vancouver), on manual dispatch,
and whenever the script itself changes; it commits `calendar-data.js` only when the contents differ,
and the push redeploys the site.

The sheet URL lives in the repository variable `CALENDAR_SHEET_CSV_URL` (Settings -> Secrets and
variables -> Actions -> Variables). No secrets are involved; the workflow uses `GITHUB_TOKEN` only.

To run it by hand:

```bash
gh workflow run sync-calendar-data.yml          # via Actions
CALENDAR_SHEET_CSV_URL="<url>" node scripts/build-calendar-data.mjs   # locally
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
