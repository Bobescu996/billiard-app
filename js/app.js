import { GAME_OPTIONS, TYPE_LABELS } from './config.js';
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
    repeatState: state.repeatState
  };

  const hasSessionData =
    session.player1 ||
    session.player2 ||
    session.game ||
    session.type ||
    session.frameRows.length > 0 ||
    session.pendingSetResult ||
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

function updateTimerCardState() {
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
    refs.timerHint.textContent =
      state.timerMode === 'countdown' ? 'Идёт обратный отсчёт.' : 'Секундомер запущен.';
    refs.timerStatusBadge.textContent = 'В работе';
    refs.timerStatusBadge.className = 'badge badge-success';
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
    card.innerHTML = `
      <div class="stats-item-top">
        <div>
          <div class="stats-players">${item.players}</div>
          <div class="stats-date">${item.date}</div>
        </div>
        <span class="badge badge-accent">${item.type}</span>
      </div>

      <div class="stats-meta">
        <div class="stats-meta-block">
          <span class="stats-meta-label">Игра</span>
          <span class="stats-meta-value">${item.game}</span>
        </div>
        <div class="stats-meta-block">
          <span class="stats-meta-label">Счёт</span>
          <span class="stats-meta-value">${item.score}</span>
        </div>
        <div class="stats-meta-block">
          <span class="stats-meta-label">Дополнительно</span>
          <span class="stats-meta-value">${item.extra || '—'}</span>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

function openStatsScreen() {
  renderStatistics();
  refs.gameScreen.classList.add('hidden');
  refs.statsScreen.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openGameScreen() {
  refs.statsScreen.classList.add('hidden');
  refs.gameScreen.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function createStatisticsEntry(payload) {
  const now = new Date();
  const date =
    String(now.getDate()).padStart(2, '0') +
    '.' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '.' +
    now.getFullYear();

  state.statistics.unshift({ date, ...payload });
  saveStatistics(state.statistics);
  renderStatistics();
}

function startRunningLoop() {
  clearTimerInterval();
  state.timerInterval = setInterval(() => {
    syncElapsedValuesFromTimestamp();
    updateTimerDisplay();
    persistSession();

    if (state.timerMode === 'countdown' && state.remainingSeconds <= 0) {
      clearTimerInterval();
      state.timerRunning = false;
      state.timerPaused = false;
      state.timerFinished = true;
      state.currentLapTime = state.timeDuration || 0;
      state.timerStartedAt = null;
      state.accumulatedElapsed = state.timeDuration || 0;
      updateTimerDisplay();
      updateTimerCardState();
      persistSession();
      handleStop(true);
    }
  }, 1000);
}

function startTimer() {
  if (!validateInputs(true)) {
    updateTimerCardState();
    return;
  }

  if (state.timerFinished) {
    resetOnlyTime();
  }

  if (state.timerMode === 'countdown' && state.remainingSeconds <= 0) {
    state.remainingSeconds = state.timeDuration || 0;
  }

  state.timerRunning = true;
  state.timerPaused = false;
  state.timerFinished = false;
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

    rowElement.innerHTML = `
      <div class="result-row-number">${row.partyNumber}</div>
      <div class="result-row-time">${formatTime(row.time)}</div>
      <div class="score-cell">
        <input
          class="${p1Class}"
          type="number"
          min="0"
          inputmode="numeric"
          data-row-index="${index}"
          data-player="1"
          ${row.score1 !== '' ? 'value="' + row.score1 + '"' : ''}
        />
      </div>
      <div class="score-cell">
        <input
          class="${p2Class}"
          type="number"
          min="0"
          inputmode="numeric"
          data-row-index="${index}"
          data-player="2"
          ${row.score2 !== '' ? 'value="' + row.score2 + '"' : ''}
        />
      </div>
    `;

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

    balls1 += row.score1;
    balls2 += row.score2;

    if (row.score1 > row.score2) wins1 += 1;
    if (row.score2 > row.score1) wins2 += 1;
  });

  refs.winsSummary.textContent = wins1 + ' : ' + wins2;
  refs.ballsSummary.textContent = balls1 + ' : ' + balls2;
  refs.targetSummary.textContent = getTargetLabel();

  const targetReached = state.frameTarget
    ? state.frameTarget.kind === 'wins'
      ? wins1 >= state.frameTarget.value || wins2 >= state.frameTarget.value
      : balls1 >= state.frameTarget.value || balls2 >= state.frameTarget.value
    : false;

  refs.frameStatusSummary.textContent = targetReached ? 'условие достигнуто' : 'в процессе';
  refs.nextPartyBtn.disabled = !canProceedToNextParty();
  refs.saveFrameBtn.disabled = !canSaveFrame();
  refs.currentPartyBadge.textContent = 'Текущая партия: ' + (state.frameRows.length || 1);
}

function openFrameResult(lapTime) {
  refs.frameCardTitle.textContent =
    state.type === 'time' ? 'Результат игры на время' : 'Результат встречи';

  refs.frameMetaText.textContent =
    getGameLabel() + ' · ' + TYPE_LABELS[state.type] + ' · ' + getTargetLabel();

  refs.frameResultError.textContent = '';
  refs.frameResultCard.classList.remove('hidden', 'is-disabled');
  refs.frameResultCard.classList.add('is-active');
  refs.setResultCard.classList.add('hidden');

  if (state.type === 'time') {
    state.frameRows = [
      {
        partyNumber: 1,
        time: lapTime,
        score1: '',
        score2: '',
        completed: false
      }
    ];
    refs.nextPartyBtn.classList.add('hidden');
    refs.currentPartyBadge.textContent = 'Финальный результат';
  } else if (
    state.frameRows.length === 0 ||
    state.frameRows[state.frameRows.length - 1].completed
  ) {
    state.frameRows.push({
      partyNumber: state.frameRows.length + 1,
      time: lapTime,
      score1: '',
      score2: '',
      completed: false
    });
    refs.nextPartyBtn.classList.remove('hidden');
  }

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

  const lapTime = state.timerMode === 'countdown'
    ? (state.timeDuration || 0) - state.remainingSeconds
    : state.elapsedSeconds;

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
    showToast('Время истекло. Заполните итоговый результат.');
  }

  persistSession();
}

function canProceedToNextParty() {
  if (state.type !== 'frame' || state.frameRows.length === 0) return false;
  const currentRow = state.frameRows[state.frameRows.length - 1];
  return currentRow.completed;
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

  createStatisticsEntry({
    players: state.player1 + ' vs ' + state.player2,
    game: getGameLabel(),
    type: TYPE_LABELS[state.type],
    score: score1 + ':' + score2,
    extra: 'Время ' + formatTime(state.pendingSetResult ? state.pendingSetResult.time : 0)
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

  const scoreText =
    state.type === 'frame'
      ? wins1 + ':' + wins2 + ' (' + balls1 + ':' + balls2 + ')'
      : balls1 + ':' + balls2;

  createStatisticsEntry({
    players: state.player1 + ' vs ' + state.player2,
    game: getGameLabel(),
    type: TYPE_LABELS[state.type],
    score: scoreText,
    extra: getTargetLabel()
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

function restoreSession() {
  const saved = loadSession();
  if (!saved) return;

  refs.player1Input.value = saved.player1 || '';
  refs.player2Input.value = saved.player2 || '';

  state.game = saved.game || null;
  state.type = saved.type || null;
  state.frameTarget = saved.frameTarget || null;
  state.timeDuration = saved.timeDuration || null;

  state.timerMode = saved.timerMode || 'stopwatch';
  state.timerRunning = !!saved.timerRunning;
  state.timerPaused = !!saved.timerPaused;
  state.timerFinished = !!saved.timerFinished;

  state.elapsedSeconds = saved.elapsedSeconds || 0;
  state.remainingSeconds = saved.remainingSeconds || 0;
  state.currentLapTime = saved.currentLapTime || 0;

  state.timerStartedAt = saved.timerStartedAt || null;
  state.accumulatedElapsed = saved.accumulatedElapsed || 0;

  state.frameRows = Array.isArray(saved.frameRows) ? saved.frameRows : [];
  state.pendingSetResult = saved.pendingSetResult || null;
  state.repeatState = saved.repeatState || state.repeatState;

  updateGameSelectionUI();
  updateTypeAvailability();
  updateTypeSelectionUI();

  if (state.type === 'time') {
    state.timerMode = 'countdown';
  }

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

  showToast('Незавершённая сессия восстановлена.');
}

function bindEvents() {
  refs.player1Input.addEventListener('input', () => {
    validateInputs(false);
    updateTimerCardState();
    persistSession();
  });

  refs.player2Input.addEventListener('input', () => {
    validateInputs(false);
    updateTimerCardState();
    persistSession();
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

  refs.clearStatsBtn.addEventListener('click', () => {
    openConfirmModal('Очистить статистику', 'Все сохранённые записи будут удалены. Продолжить?', () => {
      state.statistics = [];
      clearStatisticsStorage();
      renderStatistics();
      showToast('Статистика очищена.');
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
  updateGameSelectionUI();
  updateTypeAvailability();
  updateTypeSelectionUI();
  syncTimerModeWithType();
  restoreSession();
  updateTimerDisplay();
  updateTimerCardState();
  bindEvents();

  console.log(getStatisticsLatestText(state.statistics));
}

init();