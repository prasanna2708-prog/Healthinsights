// Real Web Crypto API AES-256-GCM encryption for HIPAA/GDPR patient identifier pseudonymization.

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export interface SessionCryptoContext {
  key: CryptoKey;
  fingerprint: string;
}

let activeSessionKey: SessionCryptoContext | null = null;

export async function getOrCreateSessionCrypto(): Promise<SessionCryptoContext> {
  if (activeSessionKey) {
    return activeSessionKey;
  }
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  const fingerprint = bytesToHex(digest.slice(0, 8));
  activeSessionKey = { key, fingerprint };
  return activeSessionKey;
}

export async function rotateSessionCryptoKey(): Promise<SessionCryptoContext> {
  activeSessionKey = null;
  return getOrCreateSessionCrypto();
}

export async function deriveKeyFromPassphrase(passphrase: string): Promise<SessionCryptoContext> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const salt = enc.encode('healthinsight-hipaa-aes256-salt-v1');
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  const fingerprint = bytesToHex(digest.slice(0, 8));
  activeSessionKey = { key, fingerprint };
  return activeSessionKey;
}

export async function encryptPatientId(
  patientId: string,
  ctx?: SessionCryptoContext,
): Promise<{ encryptedPatientId: string; maskedPatientId: string; fingerprint: string }> {
  const session = ctx ?? (await getOrCreateSessionCrypto());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(patientId.trim());
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.key, encoded);
  const cipherBytes = new Uint8Array(cipherBuffer);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv, 0);
  combined.set(cipherBytes, iv.length);

  // Deterministic pseudonym suffix via SHA-256 digest for HIPAA Safe Harbor display masking
  const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
  const suffix = bytesToHex(hashBytes.slice(0, 3));

  return {
    encryptedPatientId: `AES256:${bytesToBase64(combined)}`,
    maskedPatientId: `PT-${suffix}`,
    fingerprint: session.fingerprint,
  };
}

export async function decryptPatientId(
  encryptedToken: string,
  ctx?: SessionCryptoContext,
): Promise<string | null> {
  if (!encryptedToken.startsWith('AES256:')) {
    return null;
  }
  const session = ctx ?? activeSessionKey;
  if (!session) {
    return null;
  }
  try {
    const payload = base64ToBytes(encryptedToken.slice('AES256:'.length));
    if (payload.length <= 12) return null;
    const iv = payload.slice(0, 12);
    const cipherBytes = payload.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      session.key,
      cipherBytes,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
