/**
 * ChromeLock - Settings Controller
 * Handles master password rotation and auto-lock preferences.
 */

import { AuthManager, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../scripts/auth.js';
import { LockManager } from '../scripts/lock-manager.js';
import { StorageService } from '../scripts/storage.js';

// DOM Elements
const changePwdForm = document.getElementById('change-pwd-form');
const currentPasswordInput = document.getElementById('current-password');
const newPasswordInput = document.getElementById('new-password');
const confirmNewPasswordInput = document.getElementById('confirm-new-password');
const changePwdBtn = document.getElementById('change-pwd-btn');
const pwdStatus = document.getElementById('pwd-status');

const autolockSelect = document.getElementById('autolock-select');
const autolockSavedIndicator = document.getElementById('autolock-saved-indicator');

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
      eyeOpen.classList.add('hidden');
      eyeClosed.classList.remove('hidden');
      btn.setAttribute('aria-label', 'Hide password');
    } else {
      eyeOpen.classList.remove('hidden');
      eyeClosed.classList.add('hidden');
      btn.setAttribute('aria-label', 'Show password');
    }
  });
});

function showPwdStatus(message, isSuccess = false) {
  pwdStatus.textContent = message;
  pwdStatus.className = `status-message ${isSuccess ? 'success' : ''}`;
  pwdStatus.classList.remove('hidden');
}

// Change Password Handler
changePwdForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isSubmitting) return;

  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const confirmNewPassword = confirmNewPasswordInput.value;

  if (!currentPassword) {
    showPwdStatus('Please enter your current master password.');
    currentPasswordInput.focus();
    return;
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    showPwdStatus(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    newPasswordInput.focus();
    return;
  }

  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    showPwdStatus(`New password must not exceed ${MAX_PASSWORD_LENGTH} characters.`);
    newPasswordInput.focus();
    return;
  }

  if (newPassword !== confirmNewPassword) {
    showPwdStatus('New passwords do not match. Please verify.');
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
      showPwdStatus('Master password changed successfully!', true);
      currentPasswordInput.value = '';
      newPasswordInput.value = '';
      confirmNewPasswordInput.value = '';
    } else {
      showPwdStatus(response?.error || 'Failed to change master password.');
    }
  } catch (err) {
    console.error('[ChromeLock Settings] Error:', err);
    showPwdStatus('An unexpected error occurred while updating password.');
  } finally {
    isSubmitting = false;
    changePwdBtn.disabled = false;
  }
});

// Inactivity Auto-Lock Handler
autolockSelect.addEventListener('change', async () => {
  const duration = parseInt(autolockSelect.value, 10) || 0;
  await StorageService.local.set({ autoLockDurationMinutes: duration });

  autolockSavedIndicator.classList.remove('hidden');
  setTimeout(() => {
    autolockSavedIndicator.classList.add('hidden');
  }, 2000);
});

// Guard & State Initialization
async function init() {
  const isConfigured = await AuthManager.isSetupCompleted();
  if (!isConfigured) {
    window.location.replace(chrome.runtime.getURL('setup/setup.html'));
    return;
  }

  const isUnlocked = await LockManager.isUnlocked();
  if (!isUnlocked) {
    // If locked, settings are strictly forbidden
    window.location.replace(chrome.runtime.getURL('lock/lock.html'));
    return;
  }

  // Load existing auto-lock preference
  const { autoLockDurationMinutes = 0 } = await StorageService.local.get('autoLockDurationMinutes');
  autolockSelect.value = autoLockDurationMinutes.toString();
}

init();

