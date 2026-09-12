/**
 * ChromeLock - Authentication & Recovery Service
 * Coordinates password creation, verification, recovery security questions,
 * cooldown enforcement, and password changes.
 * Never stores or logs plaintext passwords or plain security answers.
 */

import { CryptoService } from './crypto.js';
import { StorageService } from './storage.js';
import { CooldownManager } from './cooldown.js';
import { LockManager } from './lock-manager.js';

export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Normalizes security answer: trims whitespace and converts to lowercase.
 * Ensures case-insensitive matching while preserving security.
 * @param {string} answer
 * @returns {string}
 */
export function normalizeAnswer(answer) {
  if (typeof answer !== 'string') return '';
  return answer.trim().toLowerCase();
}

export const AuthManager = {
  /**
   * Checks whether the user has completed initial password setup.
   * @returns {Promise<boolean>}
   */
  async isSetupCompleted() {
    try {
      const data = await StorageService.local.get('setupCompleted');
      return data?.setupCompleted === true;
    } catch {
      return false;
    }
  },

  /**
   * Validates password constraints (length 6 to 128 chars).
   * @param {string} password
   * @returns {{ valid: boolean, error?: string }}
   */
  validatePassword(password) {
    if (typeof password !== 'string') {
      return { valid: false, error: 'Password must be a valid string.' };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return {
        valid: false,
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
      };
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return {
        valid: false,
        error: `Password must not exceed ${MAX_PASSWORD_LENGTH} characters.`
      };
    }
    return { valid: true };
  },

  /**
   * First-time setup: securely derives verifiers for master password and optional recovery question.
   * Activates the LOCKED state immediately.
   * @param {string} password
   * @param {string} [securityQuestion]
   * @param {string} [securityAnswer]
   * @param {Object} [options]
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async createPassword(password, securityQuestion = '', securityAnswer = '', options = {}) {
    const validation = this.validatePassword(password);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      const salt = CryptoService.generateSalt();
      const verifier = await CryptoService.deriveKey(
        password,
        salt,
        CryptoService.DEFAULT_ITERATIONS
      );

      const toSave = {
        setupCompleted: true,
        passwordSalt: salt,
        passwordVerifier: verifier,
        passwordIterations: CryptoService.DEFAULT_ITERATIONS,
        failedAttemptCount: 0,
        cooldownUntil: null,
        lockoutPolicy: options.lockoutPolicy || { maxAttempts: 5, cooldownSeconds: 30 },
        autoLockDurationMinutes: typeof options.autoLockDurationMinutes === 'number' ? options.autoLockDurationMinutes : 5,
        clockSettings: options.clockSettings || { showSeconds: true, is24Hour: false },
        shortcuts: options.shortcuts || [
          { id: '1', name: 'Google', url: 'https://www.google.com' },
          { id: '2', name: 'YouTube', url: 'https://www.youtube.com' },
          { id: '3', name: 'GitHub', url: 'https://github.com' },
          { id: '4', name: 'Wikipedia', url: 'https://www.wikipedia.org' },
          { id: '5', name: 'Reddit', url: 'https://www.reddit.com' }
        ]
      };

      // If security question & answer provided, hash normalized answer securely
      const cleanAnswer = normalizeAnswer(securityAnswer);
      if (securityQuestion && cleanAnswer) {
        const answerSalt = CryptoService.generateSalt();
        const answerVerifier = await CryptoService.deriveKey(
          cleanAnswer,
          answerSalt,
          CryptoService.DEFAULT_ITERATIONS
        );
        toSave.securityQuestionText = securityQuestion;
        toSave.securityAnswerSalt = answerSalt;
        toSave.securityAnswerVerifier = answerVerifier;
      }

      await StorageService.local.set(toSave);

      // Ensure session starts in LOCKED state
      await LockManager.setUnlocked(false);

      return { success: true };
    } catch (err) {
      console.error('[ChromeLock Auth] createPassword error:', err);
      return { success: false, error: 'Failed to securely derive password verifier.' };
    }
  },

  /**
   * Returns the configured security question (without revealing answer or salt).
   * @returns {Promise<{ hasQuestion: boolean, question: string }>}
   */
  async getSecurityQuestion() {
    try {
      const data = await StorageService.local.get('securityQuestionText');
      const question = data?.securityQuestionText || '';
      return {
        hasQuestion: Boolean(question),
        question
      };
    } catch {
      return { hasQuestion: false, question: '' };
    }
  },

  /**
   * Resets master password using security question verification.
   * Prevents brute-forcing by incrementing failed attempt counter upon wrong answer.
   * @param {string} answer
   * @param {string} newPassword
   * @returns {Promise<{ success: boolean, error?: string, inCooldown?: boolean, remainingMs?: number }>}
   */
  async resetPasswordWithSecurityAnswer(answer, newPassword) {
    // 1. Check cooldown status
    const cooldownStatus = await CooldownManager.checkStatus();
    if (cooldownStatus.inCooldown) {
      return {
        success: false,
        error: 'COOLDOWN_ACTIVE',
        ...cooldownStatus
      };
    }

    // 2. Validate new password format
    const val = this.validatePassword(newPassword);
    if (!val.valid) {
      return { success: false, error: val.error };
    }

    // 3. Load stored security answer data
    const data = await StorageService.local.get([
      'securityQuestionText',
      'securityAnswerSalt',
      'securityAnswerVerifier'
    ]);

    if (!data.securityQuestionText || !data.securityAnswerSalt || !data.securityAnswerVerifier) {
      return { success: false, error: 'No recovery question configured.' };
    }

    // 4. Case-insensitive normalization & verification
    const cleanAnswer = normalizeAnswer(answer);
    const isAnswerValid = await CryptoService.verifyPassword(
      cleanAnswer,
      data.securityAnswerSalt,
      data.securityAnswerVerifier,
      CryptoService.DEFAULT_ITERATIONS
    );

    if (!isAnswerValid) {
      // Wrong recovery answer counts as failed attempt towards lockout policy
      const failResult = await CooldownManager.recordFailedAttempt();
      return {
        success: false,
        error: 'INCORRECT_ANSWER',
        ...failResult
      };
    }

    // 5. Answer is correct! Derive new master password key and save
    const newSalt = CryptoService.generateSalt();
    const newVerifier = await CryptoService.deriveKey(
      newPassword,
      newSalt,
      CryptoService.DEFAULT_ITERATIONS
    );

    await StorageService.local.set({
      passwordSalt: newSalt,
      passwordVerifier: newVerifier,
      passwordIterations: CryptoService.DEFAULT_ITERATIONS,
      failedAttemptCount: 0,
      cooldownUntil: null
    });

    // Reset cooldown and unlock session
    await CooldownManager.reset();
    await LockManager.setUnlocked(true);

    return { success: true };
  },

  /**
   * Authenticates user against stored verifier.
   * Manages cooldown and unlocks session upon success.
   * @param {string} password
   * @returns {Promise<{
   *   success: boolean,
   *   error?: string,
   *   inCooldown?: boolean,
   *   remainingMs?: number,
   *   remainingSeconds?: number,
   *   failedAttemptCount?: number,
   *   attemptsLeft?: number
   * }>}
   */
  async authenticate(password) {
    // 1. Check cooldown status
    const cooldownStatus = await CooldownManager.checkStatus();
    if (cooldownStatus.inCooldown) {
      return {
        success: false,
        error: 'COOLDOWN_ACTIVE',
        ...cooldownStatus
      };
    }

    // 2. Fetch stored verification credentials
    const credentials = await StorageService.local.get([
      'setupCompleted',
      'passwordSalt',
      'passwordVerifier',
      'passwordIterations'
    ]);

    if (!credentials.setupCompleted || !credentials.passwordSalt || !credentials.passwordVerifier) {
      return { success: false, error: 'NOT_CONFIGURED' };
    }

    const iterations = credentials.passwordIterations || CryptoService.DEFAULT_ITERATIONS;

    // 3. Verify password
    const isValid = await CryptoService.verifyPassword(
      password,
      credentials.passwordSalt,
      credentials.passwordVerifier,
      iterations
    );

    if (isValid) {
      // Successful password: reset failures & cooldown, unlock session
      await CooldownManager.reset();
      await LockManager.setUnlocked(true);
      return { success: true };
    }

    // Incorrect password: record failed attempt & trigger cooldown if threshold reached
    const failureResult = await CooldownManager.recordFailedAttempt();
    return {
      success: false,
      error: 'INCORRECT_PASSWORD',
      ...failureResult
    };
  },

  /**
   * Changes master password. Requires current password verification.
   * Generates fresh random salt and derives new verifier.
   * @param {string} currentPassword
   * @param {string} newPassword
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async changePassword(currentPassword, newPassword) {
    const newValidation = this.validatePassword(newPassword);
    if (!newValidation.valid) {
      return { success: false, error: newValidation.error };
    }

    const credentials = await StorageService.local.get([
      'setupCompleted',
      'passwordSalt',
      'passwordVerifier',
      'passwordIterations'
    ]);

    if (!credentials.setupCompleted || !credentials.passwordSalt || !credentials.passwordVerifier) {
      return { success: false, error: 'Extension not configured.' };
    }

    const iterations = credentials.passwordIterations || CryptoService.DEFAULT_ITERATIONS;
    const isOldValid = await CryptoService.verifyPassword(
      currentPassword,
      credentials.passwordSalt,
      credentials.passwordVerifier,
      iterations
    );

    if (!isOldValid) {
      return { success: false, error: 'Current password is incorrect.' };
    }

    // Generate fresh salt and new verifier
    const newSalt = CryptoService.generateSalt();
    const newVerifier = await CryptoService.deriveKey(
      newPassword,
      newSalt,
      CryptoService.DEFAULT_ITERATIONS
    );

    await StorageService.local.set({
      passwordSalt: newSalt,
      passwordVerifier: newVerifier,
      passwordIterations: CryptoService.DEFAULT_ITERATIONS,
      failedAttemptCount: 0,
      cooldownUntil: null
    });

    return { success: true };
  },

  /**
   * Updates or sets security recovery question. Requires master password verification.
   * @param {string} currentPassword
   * @param {string} newQuestion
   * @param {string} newAnswer
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async updateSecurityQuestion(currentPassword, newQuestion, newAnswer) {
    const cleanAnswer = normalizeAnswer(newAnswer);
    if (!newQuestion || !cleanAnswer) {
      return { success: false, error: 'Security question and answer are required.' };
    }

    const credentials = await StorageService.local.get([
      'setupCompleted',
      'passwordSalt',
      'passwordVerifier',
      'passwordIterations'
    ]);

    const isOldValid = await CryptoService.verifyPassword(
      currentPassword,
      credentials.passwordSalt,
      credentials.passwordVerifier,
      credentials.passwordIterations || CryptoService.DEFAULT_ITERATIONS
    );

    if (!isOldValid) {
      return { success: false, error: 'Current master password is incorrect.' };
    }

    const answerSalt = CryptoService.generateSalt();
    const answerVerifier = await CryptoService.deriveKey(
      cleanAnswer,
      answerSalt,
      CryptoService.DEFAULT_ITERATIONS
    );

    await StorageService.local.set({
      securityQuestionText: newQuestion,
      securityAnswerSalt: answerSalt,
      securityAnswerVerifier: answerVerifier
    });

    return { success: true };
  }
};
