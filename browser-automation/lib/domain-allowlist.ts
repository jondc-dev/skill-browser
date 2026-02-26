/**
 * domain-allowlist.ts — URL domain allowlisting per flow
 */

/** Check if a URL's hostname matches an allowlist entry.
 *  Supports exact matches and wildcard prefixes (e.g. *.example.com).
 */
export function isDomainAllowed(url: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true; // empty list = allow all

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false; // invalid URL
  }

  for (const pattern of allowedDomains) {
    const lower = pattern.toLowerCase().trim();

    if (lower.startsWith('*.')) {
      // Wildcard: *.example.com matches sub.example.com
      const domain = lower.slice(2);
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return true;
      }
    } else {
      // Exact match
      if (hostname === lower) return true;
    }
  }

  return false;
}

/**
 * Assert that a navigation URL is allowed.
 * Throws a security error if the domain is not in the allowlist.
 */
export function assertDomainAllowed(
  url: string,
  allowedDomains: string[],
  flowName: string
): void {
  if (!isDomainAllowed(url, allowedDomains)) {
    throw new Error(
      `[SECURITY] Navigation to ${url} is blocked by the domain allowlist for flow "${flowName}". ` +
        `Allowed domains: ${allowedDomains.join(', ')}`
    );
  }
}
