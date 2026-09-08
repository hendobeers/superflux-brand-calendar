// scripts/links.mjs
// One place owns calendar-name -> Brand Reference slug. Imported by the builder and the
// validator so the two can never disagree about what a name resolves to.
import { readFile } from "node:fs/promises";

/** Categories whose items can be a beer. Events and food never link. */
export const LINKABLE = new Set(["core", "exp", "fruit", "creamery", "collab", "release", "lto"]);

/** A slug that could reach /beer/<slug>. Anything else is refused, not sanitised. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Lookup key only — beer-links.json stays keyed on readable names so a person can review it.
 * Absorbs the drift tidyName() introduces ("EXP DIPA #1" vs "Exp. DIPA #1") without letting
 * the map itself become unreadable. Deliberately does NOT strip brand-family words: removing
 * "The Creamery" or "Heavy Fruit" is what makes wrong beers look like matches.
 */
export function canonKey(name) {
  return (name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")    // Mañana -> Manana
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")                     // drop apostrophes, straight and curly
    .replace(/^\$1\s+/, "").replace(/\s+lto$/, "")       // "$1 Easy Tiger LTO" -> "easy tiger"
    .replace(/\s*\([^)]*collab[^)]*\)\s*$/, "")          // "(Godspeed Collab)" is not identity
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Reads beer-links.json and returns { byKey, buckets, generated, problems }.
 * Structural problems are collected rather than thrown so the validator can report all of
 * them at once; the builder treats a non-empty list as fatal.
 */
export async function loadBeerLinks(path = "beer-links.json") {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const links = raw.links || {}, pending = raw.pending || {}, unlinked = raw.unlinked || {};
  const problems = [];
  const byKey = new Map();
  const seenIn = new Map();

  for (const [bucket, entries] of [["links", links], ["pending", pending], ["unlinked", unlinked]]) {
    for (const [name, value] of Object.entries(entries)) {
      const prior = seenIn.get(name);
      if (prior) problems.push(`"${name}" appears in both ${prior} and ${bucket}`);
      seenIn.set(name, bucket);

      if (bucket !== "unlinked" && !SLUG_RE.test(value))
        problems.push(`${bucket}: "${name}" -> ${JSON.stringify(value)} is not a valid slug`);

      const key = canonKey(name);
      if (!key) { problems.push(`${bucket}: "${name}" normalises to an empty key`); continue; }
      const clash = byKey.get(key);
      if (clash && clash.name !== name)
        problems.push(`"${name}" and "${clash.name}" both normalise to "${key}"`);
      // Only `links` yields a live slug. pending and unlinked resolve to null on purpose:
      // they are reviewed decisions not to link *yet*, distinct from never having looked.
      byKey.set(key, { name, bucket, slug: bucket === "links" ? value : null });
    }
  }
  return { byKey, buckets: { links, pending, unlinked }, generated: raw.generated || null, problems };
}
