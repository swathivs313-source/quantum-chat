import { pqcEncapsulate, pqcDecapsulate } from './pqc';

/**
 * vaultCrypto.js
 * Handles client-side encryption for the Quantum Vault.
 */

const base64ToBytes = (str) => {
  const binString = atob(str);
  return Uint8Array.from(binString, (m) => m.charCodeAt(0));
};

const bytesToBase64 = (bytes) => {
  const binString = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binString);
};

// ── KEY DERIVATION (PBKDF2) ──────────────────────────────────────────────────
export const derivePinKey = async (pin, saltStr, iterations = 100000) => {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw', encoder.encode(pin), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  
  const salt = base64ToBytes(saltStr);
  
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

// ── VAULT KEY MANAGEMENT ─────────────────────────────────────────────────────
export const initializeVault = async (kyberPubKey) => {
  // 1. Generate local Vault Key
  const vaultKey = crypto.getRandomValues(new Uint8Array(32));
  
  // 2. Wrap it using Kyber
  const { sharedSecret, ciphertext } = pqcEncapsulate(kyberPubKey);
  
  // 3. Encrypt the Vault Key with the Kyber Shared Secret (Hybrid Wrap)
  const wrappingKey = await crypto.subtle.importKey('raw', sharedSecret, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedVaultKey = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, vaultKey);
  
  // 4. Return the bundle to save on server
  const combined = new Uint8Array(iv.length + new Uint8Array(encryptedVaultKey).length);
  combined.set(iv);
  combined.set(new Uint8Array(encryptedVaultKey), iv.length);

  return {
    vaultKey, // Return raw key only for first-time session
    wrapped_key: bytesToBase64(combined),
    kem_ct: ciphertext
  };
};

// ── FILE ENCRYPTION ──────────────────────────────────────────────────────────
export const encryptVaultItem = async (data, vaultKeyBytes) => {
  const key = await crypto.subtle.importKey('raw', vaultKeyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return bytesToBase64(combined);
};

export const decryptVaultItem = async (encryptedBase64, vaultKeyBytes) => {
  const fullData = base64ToBytes(encryptedBase64);
  const iv = fullData.slice(0, 12);
  const ciphertext = fullData.slice(12);
  
  const key = await crypto.subtle.importKey('raw', vaultKeyBytes, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  
  return new Uint8Array(decrypted);
};
