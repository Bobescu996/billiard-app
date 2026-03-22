import { refs } from './dom.js';

let toastTimeout = null;
let modalConfirmHandler = null;

export function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

export function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add('show');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    refs.toast.classList.remove('show');
  }, 2600);
}

export function openConfirmModal(title, text, onConfirm) {
  refs.modalTitle.textContent = title;
  refs.modalText.textContent = text;
  refs.confirmModal.classList.remove('hidden');
  modalConfirmHandler = onConfirm;
}

export function closeConfirmModal() {
  refs.confirmModal.classList.add('hidden');
  modalConfirmHandler = null;
}

export function runModalConfirm() {
  if (typeof modalConfirmHandler === 'function') {
    modalConfirmHandler();
  }
  closeConfirmModal();
}

export function getStatisticsLatestText(statistics) {
  if (!statistics.length) return 'Статистика пока пуста.';
  const latest = statistics[0];
  return 'Последняя запись: ' + latest.date + ' · ' + latest.players + ' · ' + latest.score;
}