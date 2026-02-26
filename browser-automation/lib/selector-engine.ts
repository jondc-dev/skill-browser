/**
 * selector-engine.ts — Smart selector generation with priority ordering
 *
 * Priority: testId > aria > id > text > css > xpath
 */

import type { SelectorSet } from './step-types.js';

/** Attributes used as test IDs */
const TEST_ID_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa'];

/** Generate a CSS path for an element climbing the DOM tree */
function buildCssPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    if (current.id && !/^\d/.test(current.id)) {
      selector += `#${CSS.escape(current.id)}`;
      parts.unshift(selector);
      break; // ID is unique — stop here
    }

    // Add classes if they look stable (no hash-like suffixes)
    const stableClasses = Array.from(current.classList).filter(
      (c) => !/[_-][a-f0-9]{4,}$/i.test(c) && !/^\d/.test(c)
    );
    if (stableClasses.length > 0) {
      selector += '.' + stableClasses.slice(0, 2).map((c) => CSS.escape(c)).join('.');
    }

    // Add nth-child if needed to disambiguate
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${idx})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

/** Generate an XPath for an element */
function buildXPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.documentElement) {
    const parent = current.parentElement;
    let idx = 1;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        idx = siblings.indexOf(current) + 1;
      }
    }
    const tag = current.tagName.toLowerCase();
    parts.unshift(siblings_count(current) > 1 ? `${tag}[${idx}]` : tag);
    current = current.parentElement;
  }

  return '//' + parts.join('/');
}

function siblings_count(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 1;
  return Array.from(parent.children).filter((s) => s.tagName === el.tagName).length;
}

/**
 * Generate all available selector strategies for a DOM element.
 * Returns selectors in priority order for use in resilientLocator().
 */
export function generateSelectors(el: Element): SelectorSet {
  const result: SelectorSet = {};

  // 1. Test ID attributes (most stable)
  for (const attr of TEST_ID_ATTRS) {
    const val = el.getAttribute(attr);
    if (val) {
      result.testId = `[${attr}="${val}"]`;
      break;
    }
  }

  // 2. ARIA label / role
  const ariaLabel = el.getAttribute('aria-label');
  const role = el.getAttribute('role') || inferRole(el);
  const name = ariaLabel || el.getAttribute('aria-labelledby')
    ? ariaLabel
    : (el as HTMLInputElement).placeholder || (el as HTMLButtonElement).textContent?.trim();

  if (ariaLabel) {
    result.aria = `[aria-label="${ariaLabel}"]`;
  } else if (role && name) {
    result.aria = `${el.tagName.toLowerCase()}[role="${role}"]`;
  }

  // 3. CSS path
  result.css = buildCssPath(el);

  // 4. Visible text content (for buttons, links, labels)
  const text = el.textContent?.trim();
  if (text && text.length > 0 && text.length < 80 && !text.includes('\n')) {
    result.text = text;
  }

  // 5. XPath as last resort
  result.xpath = buildXPath(el);

  return result;
}

/** Infer ARIA role from element tag name */
function inferRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const roleMap: Record<string, string> = {
    button: 'button',
    a: 'link',
    input: 'textbox',
    select: 'listbox',
    textarea: 'textbox',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
  };
  const inputType = (el as HTMLInputElement).type;
  if (tag === 'input' && inputType === 'checkbox') return 'checkbox';
  if (tag === 'input' && inputType === 'radio') return 'radio';
  return roleMap[tag] ?? null;
}

/**
 * Given a SelectorSet, return selectors in priority order as an array of strings
 * suitable for Playwright locator() calls.
 */
export function prioritizedSelectors(selectors: SelectorSet): string[] {
  const result: string[] = [];

  if (selectors.testId) result.push(selectors.testId);
  if (selectors.aria) result.push(selectors.aria);
  if (selectors.text) result.push(`text=${selectors.text}`);
  if (selectors.css) result.push(selectors.css);
  if (selectors.xpath) result.push(`xpath=${selectors.xpath}`);

  return result;
}

/**
 * Return the highest-priority selector string from a SelectorSet.
 */
export function bestSelector(selectors: SelectorSet): string {
  return prioritizedSelectors(selectors)[0] ?? 'body';
}
