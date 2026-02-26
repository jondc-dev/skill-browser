/**
 * domain-allowlist.test.ts — Tests for allow/block domains with wildcard support
 */

import { describe, it, expect } from 'vitest';
import { isDomainAllowed, assertDomainAllowed } from '../lib/domain-allowlist.js';

describe('isDomainAllowed', () => {
  it('returns true when allowedDomains is empty', () => {
    expect(isDomainAllowed('https://any.site.com/path', [])).toBe(true);
  });

  it('returns true for exact domain match', () => {
    expect(isDomainAllowed('https://example.com/page', ['example.com'])).toBe(true);
  });

  it('returns false for domain not in list', () => {
    expect(isDomainAllowed('https://evil.com/page', ['example.com'])).toBe(false);
  });

  it('matches wildcard subdomain pattern *.example.com', () => {
    expect(isDomainAllowed('https://app.example.com/page', ['*.example.com'])).toBe(true);
  });

  it('matches root domain for wildcard pattern *.example.com', () => {
    expect(isDomainAllowed('https://example.com/page', ['*.example.com'])).toBe(true);
  });

  it('does not match different domain with wildcard', () => {
    expect(isDomainAllowed('https://evil.org', ['*.example.com'])).toBe(false);
  });

  it('handles multiple domains in allowlist', () => {
    const allowed = ['example.com', 'api.example.com', '*.safe.io'];
    expect(isDomainAllowed('https://example.com', allowed)).toBe(true);
    expect(isDomainAllowed('https://api.example.com', allowed)).toBe(true);
    expect(isDomainAllowed('https://sub.safe.io', allowed)).toBe(true);
    expect(isDomainAllowed('https://danger.com', allowed)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isDomainAllowed('https://EXAMPLE.COM/path', ['example.com'])).toBe(true);
  });

  it('returns false for invalid URL', () => {
    expect(isDomainAllowed('not-a-url', ['example.com'])).toBe(false);
  });

  it('handles port in URL correctly', () => {
    expect(isDomainAllowed('https://example.com:8080/path', ['example.com'])).toBe(true);
  });
});

describe('assertDomainAllowed', () => {
  it('does not throw for allowed domains', () => {
    expect(() =>
      assertDomainAllowed('https://example.com/page', ['example.com'], 'my-flow')
    ).not.toThrow();
  });

  it('throws a security error for blocked domains', () => {
    expect(() =>
      assertDomainAllowed('https://evil.com/page', ['example.com'], 'my-flow')
    ).toThrow(/SECURITY/);
  });

  it('includes the flow name and blocked URL in the error message', () => {
    let errorMessage = '';
    try {
      assertDomainAllowed('https://malicious.net', ['example.com'], 'my-flow');
    } catch (err) {
      errorMessage = (err as Error).message;
    }
    expect(errorMessage).toContain('my-flow');
    expect(errorMessage).toContain('malicious.net');
  });
});
