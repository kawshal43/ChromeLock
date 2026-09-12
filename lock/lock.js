/**
 * ChromeLock - Lock Screen UI Controller
 * Manages master password authentication, cooldown countdown,
 * security question recovery, visibility toggles, and cross-tab synchronization.
 */

import { AuthManager, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../scripts/auth.js';
import { CooldownManager } from '../scripts/cooldown.js';
import { LockManager } from '../scripts/lock-manager.js';

// Main Form DOM Elements
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

// Recovery Modal DOM Elements
const forgotPasswordBtn = document.getElementById('forgot-password-btn');
const recoveryModal = document.getElementById('recovery-modal');
const closeRecoveryBtn = document.getElementById('close-recovery-btn');
const displaySecurityQuestion = document.getElementById('display-security-question');
const recoveryForm = document.getElementById('recovery-form');
const recoveryAnswerInput = document.getElementById('recovery-answer-input');
const recoveryNewPwdInput = document.getElementById('recovery-new-pwd-input');
const recoveryConfirmPwdInput = document.getElementById('recovery-confirm-pwd-input');
const submitRecoveryBtn = document.getElementById('submit-recovery-btn');
const recoveryStatusMessage = document.getElementById('recovery-status-message');

const toggleRecoveryAnswerBtn = document.getElementById('toggle-recovery-answer-btn');
const toggleRecoveryNewPwdBtn = document.getElementById('toggle-recovery-new-pwd-btn');
const toggleRecoveryConfirmPwdBtn = document.getElementById('toggle-recovery-confirm-pwd-btn');

let countdownInterval = null;
let isSubmitting = false;
let isRecovering = false;

/**
 * Parses query parameters from current window URL.
 * @returns {URLSearchParams}
 */
function getQueryParams() {
  return new URLSearchParams(window.location.search);
}

/**
 * Redirects away from lock screen upon successful unlock.
 * Strictly redirects to the dashboard screen (newtab.html) unless an active web URL was intercepted.
 */
function handleUnlockedNavigation() {
  const params = getQueryParams();
  const redirectTarget = params.get('redirect');

  if (redirectTarget && (redirectTarget.startsWith('http://') || redirectTarget.startsWith('https://'))) {
    window.location.replace(redirectTarget);
  } else {
    // Navigate directly to ChromeLock dashboard
    window.location.replace(chrome.runtime.getURL('newtab/newtab.html'));
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
  await CooldownManager.reset();

  cooldownBanner.classList.add('hidden');
  passwordInput.disabled = false;
  toggleEyeBtn.disabled = false;
  unlockBtn.disabled = false;

  passwordInput.value = '';
  passwordInput.focus();
}

/**
 * Displays an error status message and triggers a card shake.
 * @param {string} message
 */
function showError(message) {
  statusMessage.textContent = message;
  statusMessage.classList.remove('hidden');

  lockCard.classList.remove('shake');
  void lockCard.offsetWidth;
  lockCard.classList.add('shake');

  passwordInput.value = '';
  passwordInput.focus();
}

/**
 * Toggles password field visibility.
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

function setupToggle(inputEl, btnEl) {
  if (!inputEl || !btnEl) return;
  const eyeOpen = btnEl.querySelector('.eye-open');
  const eyeClosed = btnEl.querySelector('.eye-closed');

  btnEl.addEventListener('click', () => {
    const isPwd = inputEl.type === 'password';
    inputEl.type = isPwd ? 'text' : 'password';

    if (isPwd) {
      eyeOpen?.classList.add('hidden');
      eyeClosed?.classList.remove('hidden');
      btnEl.setAttribute('aria-label', 'Hide password');
    } else {
      eyeOpen?.classList.remove('hidden');
      eyeClosed?.classList.add('hidden');
      btnEl.setAttribute('aria-label', 'Show password');
    }
  });
}

setupToggle(recoveryAnswerInput, toggleRecoveryAnswerBtn);
setupToggle(recoveryNewPwdInput, toggleRecoveryNewPwdBtn);
setupToggle(recoveryConfirmPwdInput, toggleRecoveryConfirmPwdBtn);

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
      handleUnlockedNavigation();
      return;
    }

    // Authentication failed
    if (response?.inCooldown || response?.error === 'COOLDOWN_ACTIVE') {
      startCooldownTimer(response.remainingMs || 30000);
    } else {
      const attemptsRemaining = response?.attemptsLeft;
      if (typeof attemptsRemaining === 'number' && attemptsRemaining > 0) {
        showError(`Incorrect password. (${attemptsRemaining} attempt${attemptsRemaining > 1 ? 's' : ''} left)`);
      } else {
        showError('Incorrect password.');
      }
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
 * Opens the Forgot Password recovery modal.
 */
async function openRecoveryModal() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SECURITY_QUESTION' });
    if (!response?.hasQuestion || !response.question) {
      showError('No recovery question is configured for this profile.');
      return;
    }

    displaySecurityQuestion.textContent = response.question;
    recoveryAnswerInput.value = '';
    recoveryNewPwdInput.value = '';
    recoveryConfirmPwdInput.value = '';
    recoveryStatusMessage.classList.add('hidden');
    recoveryStatusMessage.textContent = '';

    recoveryModal.classList.remove('hidden');
    recoveryAnswerInput.focus();
  } catch (err) {
    console.error('[ChromeLock] Recovery error:', err);
    showError('Could not load recovery options.');
  }
}

function closeRecoveryModal() {
  recoveryModal.classList.add('hidden');
  passwordInput.focus();
}

/**
 * Handles security question password reset.
 */
async function handleRecoverySubmit(e) {
  e.preventDefault();
  if (isRecovering) return;

  const answer = recoveryAnswerInput.value.trim();
  const newPassword = recoveryNewPwdInput.value;
  const confirmNewPassword = recoveryConfirmPwdInput.value;

  if (!answer) {
    showRecoveryError('Please enter your secret answer.');
    recoveryAnswerInput.focus();
    return;
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    showRecoveryError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    recoveryNewPwdInput.focus();
    return;
  }

  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    showRecoveryError(`New password must not exceed ${MAX_PASSWORD_LENGTH} characters.`);
    recoveryNewPwdInput.focus();
    return;
  }

  if (newPassword !== confirmNewPassword) {
    showRecoveryError('New passwords do not match. Please verify.');
    recoveryConfirmPwdInput.focus();
    return;
  }

  isRecovering = true;
  submitRecoveryBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'RESET_PASSWORD_WITH_ANSWER',
      answer,
      newPassword
    });

    if (response?.success) {
      recoveryModal.classList.add('hidden');
      handleUnlockedNavigation();
      return;
    }

    if (response?.inCooldown || response?.error === 'COOLDOWN_ACTIVE') {
      recoveryModal.classList.add('hidden');
      startCooldownTimer(response.remainingMs || 30000);
      showError('Too many failed attempts. Account locked.');
    } else {
      showRecoveryError('Incorrect secret answer. Please try again.');
      recoveryAnswerInput.value = '';
      recoveryAnswerInput.focus();
    }
  } catch (err) {
    console.error('[ChromeLock] Recovery submit error:', err);
    showRecoveryError('An error occurred during password reset.');
  } finally {
    isRecovering = false;
    submitRecoveryBtn.disabled = false;
  }
}

function showRecoveryError(msg) {
  recoveryStatusMessage.textContent = msg;
  recoveryStatusMessage.classList.remove('hidden');
}

/**
 * Synchronizes lock screen state on load and when tab gains focus.
 */
async function syncLockState() {
  const isConfigured = await AuthManager.isSetupCompleted();
  if (!isConfigured) {
    window.location.replace(chrome.runtime.getURL('setup/setup.html'));
    return;
  }

  const isUnlocked = await LockManager.isUnlocked();
  if (isUnlocked) {
    handleUnlockedNavigation();
    return;
  }

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

forgotPasswordBtn.addEventListener('click', openRecoveryModal);
closeRecoveryBtn.addEventListener('click', closeRecoveryModal);
recoveryForm.addEventListener('submit', handleRecoverySubmit);

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !recoveryModal.classList.contains('hidden')) {
    closeRecoveryModal();
  }
});

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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    syncLockState();
  }
});

// Initial load
syncLockState();
