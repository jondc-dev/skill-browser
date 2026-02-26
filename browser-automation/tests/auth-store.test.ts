/**
 * auth-store.test.ts — Tests for AES-256-GCM encrypt/decrypt and credential storage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';

// Set up test auth key and directory
const TEST_AUTH_DIR = join(tmpdir(), `ba-test-auth-${Date.now()}`);
process.env['BROWSER_AUTO_AUTH_KEY'] = 'test-secret-key-for-unit-tests';
process.env['BROWSER_AUTO_AUTH_DIR'] = TEST_AUTH_DIR;

import {
  encrypt,
  decrypt,
  saveCookies,
  loadCookies,
  isAuthFresh,
  saveCredentials,
  loadCredentials,
  clearAuth,
} from '../lib/auth-store.js';

afterEach(() => {
  if (existsSync(TEST_AUTH_DIR)) rmSync(TEST_AUTH_DIR, { recursive: true, force: true });
});

describe('encrypt / decrypt', () => {
  it('round-trips a plaintext string', () => {
    const plain = 'Hello, World! 🌍';
    const ciphertext = encrypt(plain);
    expect(ciphertext).not.toBe(plain);
    expect(decrypt(ciphertext)).toBe(plain);
  });

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    const plain = 'same input';
    const c1 = encrypt(plain);
    const c2 = encrypt(plain);
    expect(c1).not.toBe(c2);
    expect(decrypt(c1)).toBe(plain);
    expect(decrypt(c2)).toBe(plain);
  });

  it('decrypts JSON payloads correctly', () => {
    const obj = { cookies: [{ name: 'session', value: 'abc123' }] };
    const ciphertext = encrypt(JSON.stringify(obj));
    const decrypted = JSON.parse(decrypt(ciphertext)) as typeof obj;
    expect(decrypted.cookies[0].value).toBe('abc123');
  });

  it('throws with wrong key', () => {
    const ciphertext = encrypt('secret data');
    // Change the key
    process.env['BROWSER_AUTO_AUTH_KEY'] = 'wrong-key';
    expect(() => decrypt(ciphertext)).toThrow();
    // Restore
    process.env['BROWSER_AUTO_AUTH_KEY'] = 'test-secret-key-for-unit-tests';
  });
});

describe('saveCookies / loadCookies', () => {
  const cookies = [{ name: 'session', value: 'abc123', domain: 'example.com' }];

  it('saves and loads cookies correctly', () => {
    saveCookies('test-flow', cookies as Record<string, unknown>[]);
    const loaded = loadCookies('test-flow');
    expect(loaded).not.toBeNull();
    expect(loaded!.cookies).toEqual(cookies);
  });

  it('includes a savedAt timestamp', () => {
    saveCookies('test-flow', cookies as Record<string, unknown>[]);
    const loaded = loadCookies('test-flow');
    expect(loaded!.savedAt).toBeTruthy();
    expect(new Date(loaded!.savedAt).getTime()).toBeGreaterThan(0);
  });

  it('returns null when no auth file exists', () => {
    expect(loadCookies('nonexistent-flow')).toBeNull();
  });
});

describe('isAuthFresh', () => {
  it('returns false when no auth file exists', () => {
    expect(isAuthFresh('no-auth-flow')).toBe(false);
  });

  it('returns true for freshly saved cookies', () => {
    saveCookies('fresh-flow', [{ name: 's', value: 'v' }] as Record<string, unknown>[]);
    expect(isAuthFresh('fresh-flow')).toBe(true);
  });
});

describe('saveCredentials / loadCredentials', () => {
  it('saves and loads credentials correctly', () => {
    saveCredentials('test-flow', {
      username: 'user@example.com',
      password: 'secret123',
    });
    const loaded = loadCredentials('test-flow');
    expect(loaded).not.toBeNull();
    expect(loaded!.username).toBe('user@example.com');
    expect(loaded!.password).toBe('secret123');
  });

  it('supports TOTP secret storage', () => {
    saveCredentials('test-flow', { totpSecret: 'JBSWY3DPEHPK3PXP' });
    const loaded = loadCredentials('test-flow');
    expect(loaded!.totpSecret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('returns null when no credentials file exists', () => {
    expect(loadCredentials('no-creds-flow')).toBeNull();
  });
});

describe('clearAuth', () => {
  it('removes the auth directory for a flow', () => {
    saveCookies('clear-test', [{ name: 's', value: 'v' }] as Record<string, unknown>[]);
    expect(loadCookies('clear-test')).not.toBeNull();
    clearAuth('clear-test');
    expect(loadCookies('clear-test')).toBeNull();
  });

  it('does not throw when directory does not exist', () => {
    expect(() => clearAuth('nonexistent')).not.toThrow();
  });
});
