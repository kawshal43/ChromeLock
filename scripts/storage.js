/**
 * ChromeLock - Storage Service
 * Provides Promise-based abstraction over chrome.storage.local and chrome.storage.session.
 *
 * Rules:
 * - Persistent configuration, salts, verifiers, and cooldown timestamps belong in storage.local.
 * - Ephemeral session unlock state (isUnlocked, savedTabs) belongs ONLY in storage.session.
 * - Fail-closed: returns safe defaults (locked/undefined) if storage fails.
 */

// In-memory fallback mock for node unit tests or unsupported environments
const memoryLocal = new Map();
const memorySession = new Map();

export const StorageService = {
  local: {
    /**
     * Get item(s) from persistent local storage.
     * @param {string|string[]|Object} keys
     * @returns {Promise<Object>}
     */
    async get(keys) {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
          return await chrome.storage.local.get(keys);
        } catch (err) {
          console.error('[ChromeLock Storage] local.get error:', err);
          return {};
        }
      }

      // Memory fallback for automated testing
      const result = {};
      const keyList = Array.isArray(keys)
        ? keys
        : typeof keys === 'string'
        ? [keys]
        : Object.keys(keys || {});
      for (const k of keyList) {
        if (memoryLocal.has(k)) {
          result[k] = memoryLocal.get(k);
        } else if (keys && typeof keys === 'object' && !Array.isArray(keys) && k in keys) {
          result[k] = keys[k];
        }
      }
      return result;
    },

    /**
     * Store item(s) in persistent local storage.
     * @param {Object} items
     * @returns {Promise<void>}
     */
    async set(items) {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
          return await chrome.storage.local.set(items);
        } catch (err) {
          console.error('[ChromeLock Storage] local.set error:', err);
          return;
        }
      }

      for (const [k, v] of Object.entries(items)) {
        memoryLocal.set(k, v);
      }
    },

    /**
     * Remove item(s) from persistent local storage.
     * @param {string|string[]} keys
     * @returns {Promise<void>}
     */
    async remove(keys) {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
          return await chrome.storage.local.remove(keys);
        } catch (err) {
          console.error('[ChromeLock Storage] local.remove error:', err);
          return;
        }
      }

      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) {
        memoryLocal.delete(k);
      }
    },

    /**
     * Clear all persistent local storage.
     * @returns {Promise<void>}
     */
    async clear() {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
          return await chrome.storage.local.clear();
        } catch (err) {
          console.error('[ChromeLock Storage] local.clear error:', err);
          return;
        }
      }

      memoryLocal.clear();
    }
  },

  session: {
    /**
     * Get item(s) from ephemeral session storage.
     * Guaranteed by Chrome to be purged when the browser process closes.
     * @param {string|string[]|Object} keys
     * @returns {Promise<Object>}
     */
    async get(keys) {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        try {
          return await chrome.storage.session.get(keys);
        } catch (err) {
          console.error('[ChromeLock Storage] session.get error:', err);
          return {};
        }
      }

      // Memory fallback
      const result = {};
      const keyList = Array.isArray(keys)
        ? keys
        : typeof keys === 'string'
        ? [keys]
        : Object.keys(keys || {});
      for (const k of keyList) {
        if (memorySession.has(k)) {
          result[k] = memorySession.get(k);
        } else if (keys && typeof keys === 'object' && !Array.isArray(keys) && k in keys) {
          result[k] = keys[k];
        }
      }
      return result;
    },

    /**
     * Store item(s) in ephemeral session storage.
     * @param {Object} items
     * @returns {Promise<void>}
     */
    async set(items) {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        try {
          return await chrome.storage.session.set(items);
        } catch (err) {
          console.error('[ChromeLock Storage] session.set error:', err);
          return;
        }
      }

      for (const [k, v] of Object.entries(items)) {
        memorySession.set(k, v);
      }
    },

    /**
     * Remove item(s) from session storage.
     * @param {string|string[]} keys
     * @returns {Promise<void>}
     */
    async remove(keys) {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        try {
          return await chrome.storage.session.remove(keys);
        } catch (err) {
          console.error('[ChromeLock Storage] session.remove error:', err);
          return;
        }
      }

      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) {
        memorySession.delete(k);
      }
    },

    /**
     * Clear all session storage (called on startup to enforce LOCKED).
     * @returns {Promise<void>}
     */
    async clear() {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        try {
          return await chrome.storage.session.clear();
        } catch (err) {
          console.error('[ChromeLock Storage] session.clear error:', err);
          return;
        }
      }

      memorySession.clear();
    }
  }
};
