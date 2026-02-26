/**
 * param-injector.test.ts — Tests for template substitution, Zod validation, sensitive masking
 */

import { describe, it, expect } from 'vitest';
import {
  injectParams,
  injectParamsDeep,
  validateParams,
  maskSensitiveParams,
  extractPlaceholders,
  buildZodSchema,
} from '../lib/param-injector.js';
import type { ParamsSchema } from '../lib/param-injector.js';

describe('injectParams', () => {
  it('replaces {{param}} placeholders with values', () => {
    const result = injectParams('Hello, {{name}}!', { name: 'Alice' });
    expect(result).toBe('Hello, Alice!');
  });

  it('replaces multiple placeholders', () => {
    const result = injectParams('{{greeting}} {{name}}!', { greeting: 'Hi', name: 'Bob' });
    expect(result).toBe('Hi Bob!');
  });

  it('leaves unresolved placeholders intact', () => {
    const result = injectParams('Hello, {{name}}! Your ID is {{id}}', { name: 'Alice' });
    expect(result).toBe('Hello, Alice! Your ID is {{id}}');
  });

  it('handles empty params gracefully', () => {
    const result = injectParams('No placeholders here.', {});
    expect(result).toBe('No placeholders here.');
  });
});

describe('injectParamsDeep', () => {
  it('substitutes nested string values in objects', () => {
    const obj = { url: 'https://example.com/user/{{userId}}', label: 'Item {{id}}' };
    const result = injectParamsDeep(obj, { userId: '42', id: '7' }) as typeof obj;
    expect(result.url).toBe('https://example.com/user/42');
    expect(result.label).toBe('Item 7');
  });

  it('substitutes values inside arrays', () => {
    const arr = ['{{a}}', '{{b}}'];
    const result = injectParamsDeep(arr, { a: 'x', b: 'y' }) as string[];
    expect(result).toEqual(['x', 'y']);
  });

  it('handles deeply nested structures', () => {
    const obj = { level1: { level2: '{{deep}}' } };
    const result = injectParamsDeep(obj, { deep: 'found' }) as typeof obj;
    expect(result.level1.level2).toBe('found');
  });

  it('leaves non-string values unchanged', () => {
    const obj = { count: 42, flag: true, text: '{{text}}' };
    const result = injectParamsDeep(obj, { text: 'hello' }) as typeof obj;
    expect(result.count).toBe(42);
    expect(result.flag).toBe(true);
  });
});

describe('validateParams', () => {
  const schema: ParamsSchema = {
    name: { type: 'string', required: true },
    age: { type: 'number', required: false },
    email: { type: 'string', required: true, pattern: '^[^@]+@[^@]+$' },
  };

  it('passes valid params', () => {
    const result = validateParams({ name: 'Alice', email: 'alice@example.com' }, schema);
    expect(result['name']).toBe('Alice');
  });

  it('throws on missing required param', () => {
    expect(() => validateParams({ name: 'Alice' }, schema)).toThrow();
  });

  it('throws on pattern mismatch', () => {
    expect(() =>
      validateParams({ name: 'Alice', email: 'not-an-email' }, schema)
    ).toThrow();
  });

  it('coerces number strings', () => {
    const result = validateParams(
      { name: 'Alice', email: 'a@b.com', age: '25' },
      schema
    );
    expect(result['age']).toBe(25);
  });
});

describe('maskSensitiveParams', () => {
  it('masks fields named "password"', () => {
    const masked = maskSensitiveParams({ password: 'secret', name: 'Alice' });
    expect(masked['password']).toBe('***');
    expect(masked['name']).toBe('Alice');
  });

  it('masks fields marked sensitive in schema', () => {
    const schema: ParamsSchema = {
      token: { type: 'string', sensitive: true },
      name: { type: 'string' },
    };
    const masked = maskSensitiveParams({ token: 'abc123', name: 'Alice' }, schema);
    expect(masked['token']).toBe('***');
    expect(masked['name']).toBe('Alice');
  });

  it('masks common sensitive field names', () => {
    const masked = maskSensitiveParams({
      password: 'p',
      secret: 's',
      apikey: 'k',
      token: 't',
    });
    for (const key of ['password', 'secret', 'apikey', 'token']) {
      expect(masked[key]).toBe('***');
    }
  });
});

describe('extractPlaceholders', () => {
  it('extracts all placeholder names', () => {
    const placeholders = extractPlaceholders('{{name}} is going to {{location}} on {{date}}');
    expect(placeholders).toEqual(expect.arrayContaining(['name', 'location', 'date']));
  });

  it('deduplicates placeholders', () => {
    const placeholders = extractPlaceholders('{{id}} and {{id}} again');
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]).toBe('id');
  });

  it('returns empty array when no placeholders', () => {
    expect(extractPlaceholders('no placeholders')).toEqual([]);
  });
});
