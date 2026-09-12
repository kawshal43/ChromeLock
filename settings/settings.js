/**
 * ChromeLock - Settings Controller
 * Handles password rotation, security question updates, lockout policy,
 * auto-lock scheduling, and dashboard preferences.
 */

import { AuthManager, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../scripts/auth.js';
import { LockManager } from '../scripts/lock-manager.js';
import { StorageService } from '../scripts/storage.js';

// DOM Elements: Password Change
const changePwdForm = document.getElementById('change-pwd-form');
const currentPasswordInput = document.getElementById('current-password');
const newPasswordInput = document.getElementById('new-password');
const confirmNewPasswordInput = document.getElementById('confirm-new-password');
const changePwdBtn = document.getElementById('change-pwd-btn');
const pwdStatus = document.getElementById('pwd-status');

// DOM Elements: Security Question
const recoverySettingsForm = document.getElementById('recovery-settings-form');
const recoveryCurrentPwd = document.getElementById('recovery-current-pwd');
const settingsQuestionSelect = document.getElementById('settings-question-select');
const settingsCustomQWrap = document.getElementById('settings-custom-q-wrap');
const settingsCustomQInput = document.getElementById('settings-custom-q-input');
const settingsAnswerInput = document.getElementById('settings-answer-input');
const saveRecoveryQBtn = document.getElementById('save-recovery-q-btn');
const recoveryQStatus = document.getElementById('recovery-q-status');

// DOM Elements: Lockout Policy
const attemptsSelect = document.getElementById('attempts-select');
const cooldownSelect = document.getElementById('cooldown-select');
const policySavedIndicator = document.getElementById('policy-saved-indicator');

// DOM Elements: Auto-Lock & Scheduled Lock
const autolockSelect = document.getElementById('autolock-select');
const scheduledLockToggle = document.getElementById('scheduled-lock-toggle');
const scheduledTimesRow = document.getElementById('scheduled-times-row');
const scheduledStartTime = document.getElementById('scheduled-start-time');
const scheduledEndTime = document.getElementById('scheduled-end-time');
const autolockSavedIndicator = document.getElementById('autolock-saved-indicator');

// DOM Elements: Dashboard Preferences
const showSecondsToggle = document.getElementById('show-seconds-toggle');
const format24hToggle = document.getElementById('format-24h-toggle');
const clockSavedIndicator = document.getElementById('clock-saved-indicator');

let isSubmitting = false;

// Eye Toggles
document.querySelectorAll('.toggle-eye-btn').forEach((btn) => {
  const targetId = btn.dataset.target;
  const targetInput = document.getElementById(targetId);
  if (!targetInput) return;

  const eyeOpen = btn.querySelector('.eye-open');
  const eyeClosed = btn.querySelector('.eye-closed');

  btn.addEventListener('click', () => {
    const isPwd = targetInput.type === 'password';
    targetInput.type = isPwd ? 'text' : 'password';

    if (isPwd) {
      eyeOpen?.classList.add('hidden');
      eyeClosed?.classList.remove('hidden');
      btn.setAttribute('aria-label', 'Hide password');
    } else {
      eyeOpen?.classList.remove('hidden');
      eyeClosed?.classList.add('hidden');
      btn.setAttribute('aria-label', 'Show password');
    }
  });
});

function showStatus(element, message, isSuccess = false) {
  element.textContent = message;
  element.className = `status-message ${isSuccess ? 'success' : ''}`;
  element.classList.remove('hidden');
}

function flashIndicator(indicatorEl) {
  indicatorEl.classList.remove('hidden');
  setTimeout(() => {
    indicatorEl.classList.add('hidden');
  }, 2000);
}

// 1. Password Change Handler
changePwdForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isSubmitting) return;

  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const confirmNewPassword = confirmNewPasswordInput.value;

  if (!currentPassword) {
    showStatus(pwdStatus, 'Please enter your current master password.');
    currentPasswordInput.focus();
    return;
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    showStatus(pwdStatus, `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    newPasswordInput.focus();
    return;
  }

  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    showStatus(pwdStatus, `New password must not exceed ${MAX_PASSWORD_LENGTH} characters.`);
    newPasswordInput.focus();
    return;
  }

  if (newPassword !== confirmNewPassword) {
    showStatus(pwdStatus, 'New passwords do not match. Please verify.');
    confirmNewPasswordInput.focus();
    return;
  }

  isSubmitting = true;
  changePwdBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CHANGE_PASSWORD',
      currentPassword,
      newPassword
    });

    if (response?.success) {
      showStatus(pwdStatus, 'Master password changed successfully!', true);
      currentPasswordInput.value = '';
      newPasswordInput.value = '';
      confirmNewPasswordInput.value = '';
    } else {
      showStatus(pwdStatus, response?.error || 'Failed to change master password.');
    }
  } catch (err) {
    console.error('[ChromeLock Settings] Error:', err);
    showStatus(pwdStatus, 'An unexpected error occurred while updating password.');
  } finally {
    isSubmitting = false;
    changePwdBtn.disabled = false;
  }
});

// 2. Security Recovery Question Handler
settingsQuestionSelect.addEventListener('change', () => {
  if (settingsQuestionSelect.value === 'custom') {
    settingsCustomQWrap.classList.remove('hidden');
    settingsCustomQInput.focus();
  } else {
    settingsCustomQWrap.classList.add('hidden');
  }
});

recoverySettingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = recoveryCurrentPwd.value;
  let question = settingsQuestionSelect.value;
  if (question === 'custom') {
    question = settingsCustomQInput.value.trim();
  }
  const answer = settingsAnswerInput.value.trim();

  if (!currentPassword) {
    showStatus(recoveryQStatus, 'Please enter your current master password.');
    recoveryCurrentPwd.focus();
    return;
  }

  if (!question || !answer) {
    showStatus(recoveryQStatus, 'Please specify both question and secret answer.');
    return;
  }

  saveRecoveryQBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'UPDATE_SECURITY_QUESTION',
      currentPassword,
      newQuestion: question,
      newAnswer: answer
    });

    if (response?.success) {
      showStatus(recoveryQStatus, 'Recovery question updated successfully!', true);
      recoveryCurrentPwd.value = '';
      settingsAnswerInput.value = '';
    } else {
      showStatus(recoveryQStatus, response?.error || 'Failed to update recovery question.');
    }
  } catch (err) {
    console.error('[ChromeLock Settings] Recovery error:', err);
    showStatus(recoveryQStatus, 'Error updating recovery question.');
  } finally {
    saveRecoveryQBtn.disabled = false;
  }
});

// 3. Lockout Policy Handler
async function saveLockoutPolicy() {
  const maxAttempts = parseInt(attemptsSelect.value, 10) || 5;
  const cooldownSeconds = parseInt(cooldownSelect.value, 10) || 30;

  await StorageService.local.set({
    lockoutPolicy: {
      maxAttempts,
      cooldownSeconds
    }
  });

  flashIndicator(policySavedIndicator);
}

attemptsSelect.addEventListener('change', saveLockoutPolicy);
cooldownSelect.addEventListener('change', saveLockoutPolicy);

// 4. Auto-Lock & Scheduled Window Handler
autolockSelect.addEventListener('change', async () => {
  const duration = parseFloat(autolockSelect.value) || 0;
  await StorageService.local.set({ autoLockDurationMinutes: duration });
  flashIndicator(autolockSavedIndicator);
});

scheduledLockToggle.addEventListener('change', async () => {
  if (scheduledLockToggle.checked) {
    scheduledTimesRow.classList.remove('hidden');
  } else {
    scheduledTimesRow.classList.add('hidden');
  }
  await saveScheduledLockConfig();
});

async function saveScheduledLockConfig() {
  const enabled = scheduledLockToggle.checked;
  const startTime = scheduledStartTime.value || '22:00';
  const endTime = scheduledEndTime.value || '06:00';

  await StorageService.local.set({
    scheduledLock: {
      enabled,
      startTime,
      endTime
    }
  });

  flashIndicator(autolockSavedIndicator);
}

scheduledStartTime.addEventListener('change', saveScheduledLockConfig);
scheduledEndTime.addEventListener('change', saveScheduledLockConfig);

// 5. Dashboard Clock Preferences Handler
async function saveClockPreferences() {
  const showSeconds = showSecondsToggle.checked;
  const is24Hour = format24hToggle.checked;

  await StorageService.local.set({
    clockSettings: {
      showSeconds,
      is24Hour
    }
  });

  flashIndicator(clockSavedIndicator);
}

showSecondsToggle.addEventListener('change', saveClockPreferences);
format24hToggle.addEventListener('change', saveClockPreferences);

// Back to Dashboard link handler
const backLink = document.querySelector('.back-link');
if (backLink) {
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = chrome.runtime.getURL('newtab/newtab.html');
  });
}

// 6. Initialize Settings Page
async function init() {
  const isConfigured = await AuthManager.isSetupCompleted();
  if (!isConfigured) {
    window.location.replace(chrome.runtime.getURL('setup/setup.html'));
    return;
  }

  const isUnlocked = await LockManager.isUnlocked();
  if (!isUnlocked) {
    window.location.replace(chrome.runtime.getURL('lock/lock.html'));
    return;
  }

  // Load Lockout Policy
  const { lockoutPolicy } = await StorageService.local.get('lockoutPolicy');
  if (lockoutPolicy) {
    if (lockoutPolicy.maxAttempts) attemptsSelect.value = lockoutPolicy.maxAttempts.toString();
    if (lockoutPolicy.cooldownSeconds) cooldownSelect.value = lockoutPolicy.cooldownSeconds.toString();
  }

  // Load Inactivity Duration
  const { autoLockDurationMinutes = 0 } = await StorageService.local.get('autoLockDurationMinutes');
  autolockSelect.value = autoLockDurationMinutes.toString();

  // Load Scheduled Lock
  const { scheduledLock } = await StorageService.local.get('scheduledLock');
  if (scheduledLock) {
    scheduledLockToggle.checked = Boolean(scheduledLock.enabled);
    if (scheduledLock.startTime) scheduledStartTime.value = scheduledLock.startTime;
    if (scheduledLock.endTime) scheduledEndTime.value = scheduledLock.endTime;
    if (scheduledLock.enabled) {
      scheduledTimesRow.classList.remove('hidden');
    }
  }

  // Load Clock Settings
  const { clockSettings } = await StorageService.local.get('clockSettings');
  if (clockSettings) {
    showSecondsToggle.checked = clockSettings.showSeconds !== false;
    format24hToggle.checked = Boolean(clockSettings.is24Hour);
  }

  // Load Current Security Question
  const qRes = await AuthManager.getSecurityQuestion();
  if (qRes?.hasQuestion && qRes.question) {
    const matchedOption = Array.from(settingsQuestionSelect.options).find((o) => o.value === qRes.question);
    if (matchedOption) {
      settingsQuestionSelect.value = qRes.question;
    } else {
      settingsQuestionSelect.value = 'custom';
      settingsCustomQWrap.classList.remove('hidden');
      settingsCustomQInput.value = qRes.question;
    }
  }
}

init();
