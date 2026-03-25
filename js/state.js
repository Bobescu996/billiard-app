import { DEFAULT_REPEAT_STATE } from './config.js';

export const state = {
  player1: '',
  player2: '',
  game: null,
  type: null,
  frameTarget: null,
  timeDuration: null,

  timerMode: 'stopwatch',
  timerRunning: false,
  timerPaused: false,
  timerFinished: false,

  elapsedSeconds: 0,
  remainingSeconds: 0,
  currentLapTime: 0,
  timerInterval: null,

  timerStartedAt: null,
  accumulatedElapsed: 0,

  frameRows: [],
  pendingSetResult: null,
  statistics: [],
  repeatState: { ...DEFAULT_REPEAT_STATE },
  statsMode: 'history',
  statsReport: 'matches',
  matchStatsPeriod: '3m',
  matchStatsResults: [],
  selectedMatchStatsId: null,
  playerLookupCache: {},
  playersCatalog: [],
  playersCatalogLoaded: false,
  activeSuggestionMenu: null,

  timeExpired: false,
  timerCardAutoScrolled: false
};
