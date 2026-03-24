# Google Sheets Sync Setup

## 1. Create the sheet

Create a Google Sheet and add a sheet named `Matches`.

Recommended columns:

```text
id
createdAt
date
players
player1
player2
game
gameKey
type
typeKey
score
extra
score1
score2
wins1
wins2
balls1
balls2
frameCount
durationSeconds
targetKind
targetValue
```

## 2. Create Apps Script

Open the sheet, then go to `Extensions -> Apps Script` and use this script:

```javascript
const SHEET_NAME = 'Matches';
const API_KEY = 'CHANGE_ME';

function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents || '{}');
    const record = request.record;
    const apiKey = request.apiKey || '';

    if (!record || typeof record !== 'object') {
      return jsonResponse({ ok: false, error: 'Invalid payload' });
    }

    if (API_KEY && apiKey !== API_KEY) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      return jsonResponse({ ok: false, error: 'Sheet not found' });
    }

    sheet.appendRow([
      record.id || '',
      record.createdAt || '',
      record.date || '',
      record.players || '',
      record.player1 || '',
      record.player2 || '',
      record.game || '',
      record.gameKey || '',
      record.type || '',
      record.typeKey || '',
      record.score || '',
      record.extra || '',
      record.score1 ?? '',
      record.score2 ?? '',
      record.wins1 ?? '',
      record.wins2 ?? '',
      record.balls1 ?? '',
      record.balls2 ?? '',
      record.frameCount ?? '',
      record.durationSeconds ?? '',
      record.targetKind || '',
      record.targetValue ?? ''
    ]);

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 3. Deploy

Deploy as `Web app`:

- Execute as: `Me`
- Who has access: `Anyone`

Copy the deployment URL.

## 4. Enable sync in the app

Open `/js/config.js` and update:

```javascript
export const GOOGLE_SHEETS_SYNC = {
  enabled: true,
  endpoint: 'YOUR_APPS_SCRIPT_WEB_APP_URL',
  apiKey: 'CHANGE_ME',
  requestTimeoutMs: 10000
};
```

## 5. How it works

- Every saved result is still written to `localStorage`
- The same record is added to a local sync queue
- When the app is online, it tries to send queued records to Google Sheets
- If the network request fails, the record stays in the queue and will be retried later
- The app sends JSON as `text/plain` to avoid browser CORS preflight with Apps Script
