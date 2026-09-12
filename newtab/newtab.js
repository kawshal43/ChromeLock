/**
 * ChromeLock - New Tab Controller
 * Provides session lock verification, live seconds clock, and customizable shortcuts with real favicons.
 */

import { AuthManager } from '../scripts/auth.js';
import { LockManager } from '../scripts/lock-manager.js';
import { StorageService } from '../scripts/storage.js';

// DOM Elements
const clockTime = document.getElementById('clock-time');
const clockDate = document.getElementById('clock-date');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const quickLockBtn = document.getElementById('quick-lock-btn');
const shortcutsGrid = document.getElementById('shortcuts-grid');

// Modal Elements
const shortcutModal = document.getElementById('shortcut-modal');
const shortcutModalTitle = document.getElementById('shortcut-modal-title');
const closeShortcutModalBtn = document.getElementById('close-shortcut-modal-btn');
const shortcutForm = document.getElementById('shortcut-form');
const shortcutNameInput = document.getElementById('shortcut-name-input');
const shortcutUrlInput = document.getElementById('shortcut-url-input');
const shortcutFaviconPreview = document.getElementById('shortcut-favicon-preview');
const deleteShortcutBtn = document.getElementById('delete-shortcut-btn');

let activeEditId = null;
let clockConfig = { showSeconds: true, is24Hour: false };

const DEFAULT_SHORTCUTS = [
  { id: '1', name: 'Google', url: 'https://www.google.com' },
  { id: '2', name: 'YouTube', url: 'https://www.youtube.com' },
  { id: '3', name: 'GitHub', url: 'https://github.com' },
  { id: '4', name: 'Wikipedia', url: 'https://www.wikipedia.org' },
  { id: '5', name: 'Reddit', url: 'https://www.reddit.com' }
];

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
 * Updates the clock with live seconds and date.
 */
function updateClock() {
  const now = new Date();

  let hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');

  let timeString = '';
  if (clockConfig.is24Hour) {
    const formattedHours = hours.toString().padStart(2, '0');
    timeString = clockConfig.showSeconds ? `${formattedHours}:${minutes}:${seconds}` : `${formattedHours}:${minutes}`;
  } else {
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const formattedHours = hours.toString().padStart(2, '0');
    timeString = clockConfig.showSeconds
      ? `${formattedHours}:${minutes}:${seconds} ${ampm}`
      : `${formattedHours}:${minutes} ${ampm}`;
  }

  clockTime.textContent = timeString;

  const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
  clockDate.textContent = now.toLocaleDateString(undefined, dateOptions);
}

/**
 * Returns a high-resolution favicon URL for a given domain/URL.
 * @param {string} rawUrl
 * @returns {string}
 */
function getFaviconUrl(rawUrl) {
  try {
    const target = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const parsed = new URL(target);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=128`;
  } catch {
    return '../assets/icon32.png';
  }
}

/**
 * Loads and renders customizable shortcuts from storage.
 */
async function loadShortcuts() {
  const data = await StorageService.local.get('shortcuts');
  const shortcuts = data?.shortcuts && Array.isArray(data.shortcuts) ? data.shortcuts : DEFAULT_SHORTCUTS;

  shortcutsGrid.innerHTML = '';

  shortcuts.forEach((item) => {
    const wrap = document.createElement('div');
    wrap.className = 'shortcut-wrap';

    const link = document.createElement('a');
    link.href = item.url.startsWith('http') ? item.url : `https://${item.url}`;
    link.className = 'shortcut-item';

    const circle = document.createElement('div');
    circle.className = 'shortcut-icon-circle';

    const img = document.createElement('img');
    img.className = 'real-favicon';
    img.src = getFaviconUrl(item.url);
    img.alt = item.name;

    // Fallback if image fails to load
    img.onerror = () => {
      img.style.display = 'none';
      circle.textContent = (item.name || 'S').charAt(0).toUpperCase();
      circle.style.fontWeight = '700';
      circle.style.color = '#3b82f6';
    };

    circle.appendChild(img);

    const label = document.createElement('span');
    label.className = 'shortcut-label';
    label.textContent = item.name;

    link.appendChild(circle);
    link.appendChild(label);
    wrap.appendChild(link);

    // Edit Button on hover
    const editBtn = document.createElement('button');
    editBtn.className = 'shortcut-edit-btn';
    editBtn.title = 'Edit shortcut';
    editBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
      </svg>
    `;
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openShortcutModal(item);
    });

    wrap.appendChild(editBtn);
    shortcutsGrid.appendChild(wrap);
  });

  // Add "+" Shortcut Button
  const addWrap = document.createElement('div');
  addWrap.className = 'shortcut-wrap';

  const addBtn = document.createElement('div');
  addBtn.className = 'shortcut-item add-shortcut-item';
  addBtn.innerHTML = `
    <div class="shortcut-icon-circle add-icon-circle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </div>
    <span class="shortcut-label">Add Shortcut</span>
  `;
  addBtn.addEventListener('click', () => openShortcutModal());

  addWrap.appendChild(addBtn);
  shortcutsGrid.appendChild(addWrap);
}

/**
 * Opens shortcut modal for Adding or Editing.
 * @param {Object} [shortcut]
 */
function openShortcutModal(shortcut = null) {
  if (shortcut) {
    activeEditId = shortcut.id;
    shortcutModalTitle.textContent = 'Edit Shortcut';
    shortcutNameInput.value = shortcut.name;
    shortcutUrlInput.value = shortcut.url;
    shortcutFaviconPreview.src = getFaviconUrl(shortcut.url);
    deleteShortcutBtn.classList.remove('hidden');
  } else {
    activeEditId = null;
    shortcutModalTitle.textContent = 'Add Shortcut';
    shortcutNameInput.value = '';
    shortcutUrlInput.value = '';
    shortcutFaviconPreview.src = '../assets/icon32.png';
    deleteShortcutBtn.classList.add('hidden');
  }
  shortcutModal.classList.remove('hidden');
  shortcutNameInput.focus();
}

function closeShortcutModal() {
  shortcutModal.classList.add('hidden');
  activeEditId = null;
}

// Live Favicon Preview as user types URL
shortcutUrlInput.addEventListener('input', () => {
  const url = shortcutUrlInput.value.trim();
  if (url) {
    shortcutFaviconPreview.src = getFaviconUrl(url);
  } else {
    shortcutFaviconPreview.src = '../assets/icon32.png';
  }
});

// Save Shortcut
shortcutForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = shortcutNameInput.value.trim();
  let url = shortcutUrlInput.value.trim();

  if (!name || !url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  const data = await StorageService.local.get('shortcuts');
  let shortcuts = data?.shortcuts && Array.isArray(data.shortcuts) ? data.shortcuts : [...DEFAULT_SHORTCUTS];

  if (activeEditId) {
    shortcuts = shortcuts.map((s) => (s.id === activeEditId ? { ...s, name, url } : s));
  } else {
    shortcuts.push({
      id: Date.now().toString(),
      name,
      url
    });
  }

  await StorageService.local.set({ shortcuts });
  closeShortcutModal();
  await loadShortcuts();
});

// Delete Shortcut
deleteShortcutBtn.addEventListener('click', async () => {
  if (!activeEditId) return;
  const data = await StorageService.local.get('shortcuts');
  let shortcuts = data?.shortcuts && Array.isArray(data.shortcuts) ? data.shortcuts : [...DEFAULT_SHORTCUTS];

  shortcuts = shortcuts.filter((s) => s.id !== activeEditId);
  await StorageService.local.set({ shortcuts });
  closeShortcutModal();
  await loadShortcuts();
});

closeShortcutModalBtn.addEventListener('click', closeShortcutModal);

// Search bar handler
searchForm.addEventListener('submit', (e) => {
  const query = (searchInput.value || '').trim();
  if (!query) {
    e.preventDefault();
    return;
  }

  if (/^https?:\/\//i.test(query)) {
    e.preventDefault();
    window.location.href = query;
  } else if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(query)) {
    e.preventDefault();
    window.location.href = `https://${query}`;
  }
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

// Load preferences and initialize
(async () => {
  await verifySession();

  const { clockSettings } = await StorageService.local.get('clockSettings');
  if (clockSettings) {
    clockConfig = { ...clockConfig, ...clockSettings };
  }

  updateClock();
  setInterval(updateClock, 1000);
  await loadShortcuts();
})();
