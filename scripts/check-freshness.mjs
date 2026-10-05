// scripts/check-freshness.mjs
// Fails when the sheet hasn't confirmed data/events.csv recently. The Apps Script only commits
// when the responses change, so a quiet sheet would look stale by commit age alone; it also sends
// a `sheet-heartbeat` repository_dispatch on every successful run. Fresh = the newer of the last
// data/events.csv commit and the last heartbeat run is within MAX_HOURS.
// Needs GH_TOKEN (actions: read) and GITHUB_REPOSITORY, both set in the workflow.
import { execFileSync } from "node:child_process";

const MAX_HOURS = Number(process.env.FRESHNESS_MAX_HOURS || 6);   // script runs hourly; 6 missed runs = broken
const repo = process.env.GITHUB_REPOSITORY || "hendobeers/superflux-brand-calendar";
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();

const lastCommit = gh("api", `repos/${repo}/commits?path=data/events.csv&per_page=1`, "--jq", ".[0].commit.committer.date");
const lastBeat = gh("run", "list", "--repo", repo, "--workflow", "sync-calendar-data.yml",
  "--event", "repository_dispatch", "--limit", "1", "--json", "createdAt", "--jq", ".[0].createdAt // empty");

const seen = [lastCommit, lastBeat].filter(Boolean).map(Date.parse).filter((t) => !Number.isNaN(t));
if (!seen.length) {
  console.error("Could not find any data/events.csv commit or sheet heartbeat.");
  process.exit(1);
}
const hours = (Date.now() - Math.max(...seen)) / 3600000;
console.log(`data/events.csv last commit: ${lastCommit || "none"}; last sheet heartbeat: ${lastBeat || "none"}`);
if (hours > MAX_HOURS) {
  console.error(`::error::The sheet hasn't confirmed data/events.csv in ${hours.toFixed(1)} hours (limit ${MAX_HOURS}). ` +
    "The Apps Script push is not running: check Executions and Triggers in the sheet's Apps Script project.");
  process.exit(1);
}
console.log(`Fresh: confirmed ${hours.toFixed(1)} hours ago (limit ${MAX_HOURS}).`);
