#!/usr/bin/env node
// Monday brand calendar check. Read-only: fetches data, runs the preconditions,
// diffs the week, and prints a JSON decision. It never sends email itself.
// Usage: node scripts/monday-check.mjs [--now 2026-10-05T06:00:00-07:00]
import vm from "node:vm";

const REPO = "hendobeers/superflux-brand-calendar";
const SITE = "https://superflux-brand-calendar.vercel.app";
const TZ = "America/Vancouver";
const ADAM = "adam@superfluxbeer.com";
const MARK = "mark@superfluxbeer.com";
const STALE_HOURS = 48;

const nowArg = process.argv.indexOf("--now");
const NOW = nowArg > -1 ? new Date(process.argv[nowArg + 1]) : new Date();

// ---------- time helpers (all date math in America/Vancouver) ----------
function vanParts(d) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  return p;
}
// UTC instant for a Vancouver wall-clock time (handles DST).
function vanToUtc(y, m, d, hh = 0, mm = 0) {
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 3; i++) {
    const p = vanParts(new Date(guess));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    guess += Date.UTC(y, m - 1, d, hh, mm) - asUtc;
  }
  return new Date(guess);
}
const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function addDays(ymd, n) {
  const t = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${MON[m - 1]} ${d}`; };
const fmtWhen = (it) => it.date ? fmtDay(it.date) : `${fmtDay(it.start)} – ${fmtDay(it.end)}`;
const lastDay = (it) => it.date || it.end;
const firstDay = (it) => it.date || it.start;
const DAYNAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function fmtRecurring(r) {
  const days = (r.weekdays || []).map((w) => DAYNAMES[w]);
  if (!days.length) return "recurring";
  return "Every " + (days.length === 1 ? days[0] : days.slice(0, -1).join(", ") + " and " + days.at(-1));
}

// ---------- fetch helpers ----------
async function get(url, { json = false, tries = 3 } = {}) {
  const headers = { "User-Agent": "sfx-brand-calendar-monday-check" };
  if (url.includes("api.github.com") && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers, cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
      return json ? await r.json() : await r.text();
    } catch (e) { lastErr = e; await new Promise((s) => setTimeout(s, 1500 * (i + 1))); }
  }
  throw lastErr;
}
function evalCalendar(src) {
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox, { timeout: 2000 });
  const c = sandbox.window.SFX_CALENDAR;
  if (!c || typeof c !== "object") throw new Error("window.SFX_CALENDAR not defined");
  return { months: c.months || [], categories: c.categories || [], items: c.items || [], recurring: c.recurring || [] };
}
async function lastCommit(path, until) {
  const q = `https://api.github.com/repos/${REPO}/commits?path=${encodeURIComponent(path)}&per_page=1${until ? `&until=${until}` : ""}`;
  const arr = await get(q, { json: true });
  return arr.length ? { sha: arr[0].sha, date: arr[0].commit.committer.date } : null;
}

// ---------- diff ----------
function diff(before, after) {
  const catLabel = Object.fromEntries(after.categories.map((c) => [c.id, c.label]));
  const lines = [], notes = [];
  const windowStart = after.months[0]?.id + "-01";
  const windowRolled = before.months.length > 0 && before.months[0]?.id !== after.months[0]?.id;

  const index = (arr, label) => {
    const m = new Map();
    for (const it of arr) {
      if (m.has(it.name)) notes.push(`Duplicate ${label} name "${it.name}" — only the first is compared.`);
      else m.set(it.name, it);
    }
    return m;
  };
  const B = index(before.items, "item"), A = index(after.items, "item");
  let removed = [...B.values()].filter((it) => !A.has(it.name));
  let added = [...A.values()].filter((it) => !B.has(it.name));

  // Past events scrolling off the window are not removals.
  const scrolledOff = removed.filter((it) => lastDay(it) < windowStart);
  removed = removed.filter((it) => lastDay(it) >= windowStart);

  // Renames: removal + addition with the same date/range and category → one line.
  const renamed = [];
  for (const r of [...removed]) {
    const a = added.find((x) => x.cat === r.cat && (x.date || "") === (r.date || "") && (x.start || "") === (r.start || "") && (x.end || "") === (r.end || ""));
    if (a) {
      renamed.push([r, a]);
      removed = removed.filter((x) => x !== r);
      added = added.filter((x) => x !== a);
    }
  }

  // Items new to the view only because a new month entered the window.
  const newMonths = after.months.filter((m) => !before.months.some((b) => b.id === m.id)).map((m) => m.id);
  const enteredWithWindow = windowRolled ? added.filter((it) => newMonths.includes(firstDay(it).slice(0, 7))) : [];
  if (enteredWithWindow.length) notes.push(`Reported as added but sit in the newly displayed month (${newMonths.join(", ")}): ${enteredWithWindow.map((i) => i.name).join("; ")}.`);

  for (const it of added) lines.push(`${it.name} (${fmtWhen(it)}) — added`);
  for (const it of A.values()) {
    const b = B.get(it.name);
    if (!b) continue;
    if (fmtWhen(b) !== fmtWhen(it)) lines.push(`${it.name} — moved from ${fmtWhen(b)} to ${fmtWhen(it)}`);
  }
  for (const it of removed) lines.push(`${it.name} (${fmtWhen(it)}) — removed`);
  for (const [o, n] of renamed) lines.push(`${o.name} — renamed to ${n.name} (${fmtWhen(n)})`);
  for (const it of A.values()) {
    const b = B.get(it.name);
    if (b && b.cat !== it.cat) lines.push(`${it.name} — now shows as ${catLabel[it.cat] || it.cat}`);
  }

  // Recurring.
  const RB = index(before.recurring, "recurring"), RA = index(after.recurring, "recurring");
  for (const r of RA.values()) {
    const b = RB.get(r.name);
    if (!b) lines.push(`${r.name} (${fmtRecurring(r)}) — added`);
    else {
      if (fmtRecurring(b) !== fmtRecurring(r)) lines.push(`${r.name} — now ${fmtRecurring(r)}`);
      if (b.cat !== r.cat) lines.push(`${r.name} — now shows as ${catLabel[r.cat] || r.cat}`);
    }
  }
  for (const r of RB.values()) if (!RA.has(r.name)) lines.push(`${r.name} (${fmtRecurring(r)}) — removed`);

  // Legend.
  const CB = new Map(before.categories.map((c) => [c.id, c.label]));
  for (const c of after.categories) {
    if (CB.has(c.id) && CB.get(c.id) !== c.label) lines.push(`Legend: ${CB.get(c.id)} is now ${c.label}`);
    else if (!CB.has(c.id) && before.categories.length) notes.push(`Legend category added: ${c.label} (not reported to Mark).`);
  }
  for (const [id, label] of CB) if (!after.categories.some((c) => c.id === id)) notes.push(`Legend category removed: ${label} (not reported to Mark).`);

  return {
    lines, notes, windowRolled,
    windowRoll: windowRolled ? { from: before.months.map((m) => m.label), to: after.months.map((m) => m.label), scrolledOff: scrolledOff.map((it) => `${it.name} (${fmtWhen(it)})`) } : null,
  };
}

// ---------- main ----------
const out = { now: NOW.toISOString(), checks: {}, problems: [] };
const p = vanParts(NOW);
const today = { y: +p.year, m: +p.month, d: +p.day };
const weekOf = addDays(today, -DOW[p.weekday]); // most recent Monday on/before today
const prevMon = addDays(weekOf, -7);
const windowStartUtc = vanToUtc(prevMon.y, prevMon.m, prevMon.d, 6, 0).toISOString().replace(/\.\d{3}Z$/, "Z");
const weekOfIso = `${weekOf.y}-${String(weekOf.m).padStart(2, "0")}-${String(weekOf.d).padStart(2, "0")}`;
out.weekOf = fmtDay(weekOfIso);
out.windowStartUtc = windowStartUtc;

// c. LOAD CHECK
let after = null;
try {
  const html = await get(`${SITE}/?cb=${Date.now()}`);
  if (!/calendar-data\.js/.test(html)) throw new Error("live page does not reference calendar-data.js");
  after = evalCalendar(await get(`${SITE}/calendar-data.js?cb=${Date.now()}`));
  const ok = after.months.length === 3 && after.items.length > 0;
  out.checks.load = { pass: ok, months: after.months.map((m) => m.label), items: after.items.length, recurring: after.recurring.length };
  if (!ok) throw new Error(`live data has ${after.months.length} month(s) and ${after.items.length} item(s); expected 3 months and a non-empty items array`);
} catch (e) {
  out.checks.load = { ...(out.checks.load || {}), pass: false, error: String(e.message || e) };
  out.decision = {
    to: ADAM, subject: "Brand calendar site check failed",
    body: `Didn't email Mark this week.\n\nThe live calendar at ${SITE} failed the load check: ${out.checks.load.error}\n\nRun time: ${NOW.toISOString()}`,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// a. FRESHNESS
try {
  const csv = await lastCommit("data/events.csv");
  const js = await lastCommit("calendar-data.js");
  const wfs = await get(`https://api.github.com/repos/${REPO}/actions/workflows`, { json: true });
  const wf = wfs.workflows.find((w) => w.name === "Sync calendar data");
  if (!wf) throw new Error('no workflow named "Sync calendar data"');
  const runs = await get(`https://api.github.com/repos/${REPO}/actions/workflows/${wf.id}/runs?per_page=1`, { json: true });
  const run = runs.workflow_runs[0];
  const csvAgeH = csv ? (NOW - new Date(csv.date)) / 36e5 : Infinity;
  const stale = csvAgeH > STALE_HOURS && run?.conclusion === "success";
  const failing = run && run.status === "completed" && run.conclusion !== "success";
  out.checks.freshness = {
    pass: !stale && !failing,
    eventsCsvLastCommit: csv?.date || "never", calendarDataJsLastCommit: js?.date || "never",
    eventsCsvAgeHours: Math.round(csvAgeH),
    latestSyncRun: run ? { conclusion: run.conclusion, status: run.status, at: run.created_at, url: run.html_url } : null,
    workflowState: wf.state,
  };
  if (stale) out.problems.push({ kind: "stale", text: `data/events.csv hasn't changed in ${Math.round(csvAgeH)}h while the hourly "Sync calendar data" workflow keeps reporting success.` });
  if (failing) out.problems.push({ kind: "sync_failing", text: `The latest "Sync calendar data" run concluded "${run.conclusion}".` });
} catch (e) {
  out.checks.freshness = { pass: false, error: String(e.message || e) };
  out.problems.push({ kind: "check_error", text: `Couldn't verify sync freshness: ${e.message || e}` });
}

// b. EMPTY MONTH (one-off items only; recurring entries don't count)
const counts = after.months.map((m) => {
  const s = m.id + "-01", e = m.id + "-31";
  return { month: m.label, items: after.items.filter((it) => firstDay(it) <= e && lastDay(it) >= s).length };
});
const empty = counts.filter((c) => c.items === 0);
out.checks.emptyMonth = { pass: empty.length === 0, counts };
if (empty.length) out.problems.push({ kind: "empty_month", text: `${empty.map((c) => c.month).join(", ")} has no items. Item counts per month: ${counts.map((c) => `${c.month} ${c.items}`).join(", ")}. Recurring entries: ${after.recurring.map((r) => `${r.name} (${fmtRecurring(r)})`).join(", ") || "none"}.` });

// Before-state + diff
try {
  const c = await lastCommit("calendar-data.js", windowStartUtc);
  const before = c ? evalCalendar(await get(`https://raw.githubusercontent.com/${REPO}/${c.sha}/calendar-data.js`)) : { months: [], categories: [], items: [], recurring: [] };
  out.beforeState = c ? { sha: c.sha, committed: c.date } : "none (no version before window start)";
  out.diff = diff(before, after);
  out.checks.windowRoll = out.diff.windowRoll ? { rolled: true, ...out.diff.windowRoll } : { rolled: false };
} catch (e) {
  out.problems.push({ kind: "check_error", text: `Couldn't build the before-state diff: ${e.message || e}` });
}

// Decision — exactly one email.
if (out.problems.length) {
  const f = out.checks.freshness || {};
  const subject = out.problems.some((p) => p.kind === "stale" || p.kind === "sync_failing")
    ? "Brand calendar sync looks stale"
    : out.problems.some((p) => p.kind === "empty_month") ? "Brand calendar has an empty month" : "Brand calendar site check failed";
  out.decision = {
    to: ADAM, subject,
    body: [
      "Didn't email Mark this week.", "",
      ...out.problems.map((p) => `- ${p.text}`), "",
      `data/events.csv last commit: ${f.eventsCsvLastCommit ?? "unknown"}`,
      `calendar-data.js last commit: ${f.calendarDataJsLastCommit ?? "unknown"}`,
      `Latest "Sync calendar data" run: ${f.latestSyncRun ? `${f.latestSyncRun.conclusion} at ${f.latestSyncRun.at} (${f.latestSyncRun.url})` : "unknown"}`,
    ].join("\n"),
  };
} else {
  const block = out.diff.lines.length
    ? ["Changed since last Monday:", ...out.diff.lines.map((l) => `- ${l}`)].join("\n")
    : "Nothing's changed since last week.";
  out.decision = {
    to: MARK, subject: `Brand calendar — week of ${out.weekOf}`,
    body: `Hey Mark,\n\nBrand calendar for the week: ${SITE}\n\n${block}\n\nGo ahead and post the link in Slack. If anything's off, reply here before you do and I'll sort the sheet.\n\nThanks,\nAdam`,
  };
}
console.log(JSON.stringify(out, null, 2));
