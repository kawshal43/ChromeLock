/**
 * ChromeLock - Toolbar Popup Controller
 */

import { AuthManager } from '../scripts/auth.js';
import { LockManager } from '../scripts/lock-manager.js';

// DOM Elements
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');

const unlockedView = document.getElementById('unlocked-view');
const lockedView = document.getElementById('locked-view');
const setupView = document.getElementById('setup-view');

const lockNowBtn = document.getElementById('lock-now-btn');
const openLockBtn = document.getElementById('open-lock-btn');
const openSetupBtn = document.getElementById('open-setup-btn');

/**
 * Updates the popup interface based on current security state.
 */
async function refreshState() {
  const isConfigured = await AuthManager.isSetupCompleted();
  if (!isConfigured) {
    statusBadge.className = 'badge locked';
    statusText.textContent = 'Setup Needed';

    setupView.classList.remove('hidden');
    unlockedView.classList.add('hidden');
    lockedView.classList.add('hidden');
    return;
  }

  const isUnlocked = await LockManager.isUnlocked();
  if (isUnlocked) {
    statusBadge.className = 'badge unlocked';
    statusText.textContent = 'Unlocked';

    unlockedView.classList.remove('hidden');
    lockedView.classList.add('hidden');
    setupView.classList.add('hidden');
  } else {
    statusBadge.className = 'badge locked';
    statusText.textContent = 'Locked';

    lockedView.classList.remove('hidden');
    unlockedView.classList.add('hidden');
    setupView.classList.add('hidden');
  }
}

// Lock Now Action
lockNowBtn.addEventListener('click', async () => {
  try {
    await LockManager.lockSession();
  } catch {}
  try {
    await chrome.runtime.sendMessage({ type: 'LOCK_NOW' });
  } catch {}
  window.close();
});

// Settings Link
const openSettingsLink = document.getElementById('open-settings-link');
if (openSettingsLink) {
  openSettingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
    }
    window.close();
  });
}

// Go to Lock Screen Action
openLockBtn.addEventListener('click', async () => {
  const lockUrl = chrome.runtime.getURL('lock/lock.html');
  const tabs = await chrome.tabs.query({});
  const existingLockTab = tabs.find((t) => t.url && t.url.startsWith(lockUrl));

  if (existingLockTab && existingLockTab.id) {
    await chrome.tabs.update(existingLockTab.id, { active: true });
    if (existingLockTab.windowId) {
      await chrome.windows.update(existingLockTab.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: lockUrl, active: true });
  }
  window.close();
});

// Go to Setup Action
openSetupBtn.addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('setup/setup.html'), active: true });
  window.close();
});

// Initialize
refreshState();

