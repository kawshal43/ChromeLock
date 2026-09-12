/**
 * ChromeLock - Manifest V3 Background Service Worker
 * Coordinates session lifecycle, startup locking, tab interception,
 * shortcut commands, auto-lock timers, scheduled lock windows, and messaging.
 */

import { StorageService } from './scripts/storage.js';
import { CryptoService } from './scripts/crypto.js';
import { CooldownManager } from './scripts/cooldown.js';
import { LockManager } from './scripts/lock-manager.js';
import { TabManager } from './scripts/tab-manager.js';
import { AuthManager } from './scripts/auth.js';

// Setup idle detection interval (minimum supported by Chrome is 15-60s)
const IDLE_DETECTION_SECONDS = 30;

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

  // Setup periodic scheduled lock alarm
  try {
    chrome.alarms.create('check_scheduled_lock', { periodInMinutes: 1 });
  } catch (err) {
    console.warn('[ChromeLock] Alarm registration error:', err);
  }
}

/**
 * Checks if current time is within the scheduled lock window (e.g. 22:00 to 06:00).
 * @param {string} startTime - "HH:MM"
 * @param {string} endTime - "HH:MM"
 * @returns {boolean}
 */
function isTimeInWindow(startTime, endTime) {
  if (!startTime || !endTime) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [sH, sM] = startTime.split(':').map(Number);
  const [eH, eM] = endTime.split(':').map(Number);
  const startMinutes = sH * 60 + sM;
  const endMinutes = eH * 60 + eM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight window (e.g. 22:00 to 06:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
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

// 5. Idle / Inactivity Detection Listener
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

// 6. Scheduled Night / Quiet Hours Alarm Listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'check_scheduled_lock') {
    const { scheduledLock } = await StorageService.local.get('scheduledLock');
    if (scheduledLock?.enabled) {
      if (isTimeInWindow(scheduledLock.startTime, scheduledLock.endTime)) {
        const isConfigured = await AuthManager.isSetupCompleted();
        const isUnlocked = await LockManager.isUnlocked();
        if (isConfigured && isUnlocked) {
          await LockManager.lockSession();
          await TabManager.enforceLockOnAllTabs();
        }
      }
    }
  }
});

// 7. Central Message Handler
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
        const result = await AuthManager.createPassword(
          message.password,
          message.securityQuestion,
          message.securityAnswer,
          message
        );
        if (result.success) {
          await TabManager.enforceLockOnAllTabs();
        }
        return result;
      }

      case 'AUTHENTICATE': {
        const result = await AuthManager.authenticate(message.password);
        if (result.success) {
          await TabManager.restoreSavedTabs();
        }
        return result;
      }

      case 'GET_SECURITY_QUESTION': {
        return await AuthManager.getSecurityQuestion();
      }

      case 'RESET_PASSWORD_WITH_ANSWER': {
        const result = await AuthManager.resetPasswordWithSecurityAnswer(
          message.answer,
          message.newPassword
        );
        if (result.success) {
          await TabManager.restoreSavedTabs();
        }
        return result;
      }

      case 'UPDATE_SECURITY_QUESTION': {
        return await AuthManager.updateSecurityQuestion(
          message.currentPassword,
          message.newQuestion,
          message.newAnswer
        );
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

      case 'GET_POLICY': {
        return await CooldownManager.getPolicy();
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
