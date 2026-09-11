/**
 * ChromeLock - New Tab Controller
 * Ensures fail-closed lock enforcement on Ctrl+T.
 * Renders a clean minimalist dashboard when unlocked.
 */

import { AuthManager } from '../scripts/auth.js';
import { LockManager } from '../scripts/lock-manager.js';

const clockTime = document.getElementById('clock-time');
const clockDate = document.getElementById('clock-date');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const quickLockBtn = document.getElementById('quick-lock-btn');

/**
 * Checks lock status. If locked, redirects immediately to lock screen.
 */
async function verifySession() {
  const isConfigured = await AuthManager.isSetupCompleted();
  if (!isConfigured) {
    window.location.replace(chrome.runtime.getURL('setup/setup.html'));
    return;
  }

  const isUnlocked = await LockManager.isUnlocked();
  if (!isUnlocked) {
    window.location.replace(chrome.runtime.getURL('lock/lock.html'));
  }
}

/**
 * Updates the clock and date widget every second.
 */
function updateClock() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  clockTime.textContent = `${hours}:${minutes}`;

  const options = { weekday: 'long', month: 'long', day: 'numeric' };
  clockDate.textContent = now.toLocaleDateString(undefined, options);
}

// Search bar handler
searchForm.addEventListener('submit', (e) => {
  const query = (searchInput.value || '').trim();
  if (!query) {
    e.preventDefault();
    return;
  }

  // If user entered a direct web address
  if (/^https?:\/\//i.test(query)) {
    e.preventDefault();
    window.location.href = query;
  } else if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(query)) {
    e.preventDefault();
    window.location.href = `https://${query}`;
  }
  // Otherwise standard Google GET submission continues
});

// Quick Lock button
quickLockBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'LOCK_NOW' });
  window.location.replace(chrome.runtime.getURL('lock/lock.html'));
});

// Listen for lock broadcasts from other windows or keyboard shortcuts
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'LOCK_STATE_CHANGED' && !message.isUnlocked) {
    window.location.replace(chrome.runtime.getURL('lock/lock.html'));
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    verifySession();
  }
});

// Initialize
verifySession();
updateClock();
setInterval(updateClock, 1000);

