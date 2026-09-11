/**
 * ChromeLock - Cryptographic Service
 * Powered by standard W3C Web Crypto API (SubtleCrypto).
 *
 * Implements PBKDF2 key derivation using SHA-256 with 100,000 iterations,
 * a 16-byte cryptographically secure random salt, and constant-time comparison.
 * Never exposes or logs plaintext passwords.
 */

const DEFAULT_ITERATIONS = 100000;
const SALT_BYTE_LENGTH = 16;
const DERIVED_KEY_BIT_LENGTH = 256; // 32 bytes

/**
 * Converts a Uint8Array or ArrayBuffer to a lowercase hex string.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {string}
 */
export function bufferToHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Converts a hex string back into a Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToBuffer(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Generates a cryptographically secure random salt.
 * @param {number} byteLength
 * @returns {string} Hex-encoded salt
 */
export function generateSalt(byteLength = SALT_BYTE_LENGTH) {
  const array = new Uint8Array(byteLength);
  crypto.getRandomValues(array);
  return bufferToHex(array);
}

/**
 * Derives a cryptographic verifier key from a password and salt using PBKDF2-SHA-256.
 * @param {string} password - Raw user password
 * @param {string} saltHex - Hex-encoded salt
 * @param {number} iterations - PBKDF2 iterations (default 100,000)
 * @returns {Promise<string>} Hex-encoded derived key (256-bit verifier)
 */
export async function deriveKey(password, saltHex, iterations = DEFAULT_ITERATIONS) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }

  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const saltBytes = hexToBuffer(saltHex);

  // Import raw password as key material for PBKDF2
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  // Derive 256 bits (32 bytes)
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256'
    },
    baseKey,
    DERIVED_KEY_BIT_LENGTH
  );

  return bufferToHex(derivedBits);
}

/**
 * Constant-time equality comparison between two strings to prevent timing side channels.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verifies a candidate password against the stored salt and verifier hash.
 * @param {string} candidatePassword
 * @param {string} storedSaltHex
 * @param {string} storedVerifierHex
 * @param {number} iterations
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(
  candidatePassword,
  storedSaltHex,
  storedVerifierHex,
  iterations = DEFAULT_ITERATIONS
) {
  try {
    const candidateVerifier = await deriveKey(candidatePassword, storedSaltHex, iterations);
    return timingSafeEqual(candidateVerifier, storedVerifierHex);
  } catch (err) {
    return false;
  }
}

export const CryptoService = {
  DEFAULT_ITERATIONS,
  bufferToHex,
  hexToBuffer,
  generateSalt,
  deriveKey,
  timingSafeEqual,
  verifyPassword
};

