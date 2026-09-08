// scripts/validate-links.mjs
// Gate between building calendar-data.js and committing it.
// Posture: fail closed on wrongness, degrade gracefully on incompleteness. A malformed or
// contradictory map is a bug and stops the build. A beer nobody has reviewed yet is normal
// and must never freeze the Monday sync, or one new release would stall the whole calendar.
import { readFile } from "node:fs/promises";
import { LINKABLE, SLUG_RE, canonKey, loadBeerLinks } from "./links.mjs";

const DATA = process.env.CALENDAR_DATA_OUT || "calendar-data.js";
const WARN_DAYS = 45, FAIL_DAYS = 90;
const fatal = [], warn = [];

// --- the generated data still has to be the shape index.html expects ---
global.window = {};
const src = await readFile(DATA, "utf8");
new Function("window", src)(global.window);
const d = global.window.SFX_CALENDAR;
if (!d) fatal.push(`${DATA} did not define window.SFX_CALENDAR`);
else {
  if (!Array.isArray(d.months) || d.months.length !== 3) fatal.push(`months must be an array of 3, got ${d.months?.length}`);
  if (!Array.isArray(d.items)) fatal.push("items must be an array");
  if (!Array.isArray(d.recurring)) fatal.push("recurring must be an array");
}

// --- the map must be internally consistent ---
const links = await loadBeerLinks(process.env.BEER_LINKS || "beer-links.json");
fatal.push(...links.problems);

// --- staleness, measured from the map's own date and never from this run ---
if (!links.generated) warn.push("beer-links.json has no `generated` date — staleness cannot be judged");
else {
  const age = Math.floor((Date.now() - Date.parse(links.generated)) / 86400000);
  if (Number.isNaN(age)) fatal.push(`beer-links.json generated="${links.generated}" is not a date`);
  else if (age > FAIL_DAYS) fatal.push(`beer-links.json is ${age} days old (limit ${FAIL_DAYS}) — reconcile it against beers.json`);
  else if (age > WARN_DAYS) warn.push(`beer-links.json is ${age} days old — worth reconciling against beers.json`);
}

// --- every emitted slug must be one the map actually sanctions ---
const sanctioned = new Map([...links.byKey.values()].filter((v) => v.slug).map((v) => [v.slug, v.name]));
for (const it of [...(d?.items || []), ...(d?.recurring || [])]) {
  if (!it.slug) continue;
  if (!SLUG_RE.test(it.slug)) fatal.push(`"${it.name}" carries a malformed slug ${JSON.stringify(it.slug)}`);
  else if (!sanctioned.has(it.slug)) fatal.push(`"${it.name}" carries slug "${it.slug}" which is not in beer-links.json links`);
  if (!LINKABLE.has(it.cat)) fatal.push(`"${it.name}" is category "${it.cat}" and must never carry a slug`);
}

// --- incompleteness is expected, and is reported rather than enforced ---
const unreviewed = [...(d?.items || []), ...(d?.recurring || [])]
  .filter((it) => LINKABLE.has(it.cat) && !links.byKey.has(canonKey(it.name)))
  .map((it) => it.name);
for (const n of unreviewed) warn.push(`unreviewed: "${n}" is in no bucket — renders unlinked`);

for (const w of warn) console.warn(`warning: ${w}`);
if (fatal.length) {
  console.error(`\n${fatal.length} problem${fatal.length > 1 ? "s" : ""} — not shipping:`);
  for (const f of fatal) console.error(`  - ${f}`);
  process.exit(1);
}
const linked = (d?.items || []).concat(d?.recurring || []).filter((i) => i.slug).length;
console.log(`Validated ${DATA}: ${linked} linked, ${unreviewed.length} unreviewed, ${warn.length} warning(s)`);
