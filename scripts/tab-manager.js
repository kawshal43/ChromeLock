/**
 * ChromeLock - Tab Manager
 * Intercepts, redirects, and enforces the lock screen across all normal browsing tabs.
 * Preserves originally requested URLs and restores them upon successful authentication.
 */

import { StorageService } from './storage.js';
import { LockManager } from './lock-manager.js';
import { AuthManager } from './auth.js';

export const TabManager = {
  /**
   * Returns the absolute URL of the lock screen.
   * @returns {string}
   */
  getLockUrl() {
    return chrome.runtime.getURL('lock/lock.html');
  },

  /**
   * Returns the absolute URL of the setup screen.
   * @returns {string}
   */
  getSetupUrl() {
    return chrome.runtime.getURL('setup/setup.html');
  },

  /**
   * Checks whether a given URL is one of the extension's own pages.
   * Prevents infinite redirect loops.
   * @param {string} url
   * @returns {boolean}
   */
  isExtensionUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const extensionBase = chrome.runtime.getURL('');
    return url.startsWith(extensionBase);
  },

  /**
   * Determines if a URL is a normal web browsing target that must be locked.
   * Intercepts http, https, file, ftp, localhost, and IP addresses.
   * @param {string} url
   * @returns {boolean}
   */
  isInterceptableUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (this.isExtensionUrl(url)) return false;

    const lower = url.toLowerCase();
    // Intercept normal web navigations
    return (
      lower.startsWith('http://') ||
      lower.startsWith('https://') ||
      lower.startsWith('file://') ||
      lower.startsWith('ftp://')
    );
  },

  /**
   * Saves a tab's target URL in session storage for later restoration upon unlock.
   * @param {number} tabId
   * @param {string} originalUrl
   */
  async saveTabUrl(tabId, originalUrl) {
    if (!tabId || !this.isInterceptableUrl(originalUrl)) return;
    try {
      const data = await StorageService.session.get('savedTabs');
      const savedTabs = data.savedTabs || {};
      savedTabs[tabId] = originalUrl;
      await StorageService.session.set({ savedTabs });
    } catch (err) {
      console.error('[ChromeLock TabManager] saveTabUrl error:', err);
    }
  },

  /**
   * Restores all saved tabs to their original URLs after authentication.
   */
  async restoreSavedTabs() {
    try {
      const data = await StorageService.session.get('savedTabs');
      const savedTabs = data.savedTabs || {};
      const tabIds = Object.keys(savedTabs);

      for (const idStr of tabIds) {
        const tabId = parseInt(idStr, 10);
        const originalUrl = savedTabs[idStr];

        if (tabId && this.isInterceptableUrl(originalUrl)) {
          try {
            // Check if tab still exists
            const tab = await chrome.tabs.get(tabId).catch(() => null);
            if (tab) {
              await chrome.tabs.update(tabId, { url: originalUrl });
            }
          } catch (err) {
            console.warn(`[ChromeLock TabManager] Could not restore tab ${tabId}:`, err);
          }
        }
      }

      // Clear saved tabs after restoration
      await StorageService.session.set({ savedTabs: {} });
    } catch (err) {
      console.error('[ChromeLock TabManager] restoreSavedTabs error:', err);
    }
  },

  /**
   * Inspects a tab and enforces ChromeLock if the session is locked.
   * @param {chrome.tabs.Tab} tab
   */
  async enforceOnTab(tab) {
    if (!tab || !tab.id) return;

    // First check if setup has been completed
    const setupCompleted = await AuthManager.isSetupCompleted();
    if (!setupCompleted) {
      if (!this.isExtensionUrl(tab.url || tab.pendingUrl)) {
        await this.redirectTo(tab.id, this.getSetupUrl());
      }
      return;
    }

    const isUnlocked = await LockManager.isUnlocked();
    if (isUnlocked) {
      return; // Browsing allowed
    }

    // Session is LOCKED: any tab that is not the active lock screen must be locked
    const url = tab.url || tab.pendingUrl || '';
    const targetUrl = setupCompleted ? this.getLockUrl() : this.getSetupUrl();

    if (url.startsWith(targetUrl)) {
      return;
    }

    // If this tab is on dashboard or settings while locked, redirect to lock screen
    if (this.isExtensionUrl(url)) {
      await this.redirectTo(tab.id, targetUrl);
      return;
    }

    if (this.isInterceptableUrl(url)) {
      await this.saveTabUrl(tab.id, url);
    }
    await this.redirectTo(tab.id, targetUrl);
  },

  /**
   * Safely updates a tab URL.
   * @param {number} tabId
   * @param {string} targetUrl
   */
  async redirectTo(tabId, targetUrl) {
    try {
      await chrome.tabs.update(tabId, { url: targetUrl });
    } catch (err) {
      // Suppress restricted chrome:// navigation errors
      console.warn(`[ChromeLock TabManager] Redirect failed for tab ${tabId}:`, err);
    }
  },

  /**
   * Enforces lock screen on all currently open tabs across all browser windows.
   */
  async enforceLockOnAllTabs() {
    try {
      const isConfigured = await AuthManager.isSetupCompleted();
      const targetUrl = isConfigured ? this.getLockUrl() : this.getSetupUrl();

      const tabs = await chrome.tabs.query({});
      let hasLockTab = false;

      for (const tab of tabs) {
        const url = tab.url || tab.pendingUrl || '';

        // If tab is already the lock screen, keep it
        if (url.startsWith(targetUrl)) {
          hasLockTab = true;
          continue;
        }

        // If tab is on another extension page (e.g. dashboard, settings), redirect to lock screen
        if (this.isExtensionUrl(url)) {
          await this.redirectTo(tab.id, targetUrl);
          hasLockTab = true;
          continue;
        }

        if (this.isInterceptableUrl(url)) {
          await this.saveTabUrl(tab.id, url);
        }
        await this.redirectTo(tab.id, targetUrl);
        hasLockTab = true;
      }

      // If no lock tab exists at all in the active window, create one
      if (!hasLockTab) {
        await chrome.tabs.create({ url: targetUrl, active: true });
      }
    } catch (err) {
      console.error('[ChromeLock TabManager] enforceLockOnAllTabs error:', err);
    }
  }
};

