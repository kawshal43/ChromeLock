/**
 * ChromeLock - Manifest V3 Background Service Worker
 * Coordinates session lifecycle, startup locking, tab interception,
 * shortcut commands, and messaging.
 */

import { StorageService } from './scripts/storage.js';
import { CryptoService } from './scripts/crypto.js';
import { CooldownManager } from './scripts/cooldown.js';
import { LockManager } from './scripts/lock-manager.js';
import { TabManager } from './scripts/tab-manager.js';
import { AuthManager } from './scripts/auth.js';

// Setup idle detection intervals
const IDLE_DETECTION_SECONDS = 60; // minimum supported by Chrome idle API

/**
 * Ensures fail-closed state initialization whenever the service worker boots.
 */
async function initializeState() {
  const isConfigured = await AuthManager.isSetupCompleted();
  if (!isConfigured) {
    return;
  }

  // Session state defaults to locked if not explicitly unlocked
  const isUnlocked = await LockManager.isUnlocked();
  if (!isUnlocked) {
    await TabManager.enforceLockOnAllTabs();
  }
}

// 1. Extension Installed or Updated
chrome.runtime.onInstalled.addListener(async (details) => {
  const isConfigured = await AuthManager.isSetupCompleted();
  if (!isConfigured) {
    // Open initial setup page
    await chrome.tabs.create({ url: TabManager.getSetupUrl(), active: true });
  } else {
    await LockManager.setUnlocked(false);
    await TabManager.enforceLockOnAllTabs();
  }
});

// 2. Chrome Browser Starts (New Profile Session)
chrome.runtime.onStartup.addListener(async () => {
  // Wipe any residual session state; every fresh Chrome launch MUST be locked
  await StorageService.session.clear();
  await LockManager.setUnlocked(false);

  const isConfigured = await AuthManager.isSetupCompleted();
  if (!isConfigured) {
    await chrome.tabs.create({ url: TabManager.getSetupUrl(), active: true });
  } else {
    // Enforce lock screen across all restored or initial tabs
    await TabManager.enforceLockOnAllTabs();
  }
});

// 3. Tab Navigation & Creation Listeners
chrome.tabs.onCreated.addListener(async (tab) => {
  await TabManager.enforceOnTab(tab);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Check on URL changes or tab completions
  if (changeInfo.url || changeInfo.status === 'loading') {
    await TabManager.enforceOnTab(tab);
  }
});

// 4. Keyboard Command Listener (Ctrl+Shift+L)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'lock_chrome') {
    const isConfigured = await AuthManager.isSetupCompleted();
    if (isConfigured) {
      await LockManager.lockSession();
      await TabManager.enforceLockOnAllTabs();
    }
  }
});

// 5. Idle / Auto-Lock Listener
try {
  if (chrome.idle?.onStateChanged) {
    chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
    chrome.idle.onStateChanged.addListener(async (newState) => {
      if (newState === 'idle' || newState === 'locked') {
        const { autoLockDurationMinutes = 0 } = await StorageService.local.get('autoLockDurationMinutes');
        if (autoLockDurationMinutes > 0) {
          const isConfigured = await AuthManager.isSetupCompleted();
          const isUnlocked = await LockManager.isUnlocked();
          if (isConfigured && isUnlocked) {
            await LockManager.lockSession();
            await TabManager.enforceLockOnAllTabs();
          }
        }
      }
    });
  }
} catch (err) {
  console.warn('[ChromeLock] Idle detection not available:', err);
}

// 6. Central Message Handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  (async () => {
    switch (message.type) {
      case 'GET_LOCK_STATUS': {
        const isSetupCompleted = await AuthManager.isSetupCompleted();
        const isUnlocked = await LockManager.isUnlocked();
        const cooldown = await CooldownManager.checkStatus();
        return {
          isSetupCompleted,
          isUnlocked,
          cooldown
        };
      }

      case 'CREATE_PASSWORD': {
        const result = await AuthManager.createPassword(message.password);
        if (result.success) {
          await TabManager.enforceLockOnAllTabs();
        }
        return result;
      }

      case 'AUTHENTICATE': {
        const result = await AuthManager.authenticate(message.password);
        if (result.success) {
          // Restore user's tabs
          await TabManager.restoreSavedTabs();
        }
        return result;
      }

      case 'CHANGE_PASSWORD': {
        return await AuthManager.changePassword(message.currentPassword, message.newPassword);
      }

      case 'LOCK_NOW': {
        await LockManager.lockSession();
        await TabManager.enforceLockOnAllTabs();
        return { success: true };
      }

      case 'CHECK_COOLDOWN': {
        return await CooldownManager.checkStatus();
      }

      default:
        return { error: 'UNKNOWN_MESSAGE_TYPE' };
    }
  })()
    .then(sendResponse)
    .catch((err) => {
      console.error('[ChromeLock ServiceWorker] Message error:', err);
      sendResponse({ success: false, error: err.message });
    });

  // Keep message channel open for async response
  return true;
});

// Boot-time enforcement check
initializeState();

