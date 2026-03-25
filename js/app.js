import { DEFAULT_REPEAT_STATE, GAME_OPTIONS, TYPE_LABELS } from './config.js';
import { state } from './state.js';
import { refs } from './dom.js';
import {
  formatTime,
  showToast,
  openConfirmModal,
  closeConfirmModal,
  runModalConfirm,
  getStatisticsLatestText
} from './utils.js';
import {
  loadStatistics,
  saveStatistics,
  clearStatisticsStorage,
  loadSession,
  saveSession,
  clearSessionStorage
} from './storage.js';
import { enqueueStatisticsSync, syncPendingStatistics } from './sync.js';
import { findPlayerByName, getMatchStats, upsertPlayers } from './stats-api.js';

const lookupDebounceTimers = {};
const lookupRequestIds = {};

function clearTimerInterval() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function clearFieldErrors() {
  refs.playersError.textContent = '';
  refs.gameError.textContent = '';
  refs.typeError.textContent = '';
  refs.frameTargetError.textContent = '';
  refs.timeTargetError.textContent = '';
  refs.setResultError.textContent = '';
  refs.frameResultError.textContent = '';
  refs.player1Input.classList.remove('is-error');
  refs.player2Input.classList.remove('is-error');
}

function setActiveSegment(container, predicate) {
  Array.from(container.querySelectorAll('.segment')).forEach((segment) => {
    segment.classList.toggle('is-active', predicate(segment));
  });
}

function updateGameSelectionUI() {
  setActiveSegment(refs.gameSegments, (segment) => segment.dataset.game === state.game);
}

function updateTypeAvailability() {
  const buttons = Array.from(refs.typeSegments.querySelectorAll('.segment'));

  buttons.forEach((button) => {
    const typeValue = button.dataset.type;
    const allowed = state.game ? GAME_OPTIONS[state.game].allowedTypes.includes(typeValue) : true;

    button.classList.toggle('is-disabled', !allowed);

    if (!allowed && state.type === typeValue) {
      state.type = null;
    }
  });

  setActiveSegment(refs.typeSegments, (segment) => segment.dataset.type === state.type);
}

function updateTypeSelectionUI() {
  setActiveSegment(refs.typeSegments, (segment) => segment.dataset.type === state.type);

  refs.frameTargetBlock.classList.toggle('hidden', state.type !== 'frame');
  refs.timeTargetBlock.classList.toggle('hidden', state.type !== 'time');

  setActiveSegment(refs.frameTargetSegments, (segment) => {
    if (!state.frameTarget) return false;
    return (
      segment.dataset.targetType === state.frameTarget.kind &&
      segment.dataset.targetValue === String(state.frameTarget.value)
    );
  });

  setActiveSegment(
    refs.timeTargetSegments,
    (segment) => segment.dataset.duration === String(state.timeDuration)
  );
}

function updateTimerModeUI() {
  setActiveSegment(refs.timerModeSegments, (segment) => segment.dataset.mode === state.timerMode);
}

function updateStopButtonLabel() {
  refs.stopBtn.textContent = state.type === 'time' ? 'Завершить партию' : 'Стоп';
}

function hasUnsavedProgress() {
  return (
    state.timerRunning ||
    state.timerPaused ||
    state.elapsedSeconds > 0 ||
    state.remainingSeconds > 0 ||
    state.frameRows.length > 0 ||
    state.pendingSetResult !== null
  );
}

function getCurrentElapsedFromTimestamp() {
  if (state.timerRunning && state.timerStartedAt) {
    return state.accumulatedElapsed + Math.floor((Date.now() - state.timerStartedAt) / 1000);
  }
  return state.accumulatedElapsed;
}

function syncElapsedValuesFromTimestamp() {
  const elapsed = getCurrentElapsedFromTimestamp();
  state.elapsedSeconds = elapsed;

  if (state.timerMode === 'countdown') {
    const duration = state.timeDuration || 0;
    state.remainingSeconds = Math.max(0, duration - elapsed);
  }
}

function persistSession() {
  const session = {
    player1: refs.player1Input.value.trim(),
    player2: refs.player2Input.value.trim(),
    game: state.game,
    type: state.type,
    frameTarget: state.frameTarget,
    timeDuration: state.timeDuration,

    timerMode: state.timerMode,
    timerRunning: state.timerRunning,
    timerPaused: state.timerPaused,
    timerFinished: state.timerFinished,

    elapsedSeconds: state.elapsedSeconds,
    remainingSeconds: state.remainingSeconds,
    currentLapTime: state.currentLapTime,

    timerStartedAt: state.timerStartedAt,
    accumulatedElapsed: state.accumulatedElapsed,

    frameRows: state.frameRows,
    pendingSetResult: state.pendingSetResult,
    setScore1: refs.setScore1.value === '' ? '' : Math.max(0, Number(refs.setScore1.value)),
    setScore2: refs.setScore2.value === '' ? '' : Math.max(0, Number(refs.setScore2.value)),
    repeatState: state.repeatState
  };

  const hasSessionData =
    session.player1 ||
    session.player2 ||
    session.game ||
    session.type ||
    session.frameRows.length > 0 ||
    session.pendingSetResult ||
    session.setScore1 !== '' ||
    session.setScore2 !== '' ||
    session.timerRunning ||
    session.timerPaused ||
    session.timerFinished ||
    session.elapsedSeconds > 0 ||
    session.remainingSeconds > 0;

  if (hasSessionData) {
    saveSession(session);
  } else {
    clearSessionStorage();
  }
}

function clearSessionState() {
  clearSessionStorage();
}

function validateInputs(showErrors = false) {
  clearFieldErrors();
  let valid = true;

  state.player1 = refs.player1Input.value.trim();
  state.player2 = refs.player2Input.value.trim();

  if (!state.player1 || !state.player2) {
    valid = false;
    if (showErrors) {
      refs.playersError.textContent = 'Введите имена обоих игроков.';
      if (!state.player1) refs.player1Input.classList.add('is-error');
      if (!state.player2) refs.player2Input.classList.add('is-error');
    }
  } else if (state.player1.toLowerCase() === state.player2.toLowerCase()) {
    valid = false;
    if (showErrors) {
      refs.playersError.textContent = 'Имена игроков должны отличаться.';
      refs.player1Input.classList.add('is-error');
      refs.player2Input.classList.add('is-error');
    }
  }

  if (!state.game) {
    valid = false;
    if (showErrors) refs.gameError.textContent = 'Выберите игру.';
  }

  if (!state.type) {
    valid = false;
    if (showErrors) refs.typeError.textContent = 'Выберите тип.';
  }

  if (state.type === 'frame' && !state.frameTarget) {
    valid = false;
    if (showErrors) refs.frameTargetError.textContent = 'Укажите условие завершения встречи.';
  }

  if (state.type === 'time' && !state.timeDuration) {
    valid = false;
    if (showErrors) refs.timeTargetError.textContent = 'Укажите длительность таймера.';
  }

  return valid;
}

function getCanUseTimer() {
  return validateInputs(false);
}

function getCurrentDisplayedSeconds() {
  syncElapsedValuesFromTimestamp();
  return state.timerMode === 'countdown' ? state.remainingSeconds : state.elapsedSeconds;
}

function updateTimerDisplay() {
  refs.timerDisplay.textContent = formatTime(getCurrentDisplayedSeconds());
  refs.timerDisplay.classList.toggle('is-paused', state.timerPaused && !state.timerFinished);
  refs.timerDisplay.classList.toggle('is-finished', state.timerFinished);
}

function isMobileViewport() {
  return window.innerWidth <= 768;
}

function isElementMostlyVisible(element) {
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

  return rect.top < viewportHeight * 0.7 && rect.bottom > viewportHeight * 0.3;
}

function animateWindowScrollTo(targetTop, duration = 520) {
  const startTop = window.scrollY;
  const distance = targetTop - startTop;

  if (Math.abs(distance) < 4) {
    window.scrollTo(0, targetTop);
    return;
  }

  const startTime = performance.now();

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(1, elapsed / duration);

    window.scrollTo(0, startTop + distance * progress);

    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  }

  window.requestAnimationFrame(step);
}

function scrollTimerCardIntoView() {
  if (!isMobileViewport() || isElementMostlyVisible(refs.timerCard)) {
    state.timerCardAutoScrolled = true;
    return;
  }

  const rect = refs.timerCard.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const targetTop = window.scrollY + rect.top - Math.max(24, (viewportHeight - rect.height) / 2);

  animateWindowScrollTo(Math.max(0, targetTop));

  state.timerCardAutoScrolled = true;
}

function syncTimerCardAutoScroll(canUse) {
  if (!canUse) {
    state.timerCardAutoScrolled = false;
    return;
  }

  if (
    state.timerCardAutoScrolled ||
    state.timerRunning ||
    state.timerPaused ||
    state.timerFinished ||
    state.pendingSetResult ||
    state.frameRows.length > 0
  ) {
    return;
  }

  scrollTimerCardIntoView();
}

function updateTimerCardState() {
  updateStopButtonLabel();

  const canUse = getCanUseTimer();

  refs.timerCard.classList.toggle('is-disabled', !canUse);
  refs.timerCard.classList.toggle(
    'is-active',
    canUse && !state.timerRunning && !state.timerPaused && !state.timerFinished
  );

  if (!canUse) {
    refs.timerHint.textContent = 'Заполните параметры игры, чтобы активировать время.';
    refs.timerStatusBadge.textContent = 'Ожидание';
    refs.timerStatusBadge.className = 'badge badge-warning';
    refs.startPauseBtn.disabled = true;
    refs.stopBtn.disabled = true;
    refs.resetTimeBtn.disabled = true;
    return;
  }

  refs.startPauseBtn.disabled = false;
  refs.resetTimeBtn.disabled =
    state.elapsedSeconds === 0 && state.remainingSeconds === 0 && !state.timerFinished;
  refs.stopBtn.disabled = !state.timerRunning && !state.timerPaused && !state.timerFinished;

  if (state.timerRunning) {
    refs.startPauseBtn.textContent = 'Пауза';
    refs.startPauseBtn.className = 'btn btn-warning btn-lg';

    if (state.type === 'time') {
      refs.timerHint.textContent = state.timeExpired
        ? 'Основное время закончилось. Доиграйте текущую партию.'
        : 'Идёт общее время встречи.';
      refs.timerStatusBadge.textContent = state.timeExpired ? 'Время вышло' : 'В работе';
      refs.timerStatusBadge.className = state.timeExpired
        ? 'badge badge-danger'
        : 'badge badge-success';
    } else {
      refs.timerHint.textContent =
        state.timerMode === 'countdown' ? 'Идёт обратный отсчёт.' : 'Секундомер запущен.';
      refs.timerStatusBadge.textContent = 'В работе';
      refs.timerStatusBadge.className = 'badge badge-success';
    }
  } else if (state.timerPaused) {
    refs.startPauseBtn.textContent = 'Продолжить';
    refs.startPauseBtn.className = 'btn btn-primary btn-lg';
    refs.timerHint.textContent = 'Время на паузе. Можно продолжить или остановить.';
    refs.timerStatusBadge.textContent = 'Пауза';
    refs.timerStatusBadge.className = 'badge badge-warning';
  } else if (state.timerFinished) {
    refs.startPauseBtn.textContent = 'Старт';
    refs.startPauseBtn.className = 'btn btn-primary btn-lg';
    refs.timerHint.textContent = 'Время зафиксировано. Заполните результат.';
    refs.timerStatusBadge.textContent = 'Готово';
    refs.timerStatusBadge.className = 'badge badge-accent';
  } else {
    refs.startPauseBtn.textContent = 'Старт';
    refs.startPauseBtn.className = 'btn btn-primary btn-lg';
    refs.timerHint.textContent = 'Параметры заполнены. Можно запускать время.';
    refs.timerStatusBadge.textContent = 'Готов';
    refs.timerStatusBadge.className = 'badge badge-success';
  }

  syncTimerCardAutoScroll(canUse);
}

function getGameLabel() {
  return state.game ? GAME_OPTIONS[state.game].label : '—';
}

function getTargetLabel() {
  if (state.type === 'frame' && state.frameTarget) {
    return state.frameTarget.kind === 'wins'
      ? 'до ' + state.frameTarget.value + ' побед'
      : 'до ' + state.frameTarget.value + ' очков';
  }

  if (state.type === 'time' && state.timeDuration) {
    const minutes = Math.round(state.timeDuration / 60);
    return minutes + ' мин';
  }

  if (state.type === 'set') {
    return 'одиночная партия';
  }

  return '—';
}

function syncTimerModeWithType() {
  if (state.type === 'time') {
    state.timerMode = 'countdown';
  } else {
    state.timerMode = 'stopwatch';
  }

  if (!state.timerRunning && !state.timerPaused && !state.timerFinished) {
    state.elapsedSeconds = 0;
    state.accumulatedElapsed = 0;
    state.timerStartedAt = null;
    state.remainingSeconds = state.timerMode === 'countdown' ? state.timeDuration || 0 : 0;
  }

  updateTimerModeUI();
  updateTimerDisplay();
  persistSession();
}

function resetResultsUI() {
  refs.setResultCard.classList.add('hidden', 'is-disabled');
  refs.frameResultCard.classList.add('hidden', 'is-disabled');
  refs.setResultError.textContent = '';
  refs.frameResultError.textContent = '';
  refs.setScore1.value = '';
  refs.setScore2.value = '';
  refs.frameRows.innerHTML = '';
  refs.winsSummary.textContent = '0 : 0';
  refs.ballsSummary.textContent = '0 : 0';
  refs.targetSummary.textContent = getTargetLabel();
  refs.frameStatusSummary.textContent = 'в процессе';
}

function resetMatchState({ keepInputs = false } = {}) {
  clearTimerInterval();

  state.timerRunning = false;
  state.timerPaused = false;
  state.timerFinished = false;
  state.elapsedSeconds = 0;
  state.remainingSeconds = state.type === 'time' ? state.timeDuration || 0 : 0;
  state.currentLapTime = 0;
  state.timerStartedAt = null;
  state.accumulatedElapsed = 0;
  state.frameRows = [];
  state.pendingSetResult = null;
  state.timeExpired = false;
  state.timerCardAutoScrolled = false;

  resetResultsUI();
  updateTimerDisplay();
  updateTimerCardState();

  if (!keepInputs) {
    state.game = null;
    state.type = null;
    state.frameTarget = null;
    state.timeDuration = null;
    refs.player1Input.value = '';
    refs.player2Input.value = '';
  }

  updateGameSelectionUI();
  updateTypeAvailability();
  updateTypeSelectionUI();
  syncTimerModeWithType();
  clearFieldErrors();
  persistSession();
}

function resetOnlyTime() {
  clearTimerInterval();

  state.timerRunning = false;
  state.timerPaused = false;
  state.timerFinished = false;
  state.elapsedSeconds = 0;
  state.currentLapTime = 0;
  state.timerStartedAt = null;
  state.accumulatedElapsed = 0;
  state.remainingSeconds = state.timerMode === 'countdown' ? state.timeDuration || 0 : 0;
  state.timeExpired = false;

  updateTimerDisplay();
  updateTimerCardState();
  persistSession();
}

function saveRepeatState() {
  state.repeatState = {
    player1: refs.player1Input.value.trim(),
    player2: refs.player2Input.value.trim(),
    game: state.game,
    type: state.type,
    frameTarget: state.frameTarget ? { ...state.frameTarget } : null,
    timeDuration: state.timeDuration
  };
  persistSession();
}

function applyRepeatState() {
  refs.player1Input.value = state.repeatState.player1 || '';
  refs.player2Input.value = state.repeatState.player2 || '';
  state.game = state.repeatState.game;
  state.type = state.repeatState.type;
  state.frameTarget = state.repeatState.frameTarget
    ? { ...state.repeatState.frameTarget }
    : null;
  state.timeDuration = state.repeatState.timeDuration;

  updateGameSelectionUI();
  updateTypeAvailability();
  updateTypeSelectionUI();
  syncTimerModeWithType();
  validateInputs(false);
  updateTimerCardState();
  persistSession();

  showToast('Параметры предыдущей игры восстановлены.');
}

function setTextStatus(element, text = '', tone = '') {
  element.textContent = text;
  element.classList.remove('is-success', 'is-warning', 'is-error');
  if (tone) {
    element.classList.add(tone);
  }
}

function setPlayerLookupMessage(refKey, text = '', tone = '') {
  setTextStatus(refs[refKey], text, tone);
}

function setStatsLookupMessage(refKey, text = '', tone = '') {
  setTextStatus(refs[refKey], text, tone);
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function formatDisplayDate(value) {
  const prepared = typeof value === 'string' ? value.trim() : '';
  const dottedDateMatch = prepared.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dottedDateMatch) {
    return dottedDateMatch[1] + '-' + dottedDateMatch[2] + '-' + dottedDateMatch[3];
  }

  const parsed = new Date(prepared);
  if (Number.isNaN(parsed.getTime())) return prepared;

  return (
    String(parsed.getDate()).padStart(2, '0') +
    '-' +
    String(parsed.getMonth() + 1).padStart(2, '0') +
    '-' +
    parsed.getFullYear()
  );
}

function getLookupCacheKey(name) {
  return normalizeName(name).toLowerCase();
}

async function lookupPlayer(name) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) return { exists: false };

  const cacheKey = getLookupCacheKey(normalizedName);
  if (cacheKey in state.playerLookupCache) {
    return state.playerLookupCache[cacheKey];
  }

  const result = await findPlayerByName(normalizedName);
  const prepared = {
    exists: Boolean(result.exists),
    name: result.name || normalizedName
  };
  if (prepared.exists) {
    state.playerLookupCache[cacheKey] = prepared;
  } else {
    delete state.playerLookupCache[cacheKey];
  }
  return prepared;
}

function queuePlayerLookup({ inputRef, statusRef, emptyMessage = '', mode = 'stats' }) {
  const input = refs[inputRef];
  const status = refs[statusRef];
  const name = normalizeName(input.value);

  clearTimeout(lookupDebounceTimers[statusRef]);

  if (!name) {
    setTextStatus(status, emptyMessage, '');
    return;
  }

  const requestId = (lookupRequestIds[statusRef] || 0) + 1;
  lookupRequestIds[statusRef] = requestId;
  setTextStatus(status, mode === 'stats' ? 'Ищем игрока...' : '', '');

  lookupDebounceTimers[statusRef] = setTimeout(async () => {
    try {
      const result = await lookupPlayer(name);
      if (lookupRequestIds[statusRef] !== requestId) return;

      if (mode === 'game') {
        setTextStatus(
          status,
          result.exists ? 'Игрок найден в базе.' : 'Новый игрок будет добавлен после сохранения матча.',
          result.exists ? 'is-success' : ''
        );
        return;
      }

      setTextStatus(
        status,
        result.exists ? 'Игрок найден.' : 'Такой игрок не найден.',
        result.exists ? 'is-success' : 'is-warning'
      );
    } catch (error) {
      if (lookupRequestIds[statusRef] !== requestId) return;
      setTextStatus(
        status,
        mode === 'stats' ? 'Поиск игроков станет доступен после обновления Apps Script.' : '',
        mode === 'stats' ? 'is-warning' : ''
      );
    }
  }, 350);
}

function updateStatsModeUI() {
  setActiveSegment(refs.statsModeSegments, (segment) => segment.dataset.statsMode === state.statsMode);
  refs.historyStatsCard.classList.toggle('hidden', state.statsMode !== 'history');
  refs.databaseStatsCard.classList.toggle('hidden', state.statsMode !== 'database');
}

function updateStatsReportUI() {
  setActiveSegment(refs.statsReportSegments, (segment) => segment.dataset.report === state.statsReport);
  refs.matchesReportPanel.classList.toggle('hidden', state.statsReport !== 'matches');
  refs.playerReportPanel.classList.toggle('hidden', state.statsReport !== 'player');
  refs.leaderboardsReportPanel.classList.toggle('hidden', state.statsReport !== 'leaderboards');
}

function updateMatchStatsPeriodUI() {
  setActiveSegment(refs.statsPeriodSegments, (segment) => segment.dataset.period === state.matchStatsPeriod);
}

function updateMatchStatsInputsState() {
  const hasPlayer1 = Boolean(normalizeName(refs.statsPlayer1Input.value));
  refs.statsPlayer2Input.disabled = !hasPlayer1;

  if (!hasPlayer1) {
    refs.statsPlayer2Input.value = '';
    setStatsLookupMessage('statsPlayer2Status', '', '');
  }
}

function renderMatchStatsDetail() {
  const detail = refs.matchStatsDetail;
  const selectedMatch = state.matchStatsResults.find((item) => item.id === state.selectedMatchStatsId);

  if (!selectedMatch) {
    detail.classList.add('hidden');
    detail.innerHTML = '';
    return;
  }

  detail.classList.remove('hidden');
  detail.classList.add('is-clickable');
  detail.innerHTML = '';

  const top = document.createElement('div');
  top.className = 'stats-overview-top';

  const players = document.createElement('div');
  players.className = 'stats-overview-players';
  players.textContent = selectedMatch.players;

  const score = document.createElement('div');
  score.className = 'stats-overview-score';
  score.textContent = selectedMatch.score;

  top.append(players, score);

  const summary = document.createElement('div');
  summary.className = 'stats-overview-bottom';

  const meta = document.createElement('div');
  meta.className = 'stats-overview-meta';
  meta.textContent = [
    selectedMatch.displayDate || selectedMatch.date,
    selectedMatch.game,
    selectedMatch.type
  ].join(' • ');

  summary.appendChild(meta);

  const grid = document.createElement('div');
  grid.className = 'stats-detail-grid';

  const isSetMatch = selectedMatch.type === TYPE_LABELS.set;
  const detailRows = isSetMatch
    ? [['Продолжительность', selectedMatch.durationText || '—']]
    : [
        ['Тип', selectedMatch.extra || '—'],
        ['Продолжительность', selectedMatch.durationText || '—'],
        ['Партий сыграно', selectedMatch.frameCount ? String(selectedMatch.frameCount) : '—']
      ];

  detailRows.forEach(([label, value]) => {
    const block = document.createElement('div');
    block.className = 'stats-detail-block';

    const labelEl = document.createElement('span');
    labelEl.className = 'stats-meta-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'stats-meta-value';
    valueEl.textContent = value;

    block.append(labelEl, valueEl);
    grid.appendChild(block);
  });

  detail.append(top, summary, grid);

  if (!isSetMatch && Array.isArray(selectedMatch.partyResults) && selectedMatch.partyResults.length) {
    const partyResultsTitle = document.createElement('div');
    partyResultsTitle.className = 'stats-detail-subtitle';
    partyResultsTitle.textContent = 'Результаты партий';

    const partyList = document.createElement('div');
    partyList.className = 'stats-detail-list';

    selectedMatch.partyResults.forEach((party) => {
      const item = document.createElement('div');
      item.className = 'stats-detail-list-item';
      item.textContent = party.score + ' (' + formatTime(Number(party.durationSeconds || 0)) + ')';
      partyList.appendChild(item);
    });

    detail.append(partyResultsTitle, partyList);
  }
}

function renderMatchStatsResults() {
  const list = refs.matchStatsList;
  const empty = refs.matchStatsEmptyState;
  const hasResults = state.matchStatsResults.length > 0;
  const hasSelectedMatch = Boolean(
    state.selectedMatchStatsId &&
      state.matchStatsResults.some((item) => item.id === state.selectedMatchStatsId)
  );

  if (!hasResults) {
    empty.textContent = 'По вашему фильтру матчей не найдено.';
    empty.classList.remove('hidden');
    list.classList.add('hidden');
    refs.matchStatsDetail.classList.add('hidden');
    refs.databaseStatsBadge.textContent = '0';
    return;
  }

  refs.databaseStatsBadge.textContent = String(state.matchStatsResults.length);
  empty.textContent = 'По вашему фильтру матчи не найдены.';
  list.innerHTML = '';
  state.matchStatsResults.forEach((item) => {
    const card = document.createElement('div');
    const isSetMatch = item.type === TYPE_LABELS.set;
    card.className = 'stats-item is-overview-row' + (isSetMatch ? '' : ' is-clickable');
    card.dataset.matchId = item.id;

    const top = document.createElement('div');
    top.className = 'stats-overview-top';

    const players = document.createElement('div');
    players.className = 'stats-overview-players';
    players.textContent = item.players;

    const score = document.createElement('div');
    score.className = 'stats-overview-score';
    score.textContent = item.score;

    const duration = document.createElement('div');
    duration.className = 'stats-overview-time';
    duration.textContent = item.durationText || '—';

    top.append(players, score);

    const bottom = document.createElement('div');
    bottom.className = 'stats-overview-bottom';

    const meta = document.createElement('div');
    meta.className = 'stats-overview-meta';
    meta.textContent = [item.displayDate || item.date, item.game, item.type].join(' • ');

    bottom.append(meta, duration);

    card.append(top, bottom);
    list.appendChild(card);
  });

  if (hasSelectedMatch) {
    list.classList.add('hidden');
    empty.classList.add('hidden');
    renderMatchStatsDetail();
    return;
  }

  list.classList.remove('hidden');
  empty.classList.add('hidden');
  refs.matchStatsDetail.classList.add('hidden');
}

function setSelectedMatchStats(matchId) {
  const match = state.matchStatsResults.find((item) => item.id === matchId);
  if (!match || match.type === TYPE_LABELS.set) return;

  state.selectedMatchStatsId = state.selectedMatchStatsId === matchId ? null : matchId;
  renderMatchStatsResults();
}

function prepareMatchStatsItem(item) {
  const durationSeconds = Number(item.durationSeconds || 0);
  let partyResults = [];

  if (Array.isArray(item.partyResults)) {
    partyResults = item.partyResults;
  } else if (typeof item.partyResultsJson === 'string' && item.partyResultsJson.trim()) {
    try {
      const parsed = JSON.parse(item.partyResultsJson);
      if (Array.isArray(parsed)) {
        partyResults = parsed;
      }
    } catch (error) {
      console.warn('Не удалось прочитать partyResultsJson:', error);
    }
  }

  return {
    ...item,
    displayDate: formatDisplayDate(item.date),
    durationText: durationSeconds > 0 ? formatTime(durationSeconds) : '—',
    partyResults,
    ballsText:
      typeof item.balls1 === 'number' || typeof item.balls2 === 'number'
        ? String(item.balls1 || 0) + ':' + String(item.balls2 || 0)
        : '—'
  };
}

async function loadMatchStatsReport() {
  refs.matchStatsError.textContent = '';

  const player1 = normalizeName(refs.statsPlayer1Input.value);
  const player2 = normalizeName(refs.statsPlayer2Input.value);

  if (!player1) {
    refs.matchStatsError.textContent = 'Введите Игрока 1.';
    return;
  }

  if (player2 && player1.toLowerCase() === player2.toLowerCase()) {
    refs.matchStatsError.textContent = 'Имена игроков должны отличаться.';
    return;
  }

  refs.loadMatchStatsBtn.disabled = true;
  refs.loadMatchStatsBtn.textContent = 'Загрузка...';
  refs.matchStatsMetaText.textContent = 'Получаем статистику матчей из базы...';
  refs.matchStatsMetaText.classList.remove('is-success', 'is-warning', 'is-error');

  try {
    const result = await getMatchStats({
      player1,
      player2,
      period: state.matchStatsPeriod
    });

    state.matchStatsResults = Array.isArray(result.matches)
      ? result.matches.map(prepareMatchStatsItem)
      : [];
    state.selectedMatchStatsId = null;

    refs.matchStatsMetaText.textContent =
      result.metaText ||
      (state.matchStatsResults.length
        ? 'Найдено матчей: ' + state.matchStatsResults.length + '. Нажмите на строку, чтобы увидеть детали.'
        : 'По выбранному фильтру матчей не найдено.');

    renderMatchStatsResults();
  } catch (error) {
    state.matchStatsResults = [];
    state.selectedMatchStatsId = null;
    renderMatchStatsResults();
    refs.matchStatsError.textContent =
      error instanceof Error ? error.message : 'Не удалось загрузить статистику матчей.';
    refs.matchStatsMetaText.textContent = 'Проверьте Apps Script и подключение к Google Sheets.';
    refs.matchStatsMetaText.classList.add('is-warning');
  } finally {
    refs.loadMatchStatsBtn.disabled = false;
    refs.loadMatchStatsBtn.textContent = 'Показать';
  }
}

function renderStatistics() {
  const list = refs.statsList;
  const empty = refs.statsEmptyState;
  const countBadge = refs.statsCountBadge;

  countBadge.textContent = String(state.statistics.length);
  list.innerHTML = '';

  if (!state.statistics.length) {
    empty.classList.remove('hidden');
    list.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.classList.remove('hidden');

  state.statistics.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'stats-item';

    const top = document.createElement('div');
    top.className = 'stats-item-top';

    const topInfo = document.createElement('div');

    const players = document.createElement('div');
    players.className = 'stats-players';
    players.textContent = item.players;

    const date = document.createElement('div');
    date.className = 'stats-date';
    date.textContent = item.date;

    topInfo.append(players, date);

    const typeBadge = document.createElement('span');
    typeBadge.className = 'badge badge-accent';
    typeBadge.textContent = item.type;

    top.append(topInfo, typeBadge);

    const meta = document.createElement('div');
    meta.className = 'stats-meta';

    const createMetaBlock = (label, value) => {
      const block = document.createElement('div');
      block.className = 'stats-meta-block';

      const labelEl = document.createElement('span');
      labelEl.className = 'stats-meta-label';
      labelEl.textContent = label;

      const valueEl = document.createElement('span');
      valueEl.className = 'stats-meta-value';
      valueEl.textContent = value;

      block.append(labelEl, valueEl);
      return block;
    };

    meta.append(
      createMetaBlock('Игра', item.game),
      createMetaBlock('Счёт', item.score),
      createMetaBlock('Дополнительно', item.extra || '—')
    );

    card.append(top, meta);
    list.appendChild(card);
  });
}

function openStatsScreen() {
  renderStatistics();
  updateStatsModeUI();
  updateStatsReportUI();
  updateMatchStatsInputsState();
  updateMatchStatsPeriodUI();
  renderMatchStatsResults();
  refs.gameScreen.classList.add('hidden');
  refs.statsScreen.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openGameScreen() {
  refs.statsScreen.classList.add('hidden');
  refs.gameScreen.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function createEntryId() {
  return 'stat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

function createStatisticsEntry(payload) {
  const now = new Date();
  const date =
    String(now.getDate()).padStart(2, '0') +
    '.' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '.' +
    now.getFullYear();

  const entry = {
    id: createEntryId(),
    createdAt: now.toISOString(),
    date,
    ...payload
  };

  state.statistics.unshift(entry);
  saveStatistics(state.statistics);
  renderStatistics();

  void upsertPlayers([entry.player1, entry.player2])
    .then(() => {
      [entry.player1, entry.player2].forEach((name) => {
        const normalizedName = normalizeName(name);
        if (!normalizedName) return;

        state.playerLookupCache[getLookupCacheKey(normalizedName)] = {
          exists: true,
          name: normalizedName
        };
      });
    })
    .catch((error) => {
      console.warn('Не удалось обновить базу игроков:', error);
    });
  enqueueStatisticsSync(entry);
  void syncPendingStatistics();
}

function startRunningLoop() {
  clearTimerInterval();

  state.timerInterval = setInterval(() => {
    syncElapsedValuesFromTimestamp();
    updateTimerDisplay();

    if (state.type === 'time' && state.remainingSeconds <= 0 && !state.timeExpired) {
      state.remainingSeconds = 0;
      state.timeExpired = true;
      showToast('Время закончилось. Доиграйте текущую партию.');
    }

    updateTimerCardState();
    persistSession();
  }, 1000);
}

function startTimer() {
  if (!validateInputs(true)) {
    updateTimerCardState();
    return;
  }

  if (state.type === 'time' && state.timeExpired) {
    showToast('Основное время уже закончилось. Новую партию начинать нельзя.');
    return;
  }

  if (state.timerFinished) {
    state.timerFinished = false;
  }

  if (state.timerMode === 'countdown' && state.remainingSeconds <= 0 && !state.timeExpired) {
    state.remainingSeconds = state.timeDuration || 0;
  }

  state.timerRunning = true;
  state.timerPaused = false;
  state.timerStartedAt = Date.now();

  refs.inputCard.classList.remove('is-active');
  refs.timerCard.classList.add('is-active');

  startRunningLoop();
  updateTimerCardState();
  persistSession();
}

function pauseTimer() {
  syncElapsedValuesFromTimestamp();
  clearTimerInterval();

  state.accumulatedElapsed = state.elapsedSeconds;
  state.timerStartedAt = null;
  state.timerRunning = false;
  state.timerPaused = true;

  updateTimerDisplay();
  updateTimerCardState();
  persistSession();
}

function handleStartPause() {
  if (!getCanUseTimer()) {
    validateInputs(true);
    updateTimerCardState();
    return;
  }

  if (state.timerRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
}

function prepareSetResult(lapTime) {
  state.pendingSetResult = { time: lapTime };

  refs.setMetaText.textContent = getGameLabel() + ' · ' + TYPE_LABELS[state.type];
  refs.setTimeBadge.textContent = 'Время ' + formatTime(lapTime);
  refs.setPlayer1Label.textContent = state.player1;
  refs.setPlayer2Label.textContent = state.player2;
  refs.setRowTime.textContent = formatTime(lapTime);
  refs.setScore1.value = '';
  refs.setScore2.value = '';
  refs.setResultError.textContent = '';

  refs.setResultCard.classList.remove('hidden', 'is-disabled');
  refs.setResultCard.classList.add('is-active');
  refs.frameResultCard.classList.add('hidden');

  refs.setResultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => refs.setScore1.focus(), 300);
  persistSession();
}

function renderFrameRows() {
  refs.frameRows.innerHTML = '';
  refs.framePlayer1Label.textContent = state.player1 || 'Игрок 1';
  refs.framePlayer2Label.textContent = state.player2 || 'Игрок 2';

  state.frameRows.forEach((row, index) => {
    const rowElement = document.createElement('div');
    rowElement.className = 'result-row' + (row.completed ? '' : ' is-active');

    const p1Class =
      row.completed && row.score1 > row.score2 ? 'input-score is-winner' : 'input-score';
    const p2Class =
      row.completed && row.score2 > row.score1 ? 'input-score is-winner' : 'input-score';

    const numberEl = document.createElement('div');
    numberEl.className = 'result-row-number';
    numberEl.textContent = String(row.partyNumber);

    const timeEl = document.createElement('div');
    timeEl.className = 'result-row-time';
    timeEl.textContent = formatTime(row.time);

    const createScoreCell = (player, className, value) => {
      const scoreCell = document.createElement('div');
      scoreCell.className = 'score-cell';

      const input = document.createElement('input');
      input.className = className;
      input.type = 'number';
      input.min = '0';
      input.inputMode = 'numeric';
      input.dataset.rowIndex = String(index);
      input.dataset.player = player;

      if (value !== '') {
        input.value = String(value);
      }

      scoreCell.appendChild(input);
      return scoreCell;
    };

    rowElement.append(
      numberEl,
      timeEl,
      createScoreCell('1', p1Class, row.score1),
      createScoreCell('2', p2Class, row.score2)
    );

    refs.frameRows.appendChild(rowElement);
  });

  const inputs = refs.frameRows.querySelectorAll('input[type="number"]');
  inputs.forEach((input) => {
    input.addEventListener('input', handleFrameScoreInput);
  });

  const activeInput = refs.frameRows.querySelector('.result-row.is-active input');
  if (activeInput) {
    setTimeout(() => activeInput.focus(), 200);
  }
}

function updateFrameSummary() {
  let wins1 = 0;
  let wins2 = 0;
  let balls1 = 0;
  let balls2 = 0;

  state.frameRows.forEach((row) => {
    if (!row.completed) return;

    balls1 += Number(row.score1);
    balls2 += Number(row.score2);

    if (row.score1 > row.score2) wins1 += 1;
    if (row.score2 > row.score1) wins2 += 1;
  });

  refs.winsSummary.textContent = wins1 + ' : ' + wins2;
  refs.ballsSummary.textContent = balls1 + ' : ' + balls2;
  refs.targetSummary.textContent = getTargetLabel();
  refs.currentPartyBadge.textContent = 'Текущая партия: ' + (state.frameRows.length || 1);

  if (state.type === 'time') {
    refs.frameStatusSummary.textContent = state.timeExpired ? 'время вышло' : 'в процессе';

    const currentRow = state.frameRows[state.frameRows.length - 1];
    const canStartNext = Boolean(currentRow && currentRow.completed && !state.timeExpired);

    refs.nextPartyBtn.classList.remove('hidden');
    refs.nextPartyBtn.className = 'btn btn-primary btn-lg';
    refs.nextPartyBtn.textContent = state.timeExpired
      ? 'Время закончилось'
      : 'Начать следующую партию';
    refs.nextPartyBtn.disabled = !canStartNext;

    refs.saveFrameBtn.disabled = !canSaveFrame();
    return;
  }

  const targetReached = state.frameTarget
    ? state.frameTarget.kind === 'wins'
      ? wins1 >= state.frameTarget.value || wins2 >= state.frameTarget.value
      : balls1 >= state.frameTarget.value || balls2 >= state.frameTarget.value
    : false;

  refs.frameStatusSummary.textContent = targetReached ? 'условие достигнуто' : 'в процессе';
  refs.nextPartyBtn.classList.remove('hidden');
  refs.nextPartyBtn.className = targetReached ? 'btn btn-warning btn-lg' : 'btn btn-primary btn-lg';
  refs.nextPartyBtn.textContent = targetReached
    ? 'Встреча закончена'
    : 'Начать следующую партию';
  refs.nextPartyBtn.disabled = !canProceedToNextParty();
  refs.saveFrameBtn.disabled = !canSaveFrame();
}

function openFrameResult(lapTime) {
  refs.frameCardTitle.textContent =
    state.type === 'time' ? 'Результаты встречи на время' : 'Результат встречи';

  refs.frameMetaText.textContent =
    getGameLabel() + ' · ' + TYPE_LABELS[state.type] + ' · ' + getTargetLabel();

  refs.frameResultError.textContent = '';
  refs.frameResultCard.classList.remove('hidden', 'is-disabled');
  refs.frameResultCard.classList.add('is-active');
  refs.setResultCard.classList.add('hidden');

  const shouldAddNewRow =
    state.frameRows.length === 0 ||
    state.frameRows[state.frameRows.length - 1].completed;

  if (shouldAddNewRow) {
    state.frameRows.push({
      partyNumber: state.frameRows.length + 1,
      time: lapTime,
      score1: '',
      score2: '',
      completed: false
    });
  }

  refs.nextPartyBtn.classList.remove('hidden');
  refs.nextPartyBtn.className = 'btn btn-primary btn-lg';
  refs.nextPartyBtn.textContent = 'Начать следующую партию';

  renderFrameRows();
  updateFrameSummary();
  refs.frameResultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  persistSession();
}

function handleStop(isAutomatic = false) {
  if (!state.timerRunning && !state.timerPaused && !state.timerFinished) {
    showToast('Сначала запустите время.');
    return;
  }

  syncElapsedValuesFromTimestamp();

  if (state.timerRunning) {
    clearTimerInterval();
    state.timerRunning = false;
    state.timerPaused = false;
    state.timerStartedAt = null;
    state.accumulatedElapsed = state.elapsedSeconds;
  }

  let lapTime;

  if (state.type === 'time') {
    const previousLapSum = state.frameRows.reduce((sum, row) => sum + row.time, 0);
    lapTime = state.elapsedSeconds - previousLapSum;
  } else {
    lapTime =
      state.timerMode === 'countdown'
        ? (state.timeDuration || 0) - state.remainingSeconds
        : state.elapsedSeconds;
  }

  state.currentLapTime = Math.max(0, lapTime);
  state.timerFinished = true;

  updateTimerDisplay();
  updateTimerCardState();
  refs.timerCard.classList.remove('is-active');

  if (state.type === 'set') {
    prepareSetResult(state.currentLapTime);
  } else {
    openFrameResult(state.currentLapTime);
  }

  if (isAutomatic && state.type === 'time') {
    showToast('Время закончилось. Доиграйте текущую партию.');
  }

  persistSession();
}

function isFrameTargetReached() {
  if (state.type !== 'frame' || !state.frameTarget) return false;

  let wins1 = 0;
  let wins2 = 0;
  let balls1 = 0;
  let balls2 = 0;

  state.frameRows.forEach((row) => {
    if (!row.completed) return;

    balls1 += Number(row.score1);
    balls2 += Number(row.score2);

    if (row.score1 > row.score2) wins1 += 1;
    if (row.score2 > row.score1) wins2 += 1;
  });

  return state.frameTarget.kind === 'wins'
    ? wins1 >= state.frameTarget.value || wins2 >= state.frameTarget.value
    : balls1 >= state.frameTarget.value || balls2 >= state.frameTarget.value;
}

function canProceedToNextParty() {
  if (state.type !== 'frame' || state.frameRows.length === 0) return false;
  const currentRow = state.frameRows[state.frameRows.length - 1];
  return currentRow.completed && !isFrameTargetReached();
}

function canSaveFrame() {
  if (state.frameRows.length === 0) return false;
  return state.frameRows.every((row) => row.completed);
}

function handleFrameScoreInput(event) {
  const input = event.target;
  const rowIndex = Number(input.dataset.rowIndex);
  const player = input.dataset.player;
  const row = state.frameRows[rowIndex];

  if (!row) return;

  const value = input.value === '' ? '' : Math.max(0, Number(input.value));

  if (player === '1') row.score1 = value;
  if (player === '2') row.score2 = value;

  row.completed = row.score1 !== '' && row.score2 !== '';
  refs.frameResultError.textContent = '';

  renderFrameRows();
  updateFrameSummary();
  persistSession();
}

function saveSetResult() {
  const score1 = refs.setScore1.value === '' ? '' : Math.max(0, Number(refs.setScore1.value));
  const score2 = refs.setScore2.value === '' ? '' : Math.max(0, Number(refs.setScore2.value));

  if (score1 === '' || score2 === '') {
    refs.setResultError.textContent = 'Заполните результат обоих игроков.';
    return;
  }

  refs.setResultError.textContent = '';

  const setDuration = state.pendingSetResult ? state.pendingSetResult.time : 0;

  createStatisticsEntry({
    players: state.player1 + ' vs ' + state.player2,
    player1: state.player1,
    player2: state.player2,
    game: getGameLabel(),
    gameKey: state.game,
    type: TYPE_LABELS[state.type],
    typeKey: state.type,
    score: score1 + ':' + score2,
    extra: 'Время ' + formatTime(setDuration),
    score1,
    score2,
    wins1: score1 > score2 ? 1 : 0,
    wins2: score2 > score1 ? 1 : 0,
    balls1: score1,
    balls2: score2,
    frameCount: 1,
    durationSeconds: setDuration,
    partyResults: [],
    partyResultsJson: '[]',
    targetKind: null,
    targetValue: null
  });

  saveRepeatState();
  showToast('Результат партии записан в статистику.');
  resetOnlyTime();
  state.pendingSetResult = null;
  refs.setResultCard.classList.add('hidden');
  refs.setResultCard.classList.remove('is-active');
  persistSession();
}

function saveFrameResult() {
  if (!canSaveFrame()) {
    refs.frameResultError.textContent = 'Заполните результат во всех строках.';
    return;
  }

  refs.frameResultError.textContent = '';

  let wins1 = 0;
  let wins2 = 0;
  let balls1 = 0;
  let balls2 = 0;

  state.frameRows.forEach((row) => {
    balls1 += Number(row.score1);
    balls2 += Number(row.score2);
    if (row.score1 > row.score2) wins1 += 1;
    if (row.score2 > row.score1) wins2 += 1;
  });

  const scoreText = wins1 + ':' + wins2 + ' (' + balls1 + ':' + balls2 + ')';
  const totalDuration = state.frameRows.reduce((sum, row) => sum + Number(row.time || 0), 0);
  const partyResults = state.frameRows.map((row) => ({
    score: String(row.score1) + ':' + String(row.score2),
    durationSeconds: Number(row.time || 0)
  }));

  createStatisticsEntry({
    players: state.player1 + ' vs ' + state.player2,
    player1: state.player1,
    player2: state.player2,
    game: getGameLabel(),
    gameKey: state.game,
    type: TYPE_LABELS[state.type],
    typeKey: state.type,
    score: scoreText,
    extra: getTargetLabel(),
    score1: wins1,
    score2: wins2,
    wins1,
    wins2,
    balls1,
    balls2,
    frameCount: state.frameRows.length,
    durationSeconds: totalDuration,
    partyResults,
    partyResultsJson: JSON.stringify(partyResults),
    targetKind: state.type === 'frame' && state.frameTarget ? state.frameTarget.kind : null,
    targetValue: state.type === 'frame' && state.frameTarget ? state.frameTarget.value : null
  });

  saveRepeatState();

  showToast(
    state.type === 'time'
      ? 'Игра на время записана в статистику.'
      : 'Результат встречи записан в статистику.'
  );

  resetOnlyTime();
  state.frameRows = [];
  refs.frameResultCard.classList.add('hidden');
  refs.frameResultCard.classList.remove('is-active');

  renderFrameRows();
  updateFrameSummary();
  persistSession();
}

function handleNextParty() {
  if (state.type === 'time') {
    const currentRow = state.frameRows[state.frameRows.length - 1];

    if (!currentRow || !currentRow.completed) {
      refs.frameResultError.textContent = 'Сначала заполните текущую партию.';
      return;
    }

    if (state.timeExpired) {
      refs.frameResultError.textContent =
        'Основное время закончилось. Новую партию начинать нельзя.';
      return;
    }

    refs.frameResultError.textContent = '';
    refs.frameResultCard.classList.remove('is-active');
    refs.frameResultCard.classList.add('is-disabled');
    state.timerFinished = false;
    refs.timerCard.classList.add('is-active');
    refs.timerCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    persistSession();
    startTimer();
    return;
  }

  if (!canProceedToNextParty()) {
    refs.frameResultError.textContent = 'Сначала заполните текущую партию.';
    return;
  }

  refs.frameResultError.textContent = '';
  refs.frameResultCard.classList.remove('is-active');
  refs.frameResultCard.classList.add('is-disabled');
  state.timerFinished = false;
  state.timerPaused = false;
  state.timerRunning = false;
  state.elapsedSeconds = 0;
  state.remainingSeconds = state.timerMode === 'countdown' ? state.timeDuration || 0 : 0;
  state.timerStartedAt = null;
  state.accumulatedElapsed = 0;

  updateTimerDisplay();
  updateTimerCardState();

  refs.timerCard.classList.add('is-active');
  refs.timerCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

  persistSession();
  startTimer();
}

function setTimerMode(mode) {
  if (state.type === 'time') return;

  if (hasUnsavedProgress()) {
    showToast('Нельзя менять режим времени во время активной партии.');
    return;
  }

  state.timerMode = mode;
  resetOnlyTime();
  updateTimerModeUI();
  persistSession();
}

function handleTypeChange(type) {
  if (state.type === type) return;

  if (hasUnsavedProgress()) {
    showToast('Сначала завершите или сбросьте текущую игру.');
    return;
  }

  state.type = type;
  state.frameTarget = null;
  state.timeDuration = null;

  updateTypeSelectionUI();
  syncTimerModeWithType();
  validateInputs(false);
  updateTimerCardState();
  resetResultsUI();
  persistSession();
}

function handleGameChange(game) {
  if (state.game === game) return;

  if (hasUnsavedProgress()) {
    showToast('Сначала завершите или сбросьте текущую игру.');
    return;
  }

  state.game = game;
  updateGameSelectionUI();
  updateTypeAvailability();

  if (state.type && !GAME_OPTIONS[state.game].allowedTypes.includes(state.type)) {
    state.type = null;
    state.frameTarget = null;
    state.timeDuration = null;
  }

  updateTypeSelectionUI();
  syncTimerModeWithType();
  validateInputs(false);
  updateTimerCardState();
  resetResultsUI();
  persistSession();
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeText(value) {
  return typeof value === 'string' ? value : '';
}

function sanitizeNonNegativeNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sanitizeGame(value) {
  return typeof value === 'string' && GAME_OPTIONS[value] ? value : null;
}

function sanitizeType(value, game) {
  if (typeof value !== 'string' || !TYPE_LABELS[value]) return null;
  if (game && !GAME_OPTIONS[game].allowedTypes.includes(value)) return null;
  return value;
}

function sanitizeFrameTarget(value, type) {
  if (type !== 'frame' || !isPlainObject(value)) return null;
  const kind = value.kind === 'wins' || value.kind === 'points' ? value.kind : null;
  const targetValue =
    typeof value.value === 'number' && Number.isFinite(value.value) && value.value > 0
      ? value.value
      : null;

  if (!kind || targetValue === null) return null;
  return { kind, value: targetValue };
}

function sanitizeTimeDuration(value, type) {
  if (type !== 'time') return null;
  return sanitizeNonNegativeNumber(value, 0) || null;
}

function sanitizeScoreValue(value) {
  if (value === '') return '';
  return sanitizeNonNegativeNumber(value, null);
}

function sanitizeFrameRows(value, type) {
  if ((type !== 'frame' && type !== 'time') || !Array.isArray(value)) return [];

  return value
    .filter((row) => isPlainObject(row))
    .map((row, index) => {
      const score1 = sanitizeScoreValue(row.score1);
      const score2 = sanitizeScoreValue(row.score2);

      if (score1 === null || score2 === null) return null;

      return {
        partyNumber: sanitizeNonNegativeNumber(row.partyNumber, index + 1) || index + 1,
        time: sanitizeNonNegativeNumber(row.time, 0),
        score1,
        score2,
        completed: score1 !== '' && score2 !== ''
      };
    })
    .filter(Boolean);
}

function sanitizePendingSetResult(value, type) {
  if (type !== 'set' || !isPlainObject(value)) return null;
  return {
    time: sanitizeNonNegativeNumber(value.time, 0)
  };
}

function sanitizeRepeatState(value) {
  if (!isPlainObject(value)) {
    return { ...DEFAULT_REPEAT_STATE };
  }

  const game = sanitizeGame(value.game);
  const type = sanitizeType(value.type, game);

  return {
    player1: sanitizeText(value.player1),
    player2: sanitizeText(value.player2),
    game,
    type,
    frameTarget: sanitizeFrameTarget(value.frameTarget, type),
    timeDuration: sanitizeTimeDuration(value.timeDuration, type)
  };
}

function restoreSession() {
  const saved = loadSession();
  if (!isPlainObject(saved)) {
    clearSessionStorage();
    return;
  }

  const player1 = sanitizeText(saved.player1);
  const player2 = sanitizeText(saved.player2);
  const game = sanitizeGame(saved.game);
  const type = sanitizeType(saved.type, game);
  const frameTarget = sanitizeFrameTarget(saved.frameTarget, type);
  const timeDuration = sanitizeTimeDuration(saved.timeDuration, type);

  const timerMode =
    type === 'time'
      ? 'countdown'
      : saved.timerMode === 'countdown' || saved.timerMode === 'stopwatch'
        ? saved.timerMode
        : 'stopwatch';

  const elapsedSeconds = sanitizeNonNegativeNumber(saved.elapsedSeconds, 0);
  const currentLapTime = sanitizeNonNegativeNumber(saved.currentLapTime, 0);
  const accumulatedElapsed = sanitizeNonNegativeNumber(saved.accumulatedElapsed, 0);
  const timerStartedAt =
    typeof saved.timerStartedAt === 'number' && Number.isFinite(saved.timerStartedAt)
      ? saved.timerStartedAt
      : null;

  const frameRows = sanitizeFrameRows(saved.frameRows, type);
  const pendingSetResult = sanitizePendingSetResult(saved.pendingSetResult, type);
  const setScore1 = sanitizeScoreValue(saved.setScore1);
  const setScore2 = sanitizeScoreValue(saved.setScore2);
  const repeatState = sanitizeRepeatState(saved.repeatState);

  let timerRunning = Boolean(saved.timerRunning);
  let timerPaused = Boolean(saved.timerPaused);
  let timerFinished = Boolean(saved.timerFinished);

  if (!type) {
    timerRunning = false;
    timerPaused = false;
    timerFinished = false;
  }

  if (timerRunning && !timerStartedAt) {
    timerRunning = false;
    timerPaused = true;
  }

  if (timerRunning && timerFinished) {
    timerFinished = false;
  }

  let remainingSeconds;
  if (timerMode === 'countdown') {
    const safeDuration = timeDuration || 0;
    remainingSeconds = Math.max(0, safeDuration - elapsedSeconds);
  } else {
    remainingSeconds = sanitizeNonNegativeNumber(saved.remainingSeconds, 0);
  }

  refs.player1Input.value = player1;
  refs.player2Input.value = player2;

  state.game = game;
  state.type = type;
  state.frameTarget = frameTarget;
  state.timeDuration = timeDuration;

  state.timerMode = timerMode;
  state.timerRunning = timerRunning;
  state.timerPaused = timerPaused;
  state.timerFinished = timerFinished;

  state.elapsedSeconds = elapsedSeconds;
  state.remainingSeconds = remainingSeconds;
  state.currentLapTime = currentLapTime;

  state.timerStartedAt = timerStartedAt;
  state.accumulatedElapsed = accumulatedElapsed;

  state.frameRows = frameRows;
  state.pendingSetResult = pendingSetResult;
  state.repeatState = repeatState;
  state.timeExpired = type === 'time' && timerMode === 'countdown' && remainingSeconds <= 0;
  state.timerCardAutoScrolled = true;

  const hasRestoredData =
    player1 ||
    player2 ||
    game ||
    type ||
    frameRows.length > 0 ||
    pendingSetResult ||
    setScore1 !== '' ||
    setScore2 !== '' ||
    timerRunning ||
    timerPaused ||
    timerFinished ||
    elapsedSeconds > 0 ||
    remainingSeconds > 0;

  if (!hasRestoredData) {
    clearSessionStorage();
    return;
  }

  updateGameSelectionUI();
  updateTypeAvailability();
  updateTypeSelectionUI();

  if (state.timerRunning && state.timerStartedAt) {
    syncElapsedValuesFromTimestamp();

    if (state.timerMode === 'countdown' && state.remainingSeconds <= 0) {
      state.timerRunning = false;
      state.timerPaused = false;
      state.timerFinished = true;
      state.timerStartedAt = null;
      state.accumulatedElapsed = state.timeDuration || 0;
      state.currentLapTime = state.timeDuration || 0;
    } else {
      startRunningLoop();
    }
  } else {
    syncElapsedValuesFromTimestamp();
  }

  if (state.pendingSetResult) {
    refs.setMetaText.textContent = getGameLabel() + ' · ' + TYPE_LABELS[state.type];
    refs.setTimeBadge.textContent = 'Время ' + formatTime(state.pendingSetResult.time);
    refs.setPlayer1Label.textContent = state.player1;
    refs.setPlayer2Label.textContent = state.player2;
    refs.setRowTime.textContent = formatTime(state.pendingSetResult.time);
    refs.setScore1.value = setScore1 === '' ? '' : String(setScore1);
    refs.setScore2.value = setScore2 === '' ? '' : String(setScore2);
    refs.setResultCard.classList.remove('hidden', 'is-disabled');
  }

  if (state.frameRows.length > 0) {
    refs.frameCardTitle.textContent =
      state.type === 'time' ? 'Результат игры на время' : 'Результат встречи';
    refs.frameMetaText.textContent =
      getGameLabel() + ' · ' + TYPE_LABELS[state.type] + ' · ' + getTargetLabel();
    refs.frameResultCard.classList.remove('hidden', 'is-disabled');
    renderFrameRows();
    updateFrameSummary();
  }

  updateTimerDisplay();
  updateTimerCardState();

  persistSession();
  showToast('Незавершённая сессия восстановлена.');
}

function bindEvents() {
  refs.player1Input.addEventListener('input', () => {
    validateInputs(false);
    updateTimerCardState();
    persistSession();
    queuePlayerLookup({
      inputRef: 'player1Input',
      statusRef: 'player1LookupStatus',
      mode: 'game'
    });
  });

  refs.player2Input.addEventListener('input', () => {
    validateInputs(false);
    updateTimerCardState();
    persistSession();
    queuePlayerLookup({
      inputRef: 'player2Input',
      statusRef: 'player2LookupStatus',
      mode: 'game'
    });
  });

  refs.gameSegments.addEventListener('click', (event) => {
    const button = event.target.closest('.segment[data-game]');
    if (!button) return;
    handleGameChange(button.dataset.game);
  });

  refs.typeSegments.addEventListener('click', (event) => {
    const button = event.target.closest('.segment[data-type]');
    if (!button || button.classList.contains('is-disabled')) return;
    handleTypeChange(button.dataset.type);
  });

  refs.frameTargetSegments.addEventListener('click', (event) => {
    const button = event.target.closest('.segment[data-target-value]');
    if (!button) return;

    state.frameTarget = {
      kind: button.dataset.targetType,
      value: Number(button.dataset.targetValue)
    };

    updateTypeSelectionUI();
    validateInputs(false);
    updateTimerCardState();
    updateFrameSummary();
    persistSession();
  });

  refs.timeTargetSegments.addEventListener('click', (event) => {
    const button = event.target.closest('.segment[data-duration]');
    if (!button) return;

    state.timeDuration = Number(button.dataset.duration);

    updateTypeSelectionUI();
    syncTimerModeWithType();
    validateInputs(false);
    updateTimerCardState();
    persistSession();
  });

  refs.timerModeSegments.addEventListener('click', (event) => {
    const button = event.target.closest('.segment[data-mode]');
    if (!button) return;
    setTimerMode(button.dataset.mode);
  });

  refs.startPauseBtn.addEventListener('click', handleStartPause);
  refs.stopBtn.addEventListener('click', () => handleStop(false));

  refs.resetTimeBtn.addEventListener('click', () => {
    if (!hasUnsavedProgress()) return;

    openConfirmModal('Сброс времени', 'Текущее время будет очищено. Продолжить?', () => {
      resetOnlyTime();
      refs.setResultCard.classList.add('hidden');
      refs.frameResultCard.classList.add('hidden');
      state.pendingSetResult = null;
      state.frameRows = [];
      renderFrameRows();
      updateFrameSummary();
      clearSessionState();
      showToast('Время и текущий результат сброшены.');
    });
  });

  refs.resetInputsBtn.addEventListener('click', () => {
    openConfirmModal('Сброс параметров', 'Будут очищены параметры игры и время. Продолжить?', () => {
      resetMatchState({ keepInputs: false });
      clearSessionState();
      showToast('Параметры игры очищены.');
    });
  });

  refs.repeatBtn.addEventListener('click', () => {
    if (!state.repeatState.game && !state.repeatState.player1 && !state.repeatState.player2) {
      showToast('Пока нечего повторять. Сначала завершите хотя бы одну игру.');
      return;
    }

    resetMatchState({ keepInputs: false });
    applyRepeatState();
  });

  refs.saveSetBtn.addEventListener('click', saveSetResult);
  refs.saveFrameBtn.addEventListener('click', saveFrameResult);
  refs.nextPartyBtn.addEventListener('click', handleNextParty);

  refs.abortSetBtn.addEventListener('click', () => {
    openConfirmModal('Прервать партию', 'Результат этой партии не будет записан. Продолжить?', () => {
      state.pendingSetResult = null;
      refs.setResultCard.classList.add('hidden');
      resetOnlyTime();
      clearSessionState();
      showToast('Партия прервана.');
    });
  });

  refs.abortFrameBtn.addEventListener('click', () => {
    openConfirmModal('Прервать встречу', 'Результат этой встречи не будет записан. Продолжить?', () => {
      state.frameRows = [];
      refs.frameResultCard.classList.add('hidden');
      resetOnlyTime();
      renderFrameRows();
      updateFrameSummary();
      clearSessionState();
      showToast('Встреча прервана.');
    });
  });

  refs.newGameBtn.addEventListener('click', () => {
    openConfirmModal('Новая игра', 'Текущая незавершённая игра будет очищена. Продолжить?', () => {
      resetMatchState({ keepInputs: false });
      clearSessionState();
      showToast('Можно начинать новую игру.');
    });
  });

  refs.goStatsBtn.addEventListener('click', openStatsScreen);
  refs.backToGameBtn.addEventListener('click', openGameScreen);

  refs.statsModeSegments.addEventListener('click', (event) => {
    const button = event.target.closest('.segment[data-stats-mode]');
    if (!button) return;
    state.statsMode = button.dataset.statsMode;
    updateStatsModeUI();
  });

  refs.statsReportSegments.addEventListener('click', (event) => {
    const button = event.target.closest('.segment[data-report]');
    if (!button) return;
    state.statsReport = button.dataset.report;
    updateStatsReportUI();
  });

  refs.statsPlayer1Input.addEventListener('input', () => {
    updateMatchStatsInputsState();
    setStatsLookupMessage('statsPlayer1Status', '', '');
    queuePlayerLookup({
      inputRef: 'statsPlayer1Input',
      statusRef: 'statsPlayer1Status',
      mode: 'stats'
    });
  });

  refs.statsPlayer2Input.addEventListener('input', () => {
    setStatsLookupMessage('statsPlayer2Status', '', '');
    queuePlayerLookup({
      inputRef: 'statsPlayer2Input',
      statusRef: 'statsPlayer2Status',
      mode: 'stats'
    });
  });

  refs.statsPeriodSegments.addEventListener('click', (event) => {
    const button = event.target.closest('.segment[data-period]');
    if (!button) return;
    state.matchStatsPeriod = button.dataset.period;
    updateMatchStatsPeriodUI();
  });

  refs.loadMatchStatsBtn.addEventListener('click', () => {
    void loadMatchStatsReport();
  });

  refs.matchStatsList.addEventListener('click', (event) => {
    const card = event.target.closest('.stats-item[data-match-id]');
    if (!card) return;
    setSelectedMatchStats(card.dataset.matchId);
  });

  refs.matchStatsDetail.addEventListener('click', () => {
    if (!state.selectedMatchStatsId) return;
    state.selectedMatchStatsId = null;
    renderMatchStatsResults();
  });

  refs.clearStatsBtn.addEventListener('click', () => {
    openConfirmModal('Очистить историю', 'Все локальные записи на этом устройстве будут удалены. Продолжить?', () => {
      state.statistics = [];
      clearStatisticsStorage();
      renderStatistics();
      showToast('Локальная история очищена.');
    });
  });

  refs.setScore1.addEventListener('input', () => {
    refs.setResultError.textContent = '';
    persistSession();
  });

  refs.setScore2.addEventListener('input', () => {
    refs.setResultError.textContent = '';
    persistSession();
  });

  refs.modalCancelBtn.addEventListener('click', closeConfirmModal);
  refs.modalConfirmBtn.addEventListener('click', runModalConfirm);

  refs.confirmModal.addEventListener('click', (event) => {
    if (event.target === refs.confirmModal) {
      closeConfirmModal();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      syncElapsedValuesFromTimestamp();
      persistSession();
    }
  });

  window.addEventListener('beforeunload', () => {
    syncElapsedValuesFromTimestamp();
    persistSession();
  });
}

function init() {
  state.statistics = loadStatistics();
  renderStatistics();
  updateStatsModeUI();
  updateStatsReportUI();
  updateMatchStatsInputsState();
  updateMatchStatsPeriodUI();
  renderMatchStatsResults();
  updateGameSelectionUI();
  updateTypeAvailability();
  updateTypeSelectionUI();
  syncTimerModeWithType();
  restoreSession();
  updateTimerDisplay();
  updateTimerCardState();
  queuePlayerLookup({
    inputRef: 'player1Input',
    statusRef: 'player1LookupStatus',
    mode: 'game'
  });
  queuePlayerLookup({
    inputRef: 'player2Input',
    statusRef: 'player2LookupStatus',
    mode: 'game'
  });
  bindEvents();
  void syncPendingStatistics();

  window.addEventListener('online', () => {
    void syncPendingStatistics();
  });

  console.log(getStatisticsLatestText(state.statistics));
}

init();
