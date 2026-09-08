// scripts/build-calendar-data.mjs
// Reads the Superflux events form-responses sheet (published-to-web CSV) and writes calendar-data.js.
// Usage: CALENDAR_SHEET_CSV_URL=<url or local path> node scripts/build-calendar-data.mjs
import { readFile, writeFile } from "node:fs/promises";
import { LINKABLE, SLUG_RE, canonKey, loadBeerLinks } from "./links.mjs";

const SRC = process.env.CALENDAR_SHEET_CSV_URL;
if (!SRC) { console.error("CALENDAR_SHEET_CSV_URL not set"); process.exit(1); }
const OUT = process.env.CALENDAR_DATA_OUT || "calendar-data.js";
const TZ = "America/Vancouver";

const CATEGORIES = [
  ["core", "Core release"], ["exp", "Experimental"], ["fruit", "Heavy Fruit"],
  ["creamery", "The Creamery"], ["collab", "Collab"], ["release", "New release"],
  ["lto", "Wholesale $1 LTO"], ["event", "Event"], ["burger", "Food"], ["food", "Food"],
];
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

// ---------- CSV ----------
function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, "0");
function parseDate(s) {                       // "M/D/YYYY" or "YYYY-MM-DD" -> "YYYY-MM-DD"
  s = (s || "").trim(); if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  console.warn(`Unparseable date: ${s}`); return null;
}
function tidyName(raw) {
  let n = raw.replace(/\s+/g, " ").trim();
  if (/[A-Z]/.test(n) && n === n.toUpperCase())      // all-caps -> Title Case
    n = n.toLowerCase().replace(/(^|[\s(\-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  n = n.replace(/^EXP\b\.?/, "Exp.");
  return n;
}
function categorise(name, type) {
  const n = name.toLowerCase(), t = (type || "").toLowerCase();
  if (/heavy fruit/.test(n)) return "fruit";
  if (t.startsWith("lto")) return "lto";
  if (t.startsWith("feature")) return /burger/.test(n) ? "burger" : "food";
  if (t.includes("beer")) {
    if (/collab|smoke em if you go em/.test(n)) return "collab";
    if (/creamery/.test(n)) return "creamery";
    if (/\bexp(\b|\.)|experimental/.test(n)) return "exp";
    if (t.includes("wholesale")) return "core";
    return "release";
  }
  return "event";                              // Party C, Off-Site Event, Other, External Promotion
}
function parseRule(s) {                        // -> array of weekdays (0=Sun) or null
  s = (s || "").trim().toLowerCase();
  if (!s.startsWith("every")) return null;
  if (/every day|daily/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set();
  for (const [name, wd] of Object.entries(WEEKDAYS)) if (s.includes(name)) days.add(wd);
  if (s.includes("weekend")) { days.add(0); days.add(6); }
  if (s.includes("weekday") && !days.size) [1, 2, 3, 4, 5].forEach((d) => days.add(d));
  if (/\b(first|second|third|fourth|last)\b/.test(s)) { console.warn(`Nth-weekday rule not supported, skipped: "${s}"`); return null; }
  return days.size ? [...days].sort() : null;  // "Every Month Of August" etc. -> one-off/range
}

// ---------- window: current month + 2 (Vancouver time) ----------
const now = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
const months = [];
for (let i = 0; i < 3; i++) {
  const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
  months.push({ id: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
                label: d.toLocaleString("en-US", { month: "long", year: "numeric" }) });
}
const winStart = `${months[0].id}-01`;
const lastM = new Date(now.getFullYear(), now.getMonth() + 3, 0);
const winEnd = `${lastM.getFullYear()}-${pad(lastM.getMonth() + 1)}-${pad(lastM.getDate())}`;

// ---------- read + build ----------
const csv = SRC.startsWith("http") ? await (await fetch(SRC)).text() : await readFile(SRC, "utf8");
const rows = parseCSV(csv).filter((r) => r.length >= 5 && r.some((c) => c.trim()));
if (rows[0] && /timestamp/i.test(rows[0][0])) rows.shift();

const items = [], recurring = [], seen = new Set();
for (const r of rows) {
  const [, rawName, rawStart, rawEnd, type, rule] = r;
  const name = tidyName(rawName || ""); if (!name) continue;
  const start = parseDate(rawStart); if (!start) continue;
  let end = parseDate(rawEnd) || start;
  if (end < start) [end] = [start];
  const cat = categorise(name, type);
  const weekdays = parseRule(rule);

  if (weekdays) {
    if (start > winEnd || (end !== start && end < winStart)) continue;
    const key = `R|${name.toLowerCase()}|${weekdays.join()}`;
    if (!seen.has(key)) { seen.add(key); recurring.push({ name, cat, weekdays }); }
    continue;
  }
  if (end > start) {
    if (start > winEnd || end < winStart) continue;
    const key = `S|${name.toLowerCase()}|${start}|${end}`;
    if (!seen.has(key)) { seen.add(key); items.push({ name, cat, start, end }); }
  } else {
    if (start < winStart || start > winEnd) continue;
    const key = `D|${name.toLowerCase()}|${start}`;
    if (!seen.has(key)) { seen.add(key); items.push({ name, cat, date: start }); }
  }
}
items.sort((a, b) => (a.date || a.start).localeCompare(b.date || b.start) || a.name.localeCompare(b.name));

// ---------- link items to the Brand Reference ----------
// A slug is only ever read from the reviewed map. Nothing here derives one from a name:
// the names and the slugs do not correspond, and a wrong link shows the wrong allergens.
const beerLinks = await loadBeerLinks(process.env.BEER_LINKS || "beer-links.json");
if (beerLinks.problems.length) {
  console.error("beer-links.json is not usable:");
  for (const p of beerLinks.problems) console.error(`  - ${p}`);
  process.exit(1);
}
const linkReport = { linked: 0, pending: [], unreviewed: [] };
function attachSlug(item) {
  if (!LINKABLE.has(item.cat)) return;            // events and food are not beers
  const hit = beerLinks.byKey.get(canonKey(item.name));
  if (!hit) { linkReport.unreviewed.push(item.name); return; }
  if (hit.bucket === "pending") { linkReport.pending.push(item.name); return; }
  if (hit.slug && SLUG_RE.test(hit.slug)) { item.slug = hit.slug; linkReport.linked++; }
}
for (const it of [...items, ...recurring]) attachSlug(it);
const usedKeys = new Set([...items, ...recurring].map((i) => canonKey(i.name)));
const unused = [...beerLinks.byKey.values()].filter((v) => !usedKeys.has(canonKey(v.name)));
for (const n of linkReport.unreviewed) console.warn(`No entry in beer-links.json: "${n}" — renders unlinked`);

const used = new Set([...items, ...recurring].map((i) => i.cat));
const categories = CATEGORIES.filter(([id]) => used.has(id)).map(([id, label]) => ({ id, label }));

const j = (o) => JSON.stringify(o).replace(/","/g, '", "').replace(/":"/g, '": "').replace(/":(\d|\[)/g, '": $1').replace(/,"/g, ', "').replace(/^\{/, "{ ").replace(/\}$/, " }");
const out = `// Generated by scripts/build-calendar-data.mjs from the events form responses. Do not edit by hand.
window.SFX_CALENDAR = {
  months: [
${months.map((m) => "    " + j(m)).join(",\n")}
  ],
  categories: [
${categories.map((c) => "    " + j(c)).join(",\n")}
  ],
  items: [
${items.map((i) => "    " + j(i)).join(",\n")}
  ],
  recurring: [
${recurring.map((r) => "    " + j(r)).join(",\n")}
  ]
};
`;
await writeFile(OUT, out);
console.log(`Wrote ${OUT}: ${months[0].id}..${months[2].id}, ${items.length} items, ${recurring.length} recurring`);
console.log(`Links: ${linkReport.linked} linked, ${linkReport.pending.length} pending, ${linkReport.unreviewed.length} unreviewed${unused.length ? `, ${unused.length} map entries unused this window` : ""}`);
