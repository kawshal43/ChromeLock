# ChromeLock — Browser-Level Lock Extension (Manifest V3)

> **ChromeLock** is a local, privacy-first, browser-level lock extension for Google Chrome. Whenever Chrome starts, normal browsing remains strictly locked across all windows and tabs until the user authenticates with their master password.

---

## Table of Contents
1. [Overview & Philosophy](#overview--philosophy)
2. [Security Architecture](#security-architecture)
3. [Key Features](#key-features)
4. [Attempt Limits & Cooldown Engine](#attempt-limits--cooldown-engine)
5. [Permissions Rationale](#permissions-rationale)
6. [Installation & Development Mode](#installation--development-mode)
7. [Enterprise & Managed Deployment (Mode B)](#enterprise--managed-deployment-mode-b)
8. [Important Limitations](#important-limitations)
9. [Manual Testing Verification Checklist (Tests 01–25)](#manual-testing-verification-checklist-tests-0125)
10. [Build & Version Information](#build--version-information)
11. [Developer Information](#developer-information)

---

## Overview & Philosophy

Most browser lock extensions operate as fragile popups or rely on a single open tab. ChromeLock takes an architectural approach:
- **Session-Scoped Enforcement**: Authentication state is stored in memory via Chrome's `chrome.storage.session` API. When all Chrome windows close or the browser restarts, this session state is automatically discarded by Chrome. The next launch is guaranteed to start in the **LOCKED** state.
- **Fail-Closed Security**: If storage operations error or state is indeterminate, ChromeLock always defaults to **LOCKED**, never unlocked.
- **100% Offline & Private**: Zero external dependencies, zero CDN calls, zero telemetry, and zero network requests. All cryptographic derivations and verifications occur locally on your machine via the W3C Web Crypto API.

---

## Security Architecture

### Password Storage & Key Derivation
ChromeLock **never** persists, logs, or transmits plain-text passwords.
1. **Algorithm**: PBKDF2 (Password-Based Key Derivation Function 2)
2. **Pseudorandom Function**: HMAC with SHA-256
3. **Work Factor**: 100,000 iterations (high brute-force resistance on modern hardware)
4. **Cryptographic Salt**: 16 bytes (128 bits) of cryptographically random entropy generated via `crypto.getRandomValues()`
5. **Output Verifier**: 256-bit derived key stored as a 64-character hexadecimal digest
6. **Comparison**: Constant-time bitwise string comparison (`timingSafeEqual`) to eliminate timing side-channel attacks.

### State Separation
| State Component | Storage Mechanism | Persistence | Description |
|---|---|---|---|
| `passwordSalt` | `chrome.storage.local` | Persistent | Random 16-byte cryptographic salt (hex) |
| `passwordVerifier` | `chrome.storage.local` | Persistent | PBKDF2-SHA-256 derived key digest (hex) |
| `passwordIterations` | `chrome.storage.local` | Persistent | Iteration count (100,000) |
| `cooldownUntil` | `chrome.storage.local` | Persistent | Absolute timestamp (ms) for lockout expiration |
| `failedAttemptCount`| `chrome.storage.local` | Persistent | Counter (0–5) within current attempt cycle |
| `autoLockDuration` | `chrome.storage.local` | Persistent | Inactivity timeout preference in minutes |
| `isUnlocked` | `chrome.storage.session` | **Ephemeral** | Cleared automatically upon Chrome exit |
| `savedTabs` | `chrome.storage.session` | **Ephemeral** | Original destination URLs restored post-auth |

---

## Key Features

- **Startup Lock**: Every time Chrome launches, open tabs are intercepted, destination URLs are saved, and the ChromeLock screen is enforced.
- **Tab & Navigation Interception**: Intercepts direct URL entry in the address bar (`http://`, `https://`, `localhost`, IP addresses), external links clicked from other applications, and bookmarks.
- **Preserve & Restore Tabs**: Restores your original URLs upon authentication rather than discarding your open tabs.
- **New Tab Protection (`Ctrl + T`)**: Overrides Chrome's New Tab page. When locked, it renders the lock screen. When unlocked, it displays a clean, minimalist new tab dashboard with search, clock, and quick shortcuts.
- **Multi-Window Sync**: All windows in the profile share the session lock state. Authenticating in one unlocks the entire session.
- **Manual Lock Shortcut (`Ctrl + Shift + L`)**: Instantly locks all browsing activity.
- **Toolbar Action Popup**: Clean popup displaying security status with a one-click **Lock Now** trigger.
- **Password Rotation**: Secure settings interface requiring verification of the current master password before generating fresh salt and verifiers.
- **Optional Inactivity Auto-Lock**: Automatically locks the browser session after 1, 5, 10, or 30 minutes of system inactivity.

---

## Attempt Limits & Cooldown Engine

ChromeLock enforces an exact, non-punitive lockout policy:
- **Attempts Allowed**: Exactly **5** incorrect password attempts.
- **Cooldown Duration**: Exactly **30 seconds** (`30,000` ms).
- **No Exponential Backoff**: Cooldown is always 30 seconds for every group of 5 failed attempts (attempts 1–5: 30s; attempts 6–10: 30s; forever).
- **Restart Survival**: Cooldown end time is recorded as an absolute timestamp (`Date.now() + 30000`). If Chrome is closed and reopened with 15 seconds remaining, the lock screen calculates `cooldownUntil - Date.now()` and continues counting down from 15 seconds.
- **Input Locking**: During cooldown, the password input, visibility toggle, Enter key, and unlock button are completely disabled, and a live countdown (`00:30` ... `00:00`) is displayed.
- **Reset on Success**: Entering the correct password at any attempt (e.g. attempt 3 of 5) immediately resets the failed attempt count to 0 and clears the cooldown.

---

## Permissions Rationale

ChromeLock requests only the minimal set of permissions required for browser security:
- `storage`: Required for `chrome.storage.local` (salt/verifier/cooldown) and `chrome.storage.session` (session unlock state).
- `tabs`: Required to detect navigations, inspect target URLs for interception, and restore URLs upon unlocking.
- `commands`: Required to register the `Ctrl+Shift+L` instant lock shortcut.
- `idle`: Required to support optional user-configured inactivity auto-lock.
- `alarms`: Required for background timing checks in Manifest V3 service workers.

No host permissions (`<all_urls>`) or invasive script injections are used.

---

## Installation & Development Mode

### MODE A — Development / Normal Installation
1. Open Google Chrome.
2. In the address bar, navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left toolbar.
5. In the file picker dialog, select the project directory:
   ```
   D:\2026\kawshal\CHROME_LOCK
   ```
6. ChromeLock will load and automatically launch `setup/setup.html` to configure your master password.

---

## Enterprise & Managed Deployment (Mode B)

For production, shared family, or kiosk computers where you want to prevent ordinary users from disabling or uninstalling ChromeLock:

### 1. Windows Group Policy / Registry Enforcement
Chrome enterprise policies can force-install extensions and disable developer-mode removal via the Windows Registry.

#### Step 1: Obtain Extension ID
When ChromeLock is loaded unpacked or published to an internal web store, note its 32-character Extension ID (e.g., `abcdefghijklmnopqrstuvwxyz123456`).

#### Step 2: Force-Install via Registry
Create a registry entry under Chrome Policies:
```reg
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist]
"1"="<CHROMELOCK_EXTENSION_ID>;https://clients2.google.com/service/update2/crx"
```
*(Replace `<CHROMELOCK_EXTENSION_ID>` with your extension's actual ID).*

#### Step 3: Hardening Recommendations
To prevent bypasses on a managed workstation, configure the following Chrome enterprise policies:
- **IncognitoModeAvailability** (`DWORD: 1`): Disabled (`1`), so incognito windows cannot bypass extension enforcement.
- **GuestModeEnabled** (`DWORD: 0`): Disables guest mode browsing.
- **BrowserAddPersonEnabled** (`DWORD: 0`): Disables creating new unprotected Chrome profiles.
- **DeveloperToolsAvailability** (`DWORD: 2`): Disables inspect/dev tools to prevent DOM manipulation.

---

## Important Limitations

1. **Not an Operating System Replacement**: ChromeLock is a browser-level security extension for Google Chrome. It does **not** replace Windows login, BitLocker, or OS account credentials. It cannot prevent an administrator from ending the Chrome process in Windows Task Manager or launching another browser installed on the computer.
2. **Chrome Internal Pages**: Google Chrome security architecture restricts extension content scripts and tab manipulation on certain privileged internal surfaces (such as `chrome://flags` or Chrome Web Store pages). ChromeLock secures all standard web navigation (`http://`, `https://`, file, local network) and browser new tabs.
3. **Password Recovery**: There is deliberately **no** "Forgot Password" or recovery backdoor built into the UI, as backdoor mechanisms introduce critical attack vectors. If the password is forgotten, recovery is performed at the administrative level by removing the extension from the profile directory.

---

## Manual Testing Verification Checklist (Tests 01–25)

| Test ID | Test Scenario | Expected Outcome | Status |
|---|---|---|---|
| **TEST 01** | First-time installation | Initial setup page (`setup.html`) opens automatically. | Verified |
| **TEST 02** | Create master password | Verifier and salt stored in `storage.local`; lock state activated. | Verified |
| **TEST 03** | Restart Chrome completely | Browser opens strictly in **LOCKED** state. | Verified |
| **TEST 04** | Enter correct password | Browser unlocks; browsing restored to previous tabs. | Verified |
| **TEST 05** | Enter incorrect password once | Card shakes, displays "Incorrect password.", field clears & focuses. | Verified |
| **TEST 06** | 5 consecutive wrong passwords | Lockout triggers: inputs disabled, countdown starts at `00:30`. | Verified |
| **TEST 07** | Cooldown expiration | At `00:00`, inputs re-enable, field focuses, 5 fresh attempts ready. | Verified |
| **TEST 08** | Another 5 wrong passwords | Lockout triggers for **exactly 30 seconds** (no exponential increase). | Verified |
| **TEST 09** | Close Chrome mid-cooldown | Reopen Chrome -> remaining cooldown time is preserved and resumes. | Verified |
| **TEST 10** | Reopen after cooldown elapsed | Chrome opened after 35s -> cooldown cleared, input field ready. | Verified |
| **TEST 11** | `Ctrl + T` while locked | New tab immediately displays ChromeLock screen. | Verified |
| **TEST 12** | `Ctrl + N` while locked | New window opens with ChromeLock screen enforced. | Verified |
| **TEST 13** | Type URL in address bar | Normal web browsing blocked; redirected to lock screen. | Verified |
| **TEST 14** | Click bookmark while locked | Resulting web page is intercepted and redirected to lock screen. | Verified |
| **TEST 15** | External link opens Chrome | Link target saved; Chrome displays lock screen until authenticated. | Verified |
| **TEST 16** | Close lock tab & open new tab | Session remains locked; new tab opens to lock screen. | Verified |
| **TEST 17** | Multiple lock tabs open | Authenticating in any one tab immediately unlocks all tabs. | Verified |
| **TEST 18** | Click popup "LOCK NOW" | Current session immediately locks across all tabs and windows. | Verified |
| **TEST 19** | Press `Ctrl + Shift + L` | Browser locks immediately. | Verified |
| **TEST 20** | Success after 4 wrong tries | Counter resets to 0 failures; session unlocks normally. | Verified |
| **TEST 21** | Change password (wrong current) | Password change rejected; current password remains valid. | Verified |
| **TEST 22** | Change password (valid current) | New verifier derived; old password stops working; new password works. | Verified |
| **TEST 23** | Service worker suspension | Worker re-awakens on navigation and reliably enforces lock. | Verified |
| **TEST 24** | Browser crash / force kill | On reopen, ephemeral session is empty; defaults to LOCKED. | Verified |
| **TEST 25** | No network connection (offline) | All cryptographic operations, lockout, and auth work 100% offline. | Verified |

---

## Build & Version Information

- **Extension Name**: ChromeLock
- **Version**: 1.0.0
- **Platform**: Google Chrome (Manifest V3)
- **Engine**: Vanilla JavaScript (ES Modules), Vanilla HTML5, Vanilla CSS3
- **Dependencies**: None (Zero npm runtime packages, zero external CDNs)
- **Cryptographic Engine**: W3C Web Crypto API (`crypto.subtle`)

---

## Developer Information

- **Developer**: RMA KAWSHAL
- **Email**: [kawshals258@gmail.com](mailto:kawshals258@gmail.com)
- **Phone**: 074 0532 502


