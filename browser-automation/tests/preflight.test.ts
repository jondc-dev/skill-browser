/**
 * preflight.test.ts — Tests for pre-flight reachability, auth freshness, param validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'fs';

// Use a temp auth dir for tests
const TEST_AUTH_DIR = join(tmpdir(), `ba-preflight-auth-${Date.now()}`);
const TEST_FLOW_DIR = join(tmpdir(), `ba-preflight-flow-${Date.now()}`);
process.env['BROWSER_AUTO_AUTH_KEY'] = 'test-preflight-key';
process.env['BROWSER_AUTO_AUTH_DIR'] = TEST_AUTH_DIR;

import { runPreflight } from '../lib/preflight.js';
import { saveCookies } from '../lib/auth-store.js';

beforeEach(() => {
  mkdirSync(TEST_FLOW_DIR, { recursive: true });
  mkdirSync(TEST_AUTH_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_FLOW_DIR)) rmSync(TEST_FLOW_DIR, { recursive: true, force: true });
  if (existsSync(TEST_AUTH_DIR)) rmSync(TEST_AUTH_DIR, { recursive: true, force: true });
});

describe('runPreflight', () => {
  it('returns portal_reachable=false for unreachable URL', async () => {
    const result = await runPreflight(
      TEST_FLOW_DIR,
      'test-flow',
      'http://localhost:19999', // nothing listening here
      {}
    );
    expect(result.portal_reachable).toBe(false);
    expect(result.warnings.some((w) => w.includes('not reachable'))).toBe(true);
  });

  it('returns auth_fresh=false when no cookies saved', async () => {
    const result = await runPreflight(
      TEST_FLOW_DIR,
      'no-auth-flow',
      'http://localhost:19999',
      {}
    );
    expect(result.auth_fresh).toBe(false);
    expect(result.warnings.some((w) => w.includes('expired'))).toBe(true);
  });

  it('returns auth_fresh=true when cookies were just saved', async () => {
    saveCookies('fresh-flow', [{ name: 'session', value: 'abc' }] as Record<string, unknown>[]);
    const result = await runPreflight(
      TEST_FLOW_DIR,
      'fresh-flow',
      'http://localhost:19999',
      {}
    );
    expect(result.auth_fresh).toBe(true);
  });

  it('returns params_valid=false when required param is missing', async () => {
    const schema = {
      email: { type: 'string', required: true },
    };
    writeFileSync(
      join(TEST_FLOW_DIR, 'params.schema.json'),
      JSON.stringify(schema),
      'utf8'
    );

    const result = await runPreflight(
      TEST_FLOW_DIR,
      'test-flow',
      'http://localhost:19999',
      {} // no email
    );
    expect(result.params_valid).toBe(false);
  });

  it('returns params_valid=true when required params are present', async () => {
    const schema = {
      email: { type: 'string', required: true },
    };
    writeFileSync(
      join(TEST_FLOW_DIR, 'params.schema.json'),
      JSON.stringify(schema),
      'utf8'
    );

    saveCookies('test-flow', [] as Record<string, unknown>[]);
    const result = await runPreflight(
      TEST_FLOW_DIR,
      'test-flow',
      'http://localhost:19999',
      { email: 'user@example.com' }
    );
    expect(result.params_valid).toBe(true);
  });

  it('returns params_valid=true when no schema file exists', async () => {
    const result = await runPreflight(
      TEST_FLOW_DIR,
      'test-flow',
      'http://localhost:19999',
      {}
    );
    expect(result.params_valid).toBe(true);
  });

  it('always returns a result object with required fields', async () => {
    const result = await runPreflight(
      TEST_FLOW_DIR,
      'test-flow',
      'http://localhost:19999',
      {}
    );
    expect(typeof result.portal_reachable).toBe('boolean');
    expect(typeof result.auth_fresh).toBe('boolean');
    expect(typeof result.params_valid).toBe('boolean');
    expect(typeof result.resources_ok).toBe('boolean');
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
