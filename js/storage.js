const STATS_STORAGE_KEY = 'billiards-statistics-v1';
const SESSION_STORAGE_KEY = 'billiards-current-session-v1';

export function loadStatistics() {
  try {
    const raw = localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Ошибка чтения статистики из localStorage:', error);
    return [];
  }
}

export function saveStatistics(statistics) {
  try {
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(statistics));
  } catch (error) {
    console.error('Ошибка записи статистики в localStorage:', error);
  }
}

export function clearStatisticsStorage() {
  try {
    localStorage.removeItem(STATS_STORAGE_KEY);
  } catch (error) {
    console.error('Ошибка очистки статистики в localStorage:', error);
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.error('Ошибка чтения сессии из localStorage:', error);
    return null;
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.error('Ошибка записи сессии в localStorage:', error);
  }
}

export function clearSessionStorage() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    console.error('Ошибка очистки сессии в localStorage:', error);
  }
}