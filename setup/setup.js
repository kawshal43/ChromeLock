/**
 * ChromeLock - Setup Controller
 * Handles master password creation, security recovery question,
 * collapsible advanced settings, and mandatory terms acceptance.
 */

import { AuthManager, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../scripts/auth.js';

// DOM Elements
const setupCard = document.querySelector('.lock-card');
const setupForm = document.getElementById('setup-form');
const passwordInput = document.getElementById('password-input');
const confirmPasswordInput = document.getElementById('confirm-password-input');
const togglePwdBtn = document.getElementById('toggle-pwd-btn');
const toggleConfirmPwdBtn = document.getElementById('toggle-confirm-pwd-btn');

const securityQuestionSelect = document.getElementById('security-question-select');
const customQuestionGroup = document.getElementById('custom-question-group');
const customQuestionInput = document.getElementById('custom-question-input');
const securityAnswerInput = document.getElementById('security-answer-input');
const toggleAnswerBtn = document.getElementById('toggle-answer-btn');

const toggleAdvancedBtn = document.getElementById('toggle-advanced-btn');
const advancedPanel = document.getElementById('advanced-panel');
const setupAttemptsSelect = document.getElementById('setup-attempts-select');
const setupAutolockSelect = document.getElementById('setup-autolock-select');
const setupSecondsCheckbox = document.getElementById('setup-seconds-checkbox');

const termsCheckbox = document.getElementById('terms-checkbox');
const termsCard = document.querySelector('.terms-agreement-card');
const openTermsBtn = document.getElementById('open-terms-btn');
const termsModal = document.getElementById('terms-modal');
const closeTermsBtn = document.getElementById('close-terms-btn');
const declineTermsBtn = document.getElementById('decline-terms-btn');
const acceptTermsBtn = document.getElementById('accept-terms-btn');

const createLockBtn = document.getElementById('create-lock-btn');
const statusMessage = document.getElementById('status-message');

let isSubmitting = false;

// Password visibility toggles
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
      btnEl.setAttribute('aria-label', 'Hide text');
    } else {
      eyeOpen?.classList.remove('hidden');
      eyeClosed?.classList.add('hidden');
      btnEl.setAttribute('aria-label', 'Show text');
    }
  });
}

setupToggle(passwordInput, togglePwdBtn);
setupToggle(confirmPasswordInput, toggleConfirmPwdBtn);
setupToggle(securityAnswerInput, toggleAnswerBtn);

// Custom question dropdown toggle
securityQuestionSelect.addEventListener('change', () => {
  if (securityQuestionSelect.value === 'custom') {
    customQuestionGroup.classList.remove('hidden');
    customQuestionInput.focus();
  } else {
    customQuestionGroup.classList.add('hidden');
  }
});

// Advanced Settings Accordion toggle
toggleAdvancedBtn.addEventListener('click', () => {
  const isExpanded = toggleAdvancedBtn.getAttribute('aria-expanded') === 'true';
  toggleAdvancedBtn.setAttribute('aria-expanded', String(!isExpanded));
  if (isExpanded) {
    advancedPanel.classList.add('collapsed');
  } else {
    advancedPanel.classList.remove('collapsed');
  }
});

// Terms of Service Modal handling
function openTermsModal() {
  termsModal.classList.remove('hidden');
}

function closeTermsModal() {
  termsModal.classList.add('hidden');
}

openTermsBtn.addEventListener('click', (e) => {
  e.preventDefault();
  openTermsModal();
});

closeTermsBtn.addEventListener('click', closeTermsModal);
declineTermsBtn.addEventListener('click', closeTermsModal);

acceptTermsBtn.addEventListener('click', () => {
  termsCheckbox.checked = true;
  termsCard.classList.remove('terms-highlight');
  closeTermsModal();
});

// Close modal when clicking backdrop
termsModal.addEventListener('click', (e) => {
  if (e.target === termsModal) {
    closeTermsModal();
  }
});

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !termsModal.classList.contains('hidden')) {
    closeTermsModal();
  }
});

termsCheckbox.addEventListener('change', () => {
  if (termsCheckbox.checked) {
    termsCard.classList.remove('terms-highlight');
  }
});

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

  // 1. Password validation
  if (!password) {
    showError('Please enter a master password.');
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

  // 2. Security question & answer validation
  let question = securityQuestionSelect.value;
  if (question === 'custom') {
    question = (customQuestionInput.value || '').trim();
    if (!question) {
      showError('Please enter your custom security question.');
      customQuestionInput.focus();
      return;
    }
  }

  const answer = (securityAnswerInput.value || '').trim();
  if (!answer) {
    showError('Please provide a secret answer for password recovery.');
    securityAnswerInput.focus();
    return;
  }

  // 3. Mandatory Terms Acceptance Validation
  if (!termsCheckbox.checked) {
    termsCard.classList.add('terms-highlight');
    showError('You must agree to the Terms of Service & Disclaimer to continue.');
    termsCheckbox.focus();
    return;
  }

  isSubmitting = true;
  createLockBtn.disabled = true;

  try {
    const attemptsVal = parseInt(setupAttemptsSelect.value, 10) || 5;
    const cooldownSecs = attemptsVal === 3 ? 15 : attemptsVal === 10 ? 60 : 30;
    const autoLockMinutes = parseFloat(setupAutolockSelect.value) || 0;
    const showSeconds = setupSecondsCheckbox.checked;

    const response = await chrome.runtime.sendMessage({
      type: 'CREATE_PASSWORD',
      password,
      securityQuestion: question,
      securityAnswer: answer,
      lockoutPolicy: {
        maxAttempts: attemptsVal,
        cooldownSeconds: cooldownSecs
      },
      autoLockDurationMinutes: autoLockMinutes,
      clockSettings: {
        showSeconds,
        is24Hour: false
      }
    });

    if (response?.success) {
      showSuccess('Setup complete! Activating ChromeLock...');
      setTimeout(() => {
        window.location.replace(chrome.runtime.getURL('lock/lock.html'));
      }, 600);
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
  try {
    const isConfigured = await AuthManager.isSetupCompleted();
    if (isConfigured) {
      window.location.replace(chrome.runtime.getURL('lock/lock.html'));
    }
  } catch {
    // Storage check fallback
  }
})();
