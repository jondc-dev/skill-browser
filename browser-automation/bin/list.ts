/**
 * list.ts — List stored flows with their metadata
 */

import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import type { FlowDocument } from '../lib/step-types.js';

/** Get the flows directory */
export function getFlowsDir(): string {
  return (
    process.env['BROWSER_AUTO_FLOWS_DIR'] ??
    join(process.env['HOME'] ?? '~', '.openclaw', 'browser-auto', 'flows')
  );
}

/** Get the directory for a specific flow */
export function getFlowDir(flowName: string): string {
  return join(getFlowsDir(), flowName);
}

/** Load a flow document. Returns null if not found. */
export function loadFlow(flowName: string): FlowDocument | null {
  const file = join(getFlowDir(flowName), 'flow.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as FlowDocument;
  } catch {
    return null;
  }
}

/** List all available flow names */
export function listFlowNames(): string[] {
  const dir = getFlowsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'flow.json')))
    .map((e) => e.name);
}

/** Print a formatted list of all flows to stdout */
export function printFlowList(): void {
  const names = listFlowNames();

  if (names.length === 0) {
    console.log(chalk.yellow('No flows found. Record one with: browser-auto record <name> --url <url>'));
    return;
  }

  console.log(chalk.bold(`\nStored flows (${names.length}):\n`));

  for (const name of names) {
    const flow = loadFlow(name);
    if (!flow) continue;

    const { metadata } = flow;
    const date = new Date(metadata.recordedAt).toLocaleDateString();
    const hasScript = existsSync(join(getFlowDir(name), 'script.ts'));
    const scriptBadge = hasScript ? chalk.green('✓ script') : chalk.gray('no script');

    console.log(
      `  ${chalk.cyan(name.padEnd(30))} ${chalk.gray(date.padEnd(12))} ` +
        `${String(metadata.stepsCount).padStart(4)} steps  ${scriptBadge}`
    );
  }

  console.log();
}
