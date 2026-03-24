import { GOOGLE_SHEETS_SYNC } from './config.js';
import { loadStatisticsSyncQueue, saveStatisticsSyncQueue } from './storage.js';

function hasSyncEndpoint() {
  return Boolean(GOOGLE_SHEETS_SYNC.enabled && GOOGLE_SHEETS_SYNC.endpoint);
}

function buildHeaders() {
  return {
    'Content-Type': 'text/plain;charset=utf-8'
  };
}

export function enqueueStatisticsSync(entry) {
  const queue = loadStatisticsSyncQueue();
  if (queue.some((item) => item.id === entry.id)) return;

  queue.push(entry);
  saveStatisticsSyncQueue(queue);
}

export async function syncPendingStatistics() {
  if (!hasSyncEndpoint() || !navigator.onLine) {
    return { syncedCount: 0, pendingCount: loadStatisticsSyncQueue().length, skipped: true };
  }

  const queue = loadStatisticsSyncQueue();
  if (!queue.length) {
    return { syncedCount: 0, pendingCount: 0, skipped: false };
  }

  const remaining = [];
  let syncedCount = 0;

  for (const entry of queue) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), GOOGLE_SHEETS_SYNC.requestTimeoutMs);

    try {
      const response = await fetch(GOOGLE_SHEETS_SYNC.endpoint, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          apiKey: GOOGLE_SHEETS_SYNC.apiKey,
          record: entry
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      const responseText = await response.text();
      if (responseText) {
        const payload = JSON.parse(responseText);
        if (payload && payload.ok === false) {
          throw new Error(payload.error || 'Sync failed');
        }
      }

      syncedCount += 1;
    } catch (error) {
      console.error('Ошибка синхронизации статистики с Google Sheets:', error);
      remaining.push(entry);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  saveStatisticsSyncQueue(remaining);

  return {
    syncedCount,
    pendingCount: remaining.length,
    skipped: false
  };
}
