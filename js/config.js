export const GAME_OPTIONS = {
  america: {
    label: 'Америка',
    allowedTypes: ['set', 'frame', 'time']
  },
  america_continue: {
    label: 'Америка с продолжением',
    allowedTypes: ['frame']
  },
  omka: {
    label: 'Омка',
    allowedTypes: ['set', 'frame', 'time']
  },
  nevka: {
    label: 'Невка',
    allowedTypes: ['set', 'frame', 'time']
  },
  moscow: {
    label: 'Москва',
    allowedTypes: ['set', 'frame', 'time']
  },
  combined: {
    label: 'Комбинированная пирамида',
    allowedTypes: ['set', 'frame', 'time']
  }
};

export const TYPE_LABELS = {
  set: 'Партия',
  frame: 'Встреча',
  time: 'На время'
};

export const DEFAULT_REPEAT_STATE = {
  player1: '',
  player2: '',
  game: null,
  type: null,
  frameTarget: null,
  timeDuration: null
};

export const GOOGLE_SHEETS_SYNC = {
  enabled: true,
  endpoint: 'https://script.google.com/macros/s/AKfycbyzd5bKYRngHIqEMxf_hIwf5fTozEILCUKMj7xzRzoKFqjOPU32IRESGuSCmbzYsb05Wg/exec',
  apiKey: 'billiard-stats-2026',
  requestTimeoutMs: 10000
};
