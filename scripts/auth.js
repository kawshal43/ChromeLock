/**
 * ChromeLock - Authentication Service
 * Coordinates password creation, verification, cooldown enforcement, and password changes.
 * Never stores or logs plaintext passwords.
 */

import { CryptoService } from './crypto.js';
import { StorageService } from './storage.js';
import { CooldownManager } from './cooldown.js';
import { LockManager } from './lock-manager.js';

export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 128;

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
   * First-time setup: securely derives verifier and persists setup credentials.
   * Activates the LOCKED state immediately.
   * @param {string} password
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async createPassword(password) {
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

      await StorageService.local.set({
        setupCompleted: true,
        passwordSalt: salt,
        passwordVerifier: verifier,
        passwordIterations: CryptoService.DEFAULT_ITERATIONS,
        failedAttemptCount: 0,
        cooldownUntil: null
      });

      // Ensure session starts in LOCKED state
      await LockManager.setUnlocked(false);

      return { success: true };
    } catch (err) {
      console.error('[ChromeLock Auth] createPassword error:', err);
      return { success: false, error: 'Failed to securely derive password verifier.' };
    }
  },

  /**
   * Authenticates user against stored verifier.
   * Manages cooldown and unlocks the session upon success.
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

    // Incorrect password: record failed attempt & trigger cooldown if 5th failure
    const failureResult = await CooldownManager.recordFailedAttempt();
    return {
      success: false,
      error: 'INCORRECT_PASSWORD',
      ...failureResult
    };
  },

  /**
   * Changes the master password. Requires current password verification.
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
  }
};

