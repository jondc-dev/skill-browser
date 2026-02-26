/**
 * auth-store.ts — AES-256-GCM encrypted storage for cookies and credentials
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT = 'browser-auto-salt-v1';

/** Base directory for per-agent auth storage */
export function getAuthBaseDir(): string {
  return (
    process.env['BROWSER_AUTO_AUTH_DIR'] ??
    join(homedir(), '.openclaw', 'browser-auto', 'auth')
  );
}

/** Directory for a specific flow's auth data */
export function getFlowAuthDir(flowName: string): string {
  return join(getAuthBaseDir(), flowName);
}

/** Derive a 32-byte key from the env var auth key */
function deriveKey(): Buffer {
  const rawKey = process.env['BROWSER_AUTO_AUTH_KEY'];
  if (!rawKey) {
    throw new Error(
      'BROWSER_AUTO_AUTH_KEY environment variable is required for auth storage. ' +
        'Set it to a secure random string.'
    );
  }
  return scryptSync(rawKey, SALT, KEY_LENGTH) as Buffer;
}

/** Encrypt a plaintext string and return a base64-encoded ciphertext */
export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: iv(12) + authTag(16) + ciphertext — all base64
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/** Decrypt a base64-encoded ciphertext and return the plaintext string */
export function decrypt(ciphertext: string): string {
  const key = deriveKey();
  const buf = Buffer.from(ciphertext, 'base64');

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final('utf8');
}

/** Save cookies for a flow (encrypted) */
export function saveCookies(
  flowName: string,
  cookies: Record<string, unknown>[]
): void {
  const dir = getFlowAuthDir(flowName);
  mkdirSync(dir, { recursive: true });

  const payload = JSON.stringify({ cookies, savedAt: new Date().toISOString() });
  const encrypted = encrypt(payload);
  writeFileSync(join(dir, 'auth.json'), encrypted, 'utf8');
}

/** Load cookies for a flow (decrypted). Returns null if not found. */
export function loadCookies(
  flowName: string
): { cookies: Record<string, unknown>[]; savedAt: string } | null {
  const file = join(getFlowAuthDir(flowName), 'auth.json');
  if (!existsSync(file)) return null;

  const encrypted = readFileSync(file, 'utf8');
  const payload = decrypt(encrypted);
  return JSON.parse(payload);
}

/** Check if stored auth is considered fresh (< 8 hours old) */
export function isAuthFresh(flowName: string): boolean {
  const data = loadCookies(flowName);
  if (!data) return false;

  const savedAt = new Date(data.savedAt).getTime();
  const ageMs = Date.now() - savedAt;
  return ageMs < 8 * 60 * 60 * 1000; // 8 hours
}

/** Credential storage type */
export interface StoredCredentials {
  username?: string;
  password?: string;
  totpSecret?: string;
}

/** Save login credentials for a flow (encrypted) */
export function saveCredentials(
  flowName: string,
  creds: StoredCredentials
): void {
  const dir = getFlowAuthDir(flowName);
  mkdirSync(dir, { recursive: true });

  const payload = JSON.stringify(creds);
  const encrypted = encrypt(payload);
  writeFileSync(join(dir, 'auth-creds.json'), encrypted, 'utf8');
}

/** Load login credentials for a flow (decrypted). Returns null if not found. */
export function loadCredentials(flowName: string): StoredCredentials | null {
  const file = join(getFlowAuthDir(flowName), 'auth-creds.json');
  if (!existsSync(file)) return null;

  const encrypted = readFileSync(file, 'utf8');
  const payload = decrypt(encrypted);
  return JSON.parse(payload);
}

/** Clear all auth data for a flow */
export function clearAuth(flowName: string): void {
  const dir = getFlowAuthDir(flowName);
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
}

/** Clear all auth data for a flow (async variant — same impl) */
export async function clearAuthAsync(flowName: string): Promise<void> {
  clearAuth(flowName);
}
