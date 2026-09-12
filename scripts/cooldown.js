/**
 * ChromeLock - Cooldown Manager
 * Enforces configurable attempt limits (3, 5, or 10) and cooldown lockout (15s, 30s, 60s, etc.).
 *
 * Rules:
 * - When failed attempts reach the configured limit -> block for the configured cooldown duration.
 * - Cooldown duration is CONSTANT (never increases, no exponential backoff).
 * - Absolute cooldown end timestamp (cooldownUntil) is stored in persistent storage.local
 *   so closing/restarting Chrome cannot reset or bypass the cooldown.
 * - When cooldown expires, user receives the full quota of fresh attempts.
 * - Any successful authentication immediately clears cooldown and resets failure count.
 */

import { StorageService } from './storage.js';

export const DEFAULT_MAX_FAILED_ATTEMPTS = 5;
export const DEFAULT_COOLDOWN_DURATION_MS = 30000; // 30 seconds default

// Backward-compatible aliases
export const MAX_FAILED_ATTEMPTS = DEFAULT_MAX_FAILED_ATTEMPTS;
export const COOLDOWN_DURATION_MS = DEFAULT_COOLDOWN_DURATION_MS;

export const CooldownManager = {
  /**
   * Retrieves user-configured lockout policy from local storage.
   * @returns {Promise<{ maxAttempts: number, cooldownMs: number }>}
   */
  async getPolicy() {
    try {
      const data = await StorageService.local.get('lockoutPolicy');
      const policy = data?.lockoutPolicy || {};
      const maxAttempts = parseInt(policy.maxAttempts, 10) || DEFAULT_MAX_FAILED_ATTEMPTS;
      const cooldownSeconds = parseInt(policy.cooldownSeconds, 10) || (DEFAULT_COOLDOWN_DURATION_MS / 1000);
      return {
        maxAttempts: [3, 5, 10].includes(maxAttempts) ? maxAttempts : DEFAULT_MAX_FAILED_ATTEMPTS,
        cooldownMs: cooldownSeconds * 1000
      };
    } catch {
      return {
        maxAttempts: DEFAULT_MAX_FAILED_ATTEMPTS,
        cooldownMs: DEFAULT_COOLDOWN_DURATION_MS
      };
    }
  },

  /**
   * Checks current cooldown status against persistent storage and active policy.
   * @returns {Promise<{
   *   inCooldown: boolean,
   *   remainingMs: number,
   *   remainingSeconds: number,
   *   failedAttemptCount: number,
   *   attemptsLeft: number,
   *   maxAttempts: number
   * }>}
   */
  async checkStatus() {
    const { maxAttempts } = await this.getPolicy();
    const data = await StorageService.local.get(['cooldownUntil', 'failedAttemptCount']);
    const now = Date.now();
    const cooldownUntil = data.cooldownUntil || null;
    let failedAttemptCount = typeof data.failedAttemptCount === 'number' ? data.failedAttemptCount : 0;

    if (cooldownUntil) {
      const remainingMs = cooldownUntil - now;
      if (remainingMs > 0) {
        return {
          inCooldown: true,
          remainingMs,
          remainingSeconds: Math.ceil(remainingMs / 1000),
          failedAttemptCount: 0,
          attemptsLeft: 0,
          maxAttempts
        };
      } else {
        // Cooldown has expired while Chrome was closed or inactive
        await StorageService.local.set({
          cooldownUntil: null,
          failedAttemptCount: 0
        });
        return {
          inCooldown: false,
          remainingMs: 0,
          remainingSeconds: 0,
          failedAttemptCount: 0,
          attemptsLeft: maxAttempts,
          maxAttempts
        };
      }
    }

    return {
      inCooldown: false,
      remainingMs: 0,
      remainingSeconds: 0,
      failedAttemptCount,
      attemptsLeft: Math.max(0, maxAttempts - failedAttemptCount),
      maxAttempts
    };
  },

  /**
   * Records a failed authentication attempt.
   * Increments the failure counter. On reaching maxAttempts, triggers cooldown.
   * @returns {Promise<{
   *   inCooldown: boolean,
   *   remainingMs: number,
   *   remainingSeconds: number,
   *   failedAttemptCount: number,
   *   attemptsLeft: number,
   *   maxAttempts: number
   * }>}
   */
  async recordFailedAttempt() {
    const policy = await this.getPolicy();
    const status = await this.checkStatus();
    if (status.inCooldown) {
      return status;
    }

    const newCount = status.failedAttemptCount + 1;

    if (newCount >= policy.maxAttempts) {
      // Failed attempts limit reached -> Trigger cooldown
      const now = Date.now();
      const cooldownUntil = now + policy.cooldownMs;

      await StorageService.local.set({
        cooldownUntil,
        failedAttemptCount: 0 // Reset counter for next cycle
      });

      return {
        inCooldown: true,
        remainingMs: policy.cooldownMs,
        remainingSeconds: Math.ceil(policy.cooldownMs / 1000),
        failedAttemptCount: 0,
        attemptsLeft: 0,
        maxAttempts: policy.maxAttempts
      };
    }

    // Attempts below threshold
    await StorageService.local.set({
      failedAttemptCount: newCount
    });

    return {
      inCooldown: false,
      remainingMs: 0,
      remainingSeconds: 0,
      failedAttemptCount: newCount,
      attemptsLeft: policy.maxAttempts - newCount,
      maxAttempts: policy.maxAttempts
    };
  },

  /**
   * Resets failure counter and clears any cooldown upon successful authentication.
   */
  async reset() {
    await StorageService.local.set({
      failedAttemptCount: 0,
      cooldownUntil: null
    });
  }
};
