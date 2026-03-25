import { GOOGLE_SHEETS_SYNC } from './config.js';

function ensureStatsEndpoint() {
  if (!GOOGLE_SHEETS_SYNC.enabled || !GOOGLE_SHEETS_SYNC.endpoint) {
    throw new Error('Статистика Google Sheets не подключена.');
  }
}

async function requestStatsAction(action, payload = {}) {
  ensureStatsEndpoint();

  const response = await fetch(GOOGLE_SHEETS_SYNC.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({
      apiKey: GOOGLE_SHEETS_SYNC.apiKey,
      action,
      ...payload
    })
  });

  if (!response.ok) {
    throw new Error('HTTP ' + response.status);
  }

  const responseText = await response.text();
  const data = responseText ? JSON.parse(responseText) : {};

  if (data && data.ok === false) {
    throw new Error(data.error || 'Не удалось получить данные статистики.');
  }

  return data;
}

export async function upsertPlayers(names) {
  const preparedNames = Array.from(
    new Set(
      names
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter(Boolean)
    )
  );

  if (!preparedNames.length) return { ok: true, created: 0 };

  return requestStatsAction('upsertPlayers', { names: preparedNames });
}

export async function findPlayerByName(name) {
  const preparedName = typeof name === 'string' ? name.trim() : '';
  if (!preparedName) return { ok: true, exists: false };

  return requestStatsAction('findPlayer', { name: preparedName });
}

export async function getPlayers() {
  return requestStatsAction('getPlayers');
}

export async function getMatchStats(filters) {
  return requestStatsAction('getMatchStats', { filters });
}
