/**
 * ChromeLock - Lock Manager
 * Controls session lock states, fail-closed transitions, and cross-tab broadcasts.
 */

import { StorageService } from './storage.js';

export const LockState = {
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  LOCKED: 'LOCKED',
  COOLDOWN: 'COOLDOWN',
  UNLOCKED: 'UNLOCKED'
};

export const LockManager = {
  /**
   * Returns whether the current browser session is unlocked.
   * Employs FAIL-CLOSED principle: any error or missing value defaults to false (locked).
   * @returns {Promise<boolean>}
   */
  async isUnlocked() {
    try {
      const data = await StorageService.session.get('isUnlocked');
      return data?.isUnlocked === true;
    } catch (err) {
      console.error('[ChromeLock LockManager] isUnlocked error, failing closed:', err);
      return false;
    }
  },

  /**
   * Updates the session unlock state and broadcasts the change to all open views.
   * @param {boolean} unlocked
   */
  async setUnlocked(unlocked) {
    try {
      await StorageService.session.set({ isUnlocked: unlocked === true });
      this.broadcastStateChange(unlocked === true);
    } catch (err) {
      console.error('[ChromeLock LockManager] setUnlocked error:', err);
    }
  },

  /**
   * Manually locks the browser session.
   * Invoked by user actions (Popup Lock Now, Ctrl+Shift+L, Auto-Lock).
   */
  async lockSession() {
    await this.setUnlocked(false);
  },

  /**
   * Sends a broadcast message across extension pages (tabs, popups, options).
   * @param {boolean} isUnlocked
   */
  broadcastStateChange(isUnlocked) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage({
          type: 'LOCK_STATE_CHANGED',
          isUnlocked
        }).catch(() => {
          // Suppress error if no receivers are currently active
        });
      } catch {
        // Ignored
      }
    }
  }
};

