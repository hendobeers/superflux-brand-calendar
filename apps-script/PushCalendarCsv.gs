// PushCalendarCsv.gs — lives in the "Superflux Events Calendar Submission (Responses)" sheet
// (Extensions -> Apps Script). Writes the form responses to data/events.csv in the calendar repo,
// which triggers the sync workflow and redeploys the site. Runs as the sheet owner inside the
// domain, so nothing has to be published or shared externally.
//
// Setup (once):
//   1. Paste this file into the sheet's Apps Script project.
//   2. Project Settings -> Script properties -> add GITHUB_TOKEN = a fine-grained token scoped to
//      hendobeers/superflux-brand-calendar with "Contents: Read and write" only.
//   3. Run installTriggers() and authorise when prompted.

const REPO = 'hendobeers/superflux-brand-calendar';
const PATH = 'data/events.csv';
const BRANCH = 'main';
const SHEET = 'Form Responses 1';

function pushCalendarCsv() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;             // another run is already pushing
  try {
    const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
    if (!token) throw new Error('GITHUB_TOKEN is not set (Project Settings -> Script properties).');

    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET);
    if (!sheet) throw new Error(`No tab named "${SHEET}".`);
    // Display values keep dates as the sheet shows them (M/D/YYYY), matching what the build script parses.
    const csv = sheet.getDataRange().getDisplayValues()
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n') + '\r\n';

    const api = `https://api.github.com/repos/${REPO}/contents/${PATH}`;
    const headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    let sha;
    const cur = UrlFetchApp.fetch(`${api}?ref=${BRANCH}`, { headers, muteHttpExceptions: true });
    if (cur.getResponseCode() === 200) {
      const body = JSON.parse(cur.getContentText());
      sha = body.sha;
      const existing = Utilities.newBlob(Utilities.base64Decode(body.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
      if (existing === csv) return heartbeat(headers); // nothing changed — no commit, no redeploy
    } else if (cur.getResponseCode() !== 404) {
      throw new Error(`GitHub read failed (${cur.getResponseCode()}): ${cur.getContentText()}`);
    }

    const stamp = Utilities.formatDate(new Date(), 'America/Vancouver', 'yyyy-MM-dd HH:mm');
    const res = UrlFetchApp.fetch(api, {
      method: 'put',
      headers,
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        message: `Update events from sheet ${stamp}`,
        content: Utilities.base64Encode(csv, Utilities.Charset.UTF_8),
        sha,
        branch: BRANCH,
      }),
    });
    if (res.getResponseCode() >= 300) {
      throw new Error(`GitHub write failed (${res.getResponseCode()}): ${res.getContentText()}`);
    }
    heartbeat(headers);
  } finally {
    lock.releaseLock();
  }
}

// Tells the repo the sheet and data/events.csv were confirmed in sync just now. The sync workflow
// fails if it goes 6 hours without one of these (or a data/events.csv commit), so a dead trigger,
// expired token or wrong sheet shows up as a red run instead of a calendar that quietly stops.
// Needs only the token's existing "Contents: Read and write".
function heartbeat(headers) {
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
    method: 'post',
    headers,
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ event_type: 'sheet-heartbeat' }),
  });
  if (res.getResponseCode() !== 204) {
    throw new Error(`GitHub heartbeat failed (${res.getResponseCode()}): ${res.getContentText()}`);
  }
}

function csvCell(v) {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// Pushes on every form submission, plus hourly to pick up hand edits to the sheet.
function installTriggers() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'pushCalendarCsv')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('pushCalendarCsv').forSpreadsheet(SpreadsheetApp.getActive()).onFormSubmit().create();
  ScriptApp.newTrigger('pushCalendarCsv').timeBased().everyHours(1).create();
  pushCalendarCsv();
}
