/**
 * record.ts — Recording engine (§5.1)
 *
 * Launches a headed Chromium browser, attaches CDP recorder,
 * and saves the recorded flow on Ctrl+Shift+S.
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { CdpRecorder } from '../lib/cdp-recorder.js';
import type { FlowDocument, FlowMetadata } from '../lib/step-types.js';
import { getFlowDir, getFlowsDir } from './list.js';

export interface RecordOptions {
  url: string;
  name: string;
}

/** Run the interactive recording session */
export async function record(options: RecordOptions): Promise<void> {
  const { url, name } = options;
  const flowDir = getFlowDir(name);
  const screenshotsDir = join(flowDir, 'screenshots');
  mkdirSync(screenshotsDir, { recursive: true });

  console.log(chalk.bold.cyan(`\n🎬 Recording flow: ${name}`));
  console.log(chalk.gray(`   URL: ${url}`));
  console.log(chalk.yellow('\n  Hotkeys:'));
  console.log(chalk.yellow('    Ctrl+Shift+S — Stop and save'));
  console.log(chalk.yellow('    Ctrl+Shift+X — Cancel (discard)'));
  console.log(chalk.yellow('    Ctrl+Shift+A — Annotate current step'));
  console.log(chalk.gray('\n  Recording steps:\n'));

  const browser = await chromium.launchPersistentContext(
    join(flowDir, 'user-data'),
    {
      headless: false,
      args: ['--no-default-browser-check'],
    }
  );

  const page = browser.pages()[0] ?? (await browser.newPage());
  const recorder = new CdpRecorder(screenshotsDir);

  await recorder.attach(page, browser);

  // Inject hotkey handler
  let stopSignal: (() => void) | null = null;
  const stopPromise = new Promise<'save' | 'cancel'>((resolve) => {
    stopSignal = () => resolve('save');

    // Expose hotkey handling via page binding
    page.exposeBinding('__baHotkey', (_, action: string) => {
      if (action === 'stop') resolve('save');
      if (action === 'cancel') resolve('cancel');
    }).catch(() => {});

    page.addInitScript(() => {
      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'S') {
          (window as unknown as Record<string, (a: string) => void>)['__baHotkey']?.('stop');
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'X') {
          (window as unknown as Record<string, (a: string) => void>)['__baHotkey']?.('cancel');
        }
      });
    }).catch(() => {});
  });

  // Navigate to start URL
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});

  // Also allow Ctrl+C from terminal
  let terminalStop = false;
  const sigintHandler = () => {
    terminalStop = true;
    stopSignal?.();
  };
  process.on('SIGINT', sigintHandler);

  const action = await stopPromise;
  process.off('SIGINT', sigintHandler);

  const steps = recorder.stop();
  await browser.close();

  if (action === 'cancel' || terminalStop) {
    console.log(chalk.yellow('\n⚠️  Recording cancelled. No flow saved.'));
    return;
  }

  if (steps.length === 0) {
    console.log(chalk.yellow('\n⚠️  No steps recorded.'));
    return;
  }

  const authSteps = recorder.getAuthSteps();
  const metadata: FlowMetadata = {
    name,
    recordedAt: new Date().toISOString(),
    stepsCount: steps.length,
    version: 1,
    url,
    hasAuthFlow: authSteps.length > 0,
  };

  const flowDoc: FlowDocument = {
    metadata,
    steps,
    authSteps: authSteps.length > 0 ? authSteps : undefined,
  };

  writeFileSync(join(flowDir, 'flow.json'), JSON.stringify(flowDoc, null, 2), 'utf8');

  if (authSteps.length > 0) {
    writeFileSync(
      join(flowDir, 'auth-flow.json'),
      JSON.stringify({ metadata, steps: authSteps }, null, 2),
      'utf8'
    );
  }

  console.log(chalk.green(`\n✅ Flow saved: ${name}`));
  console.log(chalk.gray(`   Steps: ${steps.length} (auth: ${authSteps.length})`));
  console.log(chalk.gray(`   Location: ${flowDir}`));
  console.log(chalk.cyan(`\n   Next: browser-auto generate ${name}`));
}
