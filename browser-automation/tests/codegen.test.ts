/**
 * codegen.test.ts — Tests for step-to-code mapping and parameter detection
 */

import { describe, it, expect } from 'vitest';
import { generateStepCode, detectParam, detectParameters } from '../lib/codegen.js';
import type { RecordedStep } from '../lib/step-types.js';

const baseStep: RecordedStep = {
  index: 0,
  timestamp: Date.now(),
  type: 'navigate',
  selectors: {},
  pageUrl: 'https://example.com',
  url: 'https://example.com',
};

describe('generateStepCode', () => {
  it('generates page.goto for navigate steps', () => {
    const code = generateStepCode({ ...baseStep, type: 'navigate', url: 'https://example.com' });
    expect(code).toContain('page.goto("https://example.com"');
    expect(code).toContain("networkidle");
  });

  it('generates resilientLocator().click() for click steps', () => {
    const step: RecordedStep = {
      ...baseStep,
      type: 'click',
      selectors: { testId: '[data-testid="btn"]' },
    };
    const code = generateStepCode(step);
    expect(code).toContain('resilientLocator');
    expect(code).toContain('.click()');
  });

  it('generates resilientLocator().fill() for type steps', () => {
    const step: RecordedStep = {
      ...baseStep,
      type: 'type',
      selectors: { css: 'input.email' },
      value: 'hello',
    };
    const code = generateStepCode(step);
    expect(code).toContain('.fill(');
  });

  it('generates selectOption() for select steps', () => {
    const step: RecordedStep = {
      ...baseStep,
      type: 'select',
      selectors: { css: 'select#role' },
      value: 'admin',
    };
    const code = generateStepCode(step);
    expect(code).toContain('.selectOption(');
  });

  it('generates page.keyboard.press() for keypress steps', () => {
    const step: RecordedStep = {
      ...baseStep,
      type: 'keypress',
      selectors: {},
      key: 'Tab',
    };
    const code = generateStepCode(step);
    expect(code).toContain('page.keyboard.press("Tab")');
  });

  it('generates page.mouse.wheel() for scroll steps', () => {
    const step: RecordedStep = {
      ...baseStep,
      type: 'scroll',
      selectors: {},
      value: '500',
    };
    const code = generateStepCode(step);
    expect(code).toContain('page.mouse.wheel(0, 500)');
  });

  it('adds waitBefore timeout when specified', () => {
    const step: RecordedStep = {
      ...baseStep,
      type: 'click',
      selectors: { css: 'button' },
      waitBefore: 1000,
    };
    const code = generateStepCode(step);
    expect(code).toContain('waitForTimeout(1000)');
  });

  it('adds TODO comment for ambiguous selectors', () => {
    const step: RecordedStep = {
      ...baseStep,
      type: 'click',
      selectors: { css: 'div > span' }, // no testId, aria, or text
    };
    const code = generateStepCode(step);
    expect(code).toContain('// TODO:');
  });
});

describe('detectParam', () => {
  it('detects report IDs like GP-4421', () => {
    expect(detectParam('GP-4421')).toBe('{{reportId}}');
  });

  it('detects dates in YYYY-MM-DD format', () => {
    expect(detectParam('2024-03-15')).toBe('{{date}}');
  });

  it('detects email addresses', () => {
    expect(detectParam('user@example.com')).toBe('{{email}}');
  });

  it('detects name fields via hint', () => {
    expect(detectParam('John Smith', 'full-name')).toBe('{{name}}');
  });

  it('returns null for plain values', () => {
    expect(detectParam('hello world')).toBeNull();
  });
});

describe('detectParameters', () => {
  it('extracts reportId param from steps', () => {
    const steps: RecordedStep[] = [
      { ...baseStep, type: 'type', value: 'GP-12345', selectors: { css: '#search' } },
    ];
    const params = detectParameters(steps);
    expect(params).toHaveProperty('reportId');
  });

  it('extracts email param from steps', () => {
    const steps: RecordedStep[] = [
      { ...baseStep, type: 'type', value: 'user@test.com', selectors: { css: '#email' } },
    ];
    const params = detectParameters(steps);
    expect(params).toHaveProperty('email');
  });

  it('returns empty object when no parameterisable values', () => {
    const steps: RecordedStep[] = [
      { ...baseStep, type: 'navigate', url: 'https://example.com', selectors: {} },
    ];
    const params = detectParameters(steps);
    expect(Object.keys(params)).toHaveLength(0);
  });
});
