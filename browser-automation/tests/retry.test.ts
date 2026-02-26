/**
 * retry.test.ts — Tests for exponential backoff and per-step retry
 */

import { describe, it, expect, vi } from 'vitest';
import { calcBackoff, withRetry, DEFAULT_RETRY_CONFIG } from '../lib/retry.js';
import type { RetryConfig } from '../lib/step-types.js';

describe('calcBackoff', () => {
  const config: RetryConfig = {
    maxRetries: 3,
    backoffMs: 500,
    backoffMultiplier: 2,
    maxBackoffMs: 8000,
  };

  it('returns backoffMs for attempt 0', () => {
    expect(calcBackoff(0, config)).toBe(500);
  });

  it('doubles each attempt', () => {
    expect(calcBackoff(1, config)).toBe(1000);
    expect(calcBackoff(2, config)).toBe(2000);
    expect(calcBackoff(3, config)).toBe(4000);
  });

  it('caps at maxBackoffMs', () => {
    expect(calcBackoff(10, config)).toBe(8000);
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(0, fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds eventually', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('fail');
      return 'success';
    });

    const config: RetryConfig = {
      maxRetries: 5,
      backoffMs: 1,
      backoffMultiplier: 1,
      maxBackoffMs: 5,
    };

    const result = await withRetry(0, fn, config);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after maxRetries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    const config: RetryConfig = {
      maxRetries: 2,
      backoffMs: 1,
      backoffMultiplier: 1,
      maxBackoffMs: 5,
    };

    await expect(withRetry(0, fn, config)).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('respects onStepFail abort action', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const config: RetryConfig = {
      maxRetries: 5,
      backoffMs: 1,
      backoffMultiplier: 1,
      maxBackoffMs: 5,
    };

    await expect(
      withRetry(0, fn, config, () => 'abort')
    ).rejects.toThrow('fail');

    expect(fn).toHaveBeenCalledTimes(1); // aborted immediately
  });

  it('returns null on skip action', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const config: RetryConfig = {
      maxRetries: 5,
      backoffMs: 1,
      backoffMultiplier: 1,
      maxBackoffMs: 5,
    };

    const result = await withRetry(0, fn, config, () => 'skip');
    expect(result).toBeNull();
  });

  it('calls onStepFail with correct arguments', async () => {
    const onFail = vi.fn(() => 'abort' as const);
    const error = new Error('step failed');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(5, fn, DEFAULT_RETRY_CONFIG, onFail)).rejects.toThrow();
    expect(onFail).toHaveBeenCalledWith(5, error, 0);
  });
});
