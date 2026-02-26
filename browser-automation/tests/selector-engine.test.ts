/**
 * selector-engine.test.ts — Tests for selector priority and generation
 */

import { describe, it, expect } from 'vitest';
import { prioritizedSelectors, bestSelector } from '../lib/selector-engine.js';
import type { SelectorSet } from '../lib/step-types.js';

describe('prioritizedSelectors', () => {
  it('returns testId first when available', () => {
    const sel: SelectorSet = {
      testId: '[data-testid="submit"]',
      aria: '[aria-label="Submit"]',
      css: 'button.submit',
      text: 'Submit',
      xpath: '//button[1]',
    };
    const ordered = prioritizedSelectors(sel);
    expect(ordered[0]).toBe('[data-testid="submit"]');
  });

  it('skips testId and returns aria when testId is absent', () => {
    const sel: SelectorSet = {
      aria: '[aria-label="Submit"]',
      css: 'button.submit',
      text: 'Submit',
    };
    const ordered = prioritizedSelectors(sel);
    expect(ordered[0]).toBe('[aria-label="Submit"]');
  });

  it('uses text= prefix for text selectors', () => {
    const sel: SelectorSet = {
      text: 'Submit',
      css: 'button',
    };
    const ordered = prioritizedSelectors(sel);
    expect(ordered).toContain('text=Submit');
  });

  it('uses xpath= prefix for xpath selectors', () => {
    const sel: SelectorSet = {
      xpath: '//button[1]',
    };
    const ordered = prioritizedSelectors(sel);
    expect(ordered).toContain('xpath=//button[1]');
  });

  it('returns empty array for empty SelectorSet', () => {
    expect(prioritizedSelectors({})).toEqual([]);
  });

  it('returns all available selectors in correct order', () => {
    const sel: SelectorSet = {
      testId: '[data-testid="btn"]',
      css: 'button',
      text: 'Click me',
    };
    const ordered = prioritizedSelectors(sel);
    // testId > text > css (per spec: text is more readable than CSS path)
    expect(ordered.indexOf('[data-testid="btn"]')).toBeLessThan(ordered.indexOf('text=Click me'));
    expect(ordered.indexOf('text=Click me')).toBeLessThan(ordered.indexOf('button'));
  });
});

describe('bestSelector', () => {
  it('returns the highest priority selector', () => {
    const sel: SelectorSet = {
      testId: '[data-testid="btn"]',
      css: 'button',
    };
    expect(bestSelector(sel)).toBe('[data-testid="btn"]');
  });

  it('returns "body" as fallback for empty SelectorSet', () => {
    expect(bestSelector({})).toBe('body');
  });

  it('returns css selector when no testId or aria', () => {
    const sel: SelectorSet = { css: 'input.email' };
    expect(bestSelector(sel)).toBe('input.email');
  });
});
