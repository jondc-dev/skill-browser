/**
 * flow-versioning.ts — Flow versioning and rollback support
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  readdirSync,
  mkdirSync,
} from 'fs';
import { join, basename } from 'path';
import type { FlowVersion } from './step-types.js';

/** Path to versioning metadata file for a flow */
function getVersionsFile(flowDir: string): string {
  return join(flowDir, 'versions.json');
}

/** Load version history for a flow */
export function loadVersionHistory(flowDir: string): FlowVersion[] {
  const file = getVersionsFile(flowDir);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as FlowVersion[];
  } catch {
    return [];
  }
}

/** Save version history for a flow */
function saveVersionHistory(flowDir: string, history: FlowVersion[]): void {
  writeFileSync(getVersionsFile(flowDir), JSON.stringify(history, null, 2), 'utf8');
}

/**
 * When generating a new script.ts, archive the previous version.
 * Returns the new version number.
 */
export function archiveCurrentScript(flowDir: string): number {
  const scriptFile = join(flowDir, 'script.ts');
  if (!existsSync(scriptFile)) return 1;

  const history = loadVersionHistory(flowDir);
  const nextVersion = (history[history.length - 1]?.version ?? 0) + 1;

  const archiveFile = join(flowDir, `script.v${nextVersion}.ts`);
  copyFileSync(scriptFile, archiveFile);

  history.push({
    version: nextVersion,
    savedAt: new Date().toISOString(),
    scriptFile: basename(archiveFile),
    successRate: undefined,
    runCount: 0,
  });

  saveVersionHistory(flowDir, history);
  return nextVersion + 1;
}

/**
 * Rollback to the last working version (highest successRate > 0, or most recent).
 * Returns true if rollback succeeded.
 */
export function rollback(flowDir: string): boolean {
  const history = loadVersionHistory(flowDir);
  if (history.length === 0) return false;

  // Prefer version with highest success rate
  const sorted = [...history].sort((a, b) => {
    const aRate = a.successRate ?? 0;
    const bRate = b.successRate ?? 0;
    return bRate - aRate || b.version - a.version;
  });

  const target = sorted[0];
  const archiveFile = join(flowDir, target.scriptFile);
  if (!existsSync(archiveFile)) return false;

  // Archive the current script first
  archiveCurrentScript(flowDir);

  // Copy the target version back as script.ts
  copyFileSync(archiveFile, join(flowDir, 'script.ts'));
  return true;
}

/** Update success rate for the latest version after a run */
export function recordRunResult(
  flowDir: string,
  success: boolean
): void {
  const history = loadVersionHistory(flowDir);
  if (history.length === 0) return;

  const latest = history[history.length - 1];
  const runs = (latest.runCount ?? 0) + 1;
  const prevSuccesses = Math.round((latest.successRate ?? 0) * (runs - 1));
  const newSuccesses = prevSuccesses + (success ? 1 : 0);

  latest.runCount = runs;
  latest.successRate = newSuccesses / runs;

  saveVersionHistory(flowDir, history);
}

/** Compute a simple hash of a DOM snapshot string */
export function hashDomSnapshot(html: string): string {
  let hash = 0;
  for (let i = 0; i < html.length; i++) {
    hash = ((hash << 5) - hash + html.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}
