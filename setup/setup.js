/**
 * ChromeLock - Setup Controller
 * Handles initial master password creation, validation, and transition into LOCKED state.
 */

import { AuthManager, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../scripts/auth.js';

// DOM Elements
const setupCard = document.querySelector('.lock-card');
const setupForm = document.getElementById('setup-form');
const passwordInput = document.getElementById('password-input');
const confirmPasswordInput = document.getElementById('confirm-password-input');
const togglePwdBtn = document.getElementById('toggle-pwd-btn');
const toggleConfirmPwdBtn = document.getElementById('toggle-confirm-pwd-btn');
const createLockBtn = document.getElementById('create-lock-btn');
const statusMessage = document.getElementById('status-message');

let isSubmitting = false;

function setupToggle(inputEl, btnEl) {
  const eyeOpen = btnEl.querySelector('.eye-open');
  const eyeClosed = btnEl.querySelector('.eye-closed');

  btnEl.addEventListener('click', () => {
    const isPwd = inputEl.type === 'password';
    inputEl.type = isPwd ? 'text' : 'password';

    if (isPwd) {
      eyeOpen.classList.add('hidden');
      eyeClosed.classList.remove('hidden');
      btnEl.setAttribute('aria-label', 'Hide password');
    } else {
      eyeOpen.classList.remove('hidden');
      eyeClosed.classList.add('hidden');
      btnEl.setAttribute('aria-label', 'Show password');
    }
  });
}

setupToggle(passwordInput, togglePwdBtn);
setupToggle(confirmPasswordInput, toggleConfirmPwdBtn);

function showError(message) {
  statusMessage.textContent = message;
  statusMessage.className = 'status-message';
  statusMessage.classList.remove('hidden');

  setupCard.classList.remove('shake');
  void setupCard.offsetWidth;
  setupCard.classList.add('shake');
}

function showSuccess(message) {
  statusMessage.textContent = message;
  statusMessage.className = 'status-message success';
  statusMessage.classList.remove('hidden');
}

async function handleSetup(e) {
  e.preventDefault();
  if (isSubmitting) return;

  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  // Validation
  if (!password) {
    showError('Please enter a password.');
    passwordInput.focus();
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    showError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    passwordInput.focus();
    return;
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    showError(`Password must not exceed ${MAX_PASSWORD_LENGTH} characters.`);
    passwordInput.focus();
    return;
  }

  if (password !== confirmPassword) {
    showError('Passwords do not match. Please verify.');
    confirmPasswordInput.focus();
    return;
  }

  isSubmitting = true;
  createLockBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CREATE_PASSWORD',
      password
    });

    if (response?.success) {
      showSuccess('Master password created! Activating lock...');
      setTimeout(() => {
        window.location.replace(chrome.runtime.getURL('lock/lock.html'));
      }, 700);
    } else {
      showError(response?.error || 'Failed to initialize password lock.');
      isSubmitting = false;
      createLockBtn.disabled = false;
    }
  } catch (err) {
    console.error('[ChromeLock Setup] Error:', err);
    showError('Initialization error. Please try again.');
    isSubmitting = false;
    createLockBtn.disabled = false;
  }
}

setupForm.addEventListener('submit', handleSetup);

// Ensure user hasn't already completed setup
(async () => {
  const isConfigured = await AuthManager.isSetupCompleted();
  if (isConfigured) {
    window.location.replace(chrome.runtime.getURL('lock/lock.html'));
  }
})();

