/**
 * ChromeLock - Cooldown Manager
 * Enforces exact 5-attempt limit and exact 30-second lockout.
 *
 * Rules:
 * - 5 wrong attempts -> block for exactly 30 seconds (30,000 ms).
 * - Cooldown duration is CONSTANT (never increases, no exponential backoff).
 * - Absolute cooldown end timestamp (cooldownUntil) is stored in persistent storage.local
 *   so closing/restarting Chrome cannot reset or bypass the cooldown.
 * - When cooldown expires, user receives another 5 attempts.
 * - Any successful authentication immediately clears cooldown and resets failure count.
 */

import { StorageService } from './storage.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const COOLDOWN_DURATION_MS = 30000; // Exactly 30 seconds

export const CooldownManager = {
  /**
   * Checks the current cooldown status against persistent storage.
   * If an active cooldown exists, calculates remaining milliseconds.
   * If a stored cooldown has expired, resets it automatically.
   * @returns {Promise<{
   *   inCooldown: boolean,
   *   remainingMs: number,
   *   remainingSeconds: number,
   *   failedAttemptCount: number,
   *   attemptsLeft: number
   * }>}
   */
  async checkStatus() {
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
          attemptsLeft: 0
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
          attemptsLeft: MAX_FAILED_ATTEMPTS
        };
      }
    }

    return {
      inCooldown: false,
      remainingMs: 0,
      remainingSeconds: 0,
      failedAttemptCount,
      attemptsLeft: Math.max(0, MAX_FAILED_ATTEMPTS - failedAttemptCount)
    };
  },

  /**
   * Records a failed authentication attempt.
   * Increments the failure counter. On the 5th failure, triggers an exact 30s cooldown.
   * @returns {Promise<{
   *   inCooldown: boolean,
   *   remainingMs: number,
   *   remainingSeconds: number,
   *   failedAttemptCount: number,
   *   attemptsLeft: number
   * }>}
   */
  async recordFailedAttempt() {
    const status = await this.checkStatus();
    if (status.inCooldown) {
      return status;
    }

    const newCount = status.failedAttemptCount + 1;

    if (newCount >= MAX_FAILED_ATTEMPTS) {
      // 5th failed attempt reached -> Trigger exact 30s cooldown
      const now = Date.now();
      const cooldownUntil = now + COOLDOWN_DURATION_MS;

      await StorageService.local.set({
        cooldownUntil,
        failedAttemptCount: 0 // Reset counter for the next cycle
      });

      return {
        inCooldown: true,
        remainingMs: COOLDOWN_DURATION_MS,
        remainingSeconds: Math.ceil(COOLDOWN_DURATION_MS / 1000),
        failedAttemptCount: 0,
        attemptsLeft: 0
      };
    }

    // Attempt 1 to 4 failed
    await StorageService.local.set({
      failedAttemptCount: newCount
    });

    return {
      inCooldown: false,
      remainingMs: 0,
      remainingSeconds: 0,
      failedAttemptCount: newCount,
      attemptsLeft: MAX_FAILED_ATTEMPTS - newCount
    };
  },

  /**
   * Resets the failure counter and clears any cooldown upon successful authentication.
   */
  async reset() {
    await StorageService.local.set({
      failedAttemptCount: 0,
      cooldownUntil: null
    });
  }
};

