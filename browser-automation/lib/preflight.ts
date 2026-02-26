/**
 * preflight.ts — Pre-flight checks before flow execution
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { PreflightResult } from './step-types.js';
import { isAuthFresh } from './auth-store.js';
import { loadParamsSchema, validateParams } from './param-injector.js';

/** Perform an HTTP HEAD request and return true if status < 400 */
async function isUrlReachable(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    return res.status < 400;
  } catch {
    return false;
  }
}

/** Check available RAM in MB */
function getAvailableRamMb(): number {
  try {
    const mem = readFileSync('/proc/meminfo', 'utf8');
    const match = mem.match(/MemAvailable:\s+(\d+)/);
    return match ? Math.floor(parseInt(match[1]) / 1024) : 9999;
  } catch {
    return 9999; // Non-Linux or error — assume OK
  }
}

/**
 * Run pre-flight checks before executing a flow.
 *
 * @param flowDir    - Local flow directory (contains script.ts, params.schema.json, etc.)
 * @param flowName   - Flow name (for auth lookup)
 * @param targetUrl  - Primary URL the flow targets
 * @param params     - Params to validate against schema
 */
export async function runPreflight(
  flowDir: string,
  flowName: string,
  targetUrl: string,
  params: Record<string, string> = {}
): Promise<PreflightResult> {
  const warnings: string[] = [];

  // 1. URL reachability
  const portal_reachable = await isUrlReachable(targetUrl);
  if (!portal_reachable) {
    warnings.push(`Target URL ${targetUrl} is not reachable.`);
  }

  // 2. Auth freshness
  const auth_fresh = isAuthFresh(flowName);
  if (!auth_fresh) {
    warnings.push('Auth cookies may be expired. Consider running "auth refresh".');
  }

  // 3. Parameter validation
  let params_valid = true;
  const schema = loadParamsSchema(flowDir);
  if (schema) {
    try {
      validateParams(params, schema);
    } catch (err) {
      params_valid = false;
      warnings.push(`Parameter validation failed: ${(err as Error).message}`);
    }
  }

  // 4. Resource check (RAM)
  const availableRam = getAvailableRamMb();
  const resources_ok = availableRam > 200; // need at least 200MB
  if (!resources_ok) {
    warnings.push(
      `Low memory: only ~${availableRam}MB available. Consider --lightweight mode.`
    );
  }

  return { portal_reachable, auth_fresh, params_valid, resources_ok, warnings };
}
