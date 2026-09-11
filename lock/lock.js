/**
 * ChromeLock - Lock Screen UI Controller
 * Manages master password authentication, cooldown countdown,
 * visibility toggles, and cross-tab synchronization.
 */

import { AuthManager } from '../scripts/auth.js';
import { CooldownManager } from '../scripts/cooldown.js';
import { LockManager } from '../scripts/lock-manager.js';
import { StorageService } from '../scripts/storage.js';

// DOM Elements
const lockCard = document.querySelector('.lock-card');
const lockForm = document.getElementById('lock-form');
const passwordInput = document.getElementById('password-input');
const toggleEyeBtn = document.getElementById('toggle-visibility-btn');
const eyeOpenIcon = document.querySelector('.eye-open');
const eyeClosedIcon = document.querySelector('.eye-closed');
const unlockBtn = document.getElementById('unlock-btn');
const statusMessage = document.getElementById('status-message');
const cooldownBanner = document.getElementById('cooldown-banner');
const countdownDisplay = document.getElementById('countdown-display');

let countdownInterval = null;
let isSubmitting = false;

/**
 * Parses query parameters from current window URL.
 * @returns {URLSearchParams}
 */
function getQueryParams() {
  return new URLSearchParams(window.location.search);
}

/**
 * Redirects away from lock screen upon successful unlock.
 */
function handleUnlockedNavigation() {
  const params = getQueryParams();
  const redirectTarget = params.get('redirect');

  if (redirectTarget && (redirectTarget.startsWith('http://') || redirectTarget.startsWith('https://'))) {
    window.location.replace(redirectTarget);
  } else {
    // Navigate to standard browsing
    window.location.replace('https://www.google.com');
  }
}

/**
 * Formats seconds into MM:SS format (e.g. 30 -> 00:30).
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatTime(totalSeconds) {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60).toString().padStart(2, '0');
  const seconds = (clamped % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * Sets the cooldown UI state and runs the live 1-second countdown timer.
 * @param {number} remainingMs
 */
function startCooldownTimer(remainingMs) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  // Disable all inputs
  passwordInput.disabled = true;
  passwordInput.value = '';
  toggleEyeBtn.disabled = true;
  unlockBtn.disabled = true;

  // Show cooldown banner and hide error messages
  statusMessage.classList.add('hidden');
  statusMessage.textContent = '';
  cooldownBanner.classList.remove('hidden');

  let remainingSeconds = Math.ceil(remainingMs / 1000);
  countdownDisplay.textContent = formatTime(remainingSeconds);

  countdownInterval = setInterval(async () => {
    remainingSeconds -= 1;
    if (remainingSeconds <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      await endCooldown();
    } else {
      countdownDisplay.textContent = formatTime(remainingSeconds);
    }
  }, 1000);
}

/**
 * Ends cooldown mode, re-enabling password authentication.
 */
async function endCooldown() {
  // Clear persistent cooldown timestamp
  await CooldownManager.reset();

  cooldownBanner.classList.add('hidden');
  passwordInput.disabled = false;
  toggleEyeBtn.disabled = false;
  unlockBtn.disabled = false;

  passwordInput.value = '';
  passwordInput.focus();
}

/**
 * Displays an error status message and triggers a subtle card shake.
 * @param {string} message
 */
function showError(message) {
  statusMessage.textContent = message;
  statusMessage.classList.remove('hidden');

  lockCard.classList.remove('shake');
  // Trigger reflow to restart shake animation
  void lockCard.offsetWidth;
  lockCard.classList.add('shake');

  passwordInput.value = '';
  passwordInput.focus();
}

/**
 * Toggles password field visibility between text and password.
 */
function togglePasswordVisibility() {
  const isCurrentlyPassword = passwordInput.type === 'password';
  passwordInput.type = isCurrentlyPassword ? 'text' : 'password';

  if (isCurrentlyPassword) {
    eyeOpenIcon.classList.add('hidden');
    eyeClosedIcon.classList.remove('hidden');
    toggleEyeBtn.setAttribute('aria-label', 'Hide password');
  } else {
    eyeOpenIcon.classList.remove('hidden');
    eyeClosedIcon.classList.add('hidden');
    toggleEyeBtn.setAttribute('aria-label', 'Show password');
  }
}

/**
 * Handles master password submission.
 */
async function handleAuthentication(e) {
  e.preventDefault();
  if (isSubmitting || passwordInput.disabled) return;

  const password = passwordInput.value;
  if (!password) {
    showError('Please enter your password.');
    return;
  }

  isSubmitting = true;
  unlockBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'AUTHENTICATE',
      password
    });

    if (response?.success) {
      // Correct password!
      handleUnlockedNavigation();
      return;
    }

    // Authentication failed
    if (response?.inCooldown || response?.error === 'COOLDOWN_ACTIVE') {
      startCooldownTimer(response.remainingMs || 30000);
    } else {
      showError('Incorrect password.');
    }
  } catch (err) {
    console.error('[ChromeLock] Auth error:', err);
    showError('Authentication error. Please try again.');
  } finally {
    isSubmitting = false;
    if (!passwordInput.disabled) {
      unlockBtn.disabled = false;
    }
  }
}

/**
 * Synchronizes lock screen state on load and when tab gains focus.
 */
async function syncLockState() {
  // 1. Verify setup status
  const isConfigured = await AuthManager.isSetupCompleted();
  if (!isConfigured) {
    window.location.replace(chrome.runtime.getURL('setup/setup.html'));
    return;
  }

  // 2. Check if already unlocked in this session
  const isUnlocked = await LockManager.isUnlocked();
  if (isUnlocked) {
    handleUnlockedNavigation();
    return;
  }

  // 3. Check for active cooldown (restart-safe evaluation)
  const cooldown = await CooldownManager.checkStatus();
  if (cooldown.inCooldown) {
    startCooldownTimer(cooldown.remainingMs);
  } else {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    cooldownBanner.classList.add('hidden');
    passwordInput.disabled = false;
    toggleEyeBtn.disabled = false;
    unlockBtn.disabled = false;
    passwordInput.focus();
  }
}

// Event Listeners
lockForm.addEventListener('submit', handleAuthentication);
toggleEyeBtn.addEventListener('click', togglePasswordVisibility);

// Listen for unlocks or relocks from other tabs
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'LOCK_STATE_CHANGED') {
    if (message.isUnlocked) {
      handleUnlockedNavigation();
    } else {
      syncLockState();
    }
  }
});

// Sync on visibility change (e.g. user switches tabs or reopens window)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    syncLockState();
  }
});

// Initial load
syncLockState();

