# Google Sheets Stats API

This version extends the existing Apps Script so the app can:

- append matches
- upsert players into the `Players` sheet
- find a player by name
- return the full players list
- return filtered match statistics

## Sheets

Required sheets:

- `Matches`
- `Players`

Required headers:

`Matches`

```text
id | createdAt | date | players | player1 | player2 | game | gameKey | type | typeKey | score | extra | score1 | score2 | wins1 | wins2 | balls1 | balls2 | frameCount | durationSeconds | partyResultsJson | targetKind | targetValue
```

`Players`

```text
name | createdAt
```

## Apps Script

Replace the current `Code.gs` with:

```javascript
const MATCHES_SHEET = 'Matches';
const PLAYERS_SHEET = 'Players';
const API_KEY = 'billiard-stats-2026';

function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents || '{}');
    const apiKey = request.apiKey || '';

    if (API_KEY && apiKey !== API_KEY) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }

    const action = request.action || 'appendMatch';

    if (action === 'appendMatch') {
      return appendMatchAction(request.record);
    }

    if (action === 'upsertPlayers') {
      return upsertPlayersAction(request.names || []);
    }

    if (action === 'findPlayer') {
      return findPlayerAction(request.name || '');
    }

    if (action === 'getPlayers') {
      return getPlayersAction();
    }

    if (action === 'getMatchStats') {
      return getMatchStatsAction(request.filters || {});
    }

    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  }
}

function appendMatchAction(record) {
  if (!record || typeof record !== 'object') {
    return jsonResponse({ ok: false, error: 'Invalid payload' });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MATCHES_SHEET);
  if (!sheet) {
    return jsonResponse({ ok: false, error: 'Sheet not found' });
  }

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    if (ids.includes(record.id)) {
      return jsonResponse({ ok: true, duplicate: true });
    }
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
    record.partyResultsJson || '',
    record.targetKind || '',
    record.targetValue ?? ''
  ]);

  return jsonResponse({ ok: true });
}

function upsertPlayersAction(names) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PLAYERS_SHEET);
  if (!sheet) {
    return jsonResponse({ ok: false, error: 'Players sheet not found' });
  }

  const preparedNames = [...new Set(
    (Array.isArray(names) ? names : [])
      .map(name => String(name || '').trim())
      .filter(Boolean)
  )];

  if (!preparedNames.length) {
    return jsonResponse({ ok: true, created: 0 });
  }

  const lastRow = sheet.getLastRow();
  const existingNames = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(normalizeName)
    : [];

  let created = 0;
  preparedNames.forEach((name) => {
    if (existingNames.includes(normalizeName(name))) return;
    sheet.appendRow([name, new Date().toISOString()]);
    existingNames.push(normalizeName(name));
    created += 1;
  });

  return jsonResponse({ ok: true, created: created });
}

function findPlayerAction(name) {
  const preparedName = String(name || '').trim();
  if (!preparedName) {
    return jsonResponse({ ok: true, exists: false });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PLAYERS_SHEET);
  if (!sheet) {
    return jsonResponse({ ok: false, error: 'Players sheet not found' });
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return jsonResponse({ ok: true, exists: false });
  }

  const names = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const normalizedQuery = normalizeName(preparedName);
  const found = names.find((value) => normalizeName(value) === normalizedQuery);

  return jsonResponse({
    ok: true,
    exists: Boolean(found),
    name: found || ''
  });
}

function getPlayersAction() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PLAYERS_SHEET);
  if (!sheet) {
    return jsonResponse({ ok: false, error: 'Players sheet not found' });
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return jsonResponse({ ok: true, players: [] });
  }

  const players = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().filter(Boolean);
  return jsonResponse({ ok: true, players: players });
}

function getMatchStatsAction(filters) {
  const player1 = String(filters.player1 || '').trim();
  const player2 = String(filters.player2 || '').trim();
  const period = String(filters.period || '3m');

  if (!player1) {
    return jsonResponse({ ok: false, error: 'Player 1 is required' });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MATCHES_SHEET);
  if (!sheet) {
    return jsonResponse({ ok: false, error: 'Matches sheet not found' });
  }

  const rows = getSheetObjects(sheet);
  const normalizedPlayer1 = normalizeName(player1);
  const normalizedPlayer2 = normalizeName(player2);

  let filtered = rows.filter((row) => {
    const left = normalizeName(row.player1);
    const right = normalizeName(row.player2);

    if (normalizedPlayer2) {
      return (
        (left === normalizedPlayer1 && right === normalizedPlayer2) ||
        (left === normalizedPlayer2 && right === normalizedPlayer1)
      );
    }

    return left === normalizedPlayer1 || right === normalizedPlayer1;
  });

  filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  if (filtered.length && period !== 'all') {
    const latestDate = new Date(filtered[0].createdAt || filtered[0].date);
    const periodStart = new Date(latestDate);

    if (period === '1m') {
      periodStart.setMonth(periodStart.getMonth() - 1);
    } else {
      periodStart.setMonth(periodStart.getMonth() - 3);
    }

    filtered = filtered.filter((row) => new Date(row.createdAt || row.date) >= periodStart);
  }

  const matches = filtered.map((row) => {
    const isPrimaryLeft = normalizeName(row.player1) === normalizedPlayer1;
    const leftName = isPrimaryLeft ? row.player1 : row.player2;
    const rightName = isPrimaryLeft ? row.player2 : row.player1;

    return {
      id: row.id,
      date: row.date,
      players: leftName + ' vs ' + rightName,
      player1: leftName,
      player2: rightName,
      game: row.game,
      type: row.type,
      score: row.score,
      extra: row.extra,
      score1: toNumber(row.score1),
      score2: toNumber(row.score2),
      wins1: isPrimaryLeft ? toNumber(row.wins1) : toNumber(row.wins2),
      wins2: isPrimaryLeft ? toNumber(row.wins2) : toNumber(row.wins1),
      balls1: isPrimaryLeft ? toNumber(row.balls1) : toNumber(row.balls2),
      balls2: isPrimaryLeft ? toNumber(row.balls2) : toNumber(row.balls1),
      frameCount: toNumber(row.frameCount),
      durationSeconds: toNumber(row.durationSeconds),
      partyResultsJson: row.partyResultsJson || ''
    };
  });

  return jsonResponse({
    ok: true,
    metaText: 'Найдено матчей: ' + matches.length,
    matches: matches
  });
}

function getSheetObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  return values.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index];
    });
    return item;
  });
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function toNumber(value) {
  return Number(value || 0);
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Redeploy

After replacing the script:

1. Save the Apps Script project
2. Open `Развернуть -> Управление развертываниями`
3. Edit the current web app
4. Create a new version
5. Redeploy
