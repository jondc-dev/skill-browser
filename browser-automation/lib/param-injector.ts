/**
 * param-injector.ts — Template variable substitution and Zod validation
 */

import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/** Sensitive field names masked in logs */
const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /apikey/i,
  /api_key/i,
  /credential/i,
  /ssn/i,
  /cvv/i,
];

/** Zod schema entry from params.schema.json */
export interface ParamSchemaEntry {
  type: 'string' | 'number' | 'boolean' | 'date';
  description?: string;
  required?: boolean;
  sensitive?: boolean;
  default?: string;
  pattern?: string;
}

/** Full params schema file shape */
export type ParamsSchema = Record<string, ParamSchemaEntry>;

/** Load params schema from a flow's params.schema.json */
export function loadParamsSchema(flowDir: string): ParamsSchema | null {
  const schemaFile = join(flowDir, 'params.schema.json');
  if (!existsSync(schemaFile)) return null;
  return JSON.parse(readFileSync(schemaFile, 'utf8')) as ParamsSchema;
}

/** Build a Zod schema from a ParamsSchema definition */
export function buildZodSchema(schema: ParamsSchema): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};

  for (const [key, entry] of Object.entries(schema)) {
    let field: z.ZodTypeAny;

    switch (entry.type) {
      case 'number':
        field = z.coerce.number();
        break;
      case 'boolean':
        field = z.coerce.boolean();
        break;
      case 'date':
        field = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Must be a date in YYYY-MM-DD format');
        break;
      default:
        field = entry.pattern
          ? z.string().regex(new RegExp(entry.pattern), `Must match pattern ${entry.pattern}`)
          : z.string();
    }

    if (entry.default !== undefined) {
      field = field.default(entry.default);
    }

    if (!entry.required) {
      field = field.optional();
    }

    shape[key] = field;
  }

  return z.object(shape);
}

/** Validate params against a schema, throwing if invalid */
export function validateParams(
  params: Record<string, unknown>,
  schema: ParamsSchema
): Record<string, string> {
  const zodSchema = buildZodSchema(schema);
  const result = zodSchema.safeParse(params);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Parameter validation failed:\n${errors}`);
  }

  return result.data as Record<string, string>;
}

/**
 * Replace {{paramName}} placeholders in a string with actual values.
 * Returns the substituted string.
 */
export function injectParams(
  template: string,
  params: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (key in params) return String(params[key]);
    return `{{${key}}}`; // leave unresolved
  });
}

/**
 * Inject params into an entire object (deep substitution in string values).
 */
export function injectParamsDeep(
  obj: unknown,
  params: Record<string, string>
): unknown {
  if (typeof obj === 'string') return injectParams(obj, params);
  if (Array.isArray(obj)) return obj.map((item) => injectParamsDeep(item, params));
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = injectParamsDeep(v, params);
    }
    return result;
  }
  return obj;
}

/** Mask sensitive parameter values for safe logging */
export function maskSensitiveParams(
  params: Record<string, string>,
  schema?: ParamsSchema
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const isSensitiveBySchema = schema?.[key]?.sensitive === true;
    const isSensitiveByName = SENSITIVE_FIELD_PATTERNS.some((p) => p.test(key));
    masked[key] = isSensitiveBySchema || isSensitiveByName ? '***' : value;
  }
  return masked;
}

/** Extract all {{param}} placeholders from a template string */
export function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}
