/**
 * execute.ts — Script runner with retry, auth, tracing, and batch support (§5.4)
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, isAbsolute } from 'path';
import chalk from 'chalk';
import type { RunResult, StepError } from '../lib/step-types.js';
import { loadCookies, saveCookies } from '../lib/auth-store.js';
import { runPreflight } from '../lib/preflight.js';
import { RunLogger } from '../lib/run-logger.js';
import { recordRunResult } from '../lib/flow-versioning.js';
import { assertDomainAllowed } from '../lib/domain-allowlist.js';
import { captureScreenshot } from '../lib/screenshot.js';
import { loadFlow, getFlowDir } from './list.js';
import { injectParams } from '../lib/param-injector.js';

export interface ExecuteOptions {
  name: string;
  params?: Record<string, string>;
  json?: boolean;
  batch?: string;
  parallel?: number;
  dryRun?: boolean;
  lightweight?: boolean;
  cdpUrl?: string;
  headed?: boolean;
  delayBetween?: number;
}

/** Detect auth failure patterns in the current page */
async function isAuthFailure(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  const authPatterns = ['/login', '/signin', '/sign-in', '/auth/login'];
  if (authPatterns.some((p) => url.includes(p))) return true;

  try {
    const bodyText = await page.textContent('body') ?? '';
    const failPatterns = ['session expired', 'please log in', 'unauthorized', 'access denied'];
    return failPatterns.some((p) => bodyText.toLowerCase().includes(p));
  } catch {
    return false;
  }
}

/**
 * Execute a single flow run. Returns a structured RunResult.
 */
export async function execute(options: ExecuteOptions): Promise<RunResult> {
  const { name, params = {}, json = false, dryRun = false, lightweight = false,
    cdpUrl, headed = false, delayBetween = 0 } = options;

  const flow = loadFlow(name);
  if (!flow) {
    const msg = `Flow "${name}" not found.`;
    if (json) console.log(JSON.stringify({ success: false, error: msg }));
    else console.error(chalk.red(`❌ ${msg}`));
    process.exit(1);
  }

  const flowDir = getFlowDir(name);
  const screenshotsDir = join(flowDir, 'screenshots');
  const logsDir = join(flowDir, 'run-logs');
  mkdirSync(screenshotsDir, { recursive: true });

  const logger = new RunLogger(name, params);

  // Pre-flight checks
  if (!dryRun) {
    const preflight = await runPreflight(flowDir, name, flow.metadata.url, params);
    for (const warning of preflight.warnings) {
      if (!json) console.warn(chalk.yellow(`⚠️  ${warning}`));
    }
  }

  if (!json) {
    console.log(chalk.bold.cyan(`\n▶ Running flow: ${name}`));
    if (dryRun) console.log(chalk.yellow('  (dry run — no browser launched)'));
  }

  if (dryRun) {
    const result: RunResult = {
      success: true,
      confirmation: `Dry run for "${name}" completed (${flow.steps.length} steps)`,
      flow: name,
      duration_ms: 0,
      steps_completed: flow.steps.length,
      steps_total: flow.steps.length,
      screenshots: [],
    };
    if (json) console.log(JSON.stringify(result, null, 2));
    return result;
  }

  // Launch browser
  let context: BrowserContext;
  if (lightweight) {
    const wsUrl = cdpUrl ?? 'http://localhost:9222';
    const browser = await chromium.connectOverCDP(wsUrl);
    context = browser.contexts()[0] ?? await browser.newContext();
  } else {
    const browser = await chromium.launch({ headless: !headed });
    context = await browser.newContext();
  }

  // Inject saved cookies
  const savedCookies = loadCookies(name);
  if (savedCookies?.cookies) {
    await context.addCookies(savedCookies.cookies as unknown as Parameters<typeof context.addCookies>[0]);
  }

  // Enable tracing
  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();
  const screenshots: string[] = [];
  let stepsCompleted = 0;
  let stepError: StepError | undefined;

  const startTime = Date.now();

  try {
    for (const step of flow.steps) {
      logger.beginStep(step.index);

      if (delayBetween > 0) {
        await new Promise((r) => setTimeout(r, delayBetween));
      }

      // Domain allowlist check for navigate steps
      if (step.type === 'navigate' && step.url && flow.metadata.allowedDomains?.length) {
        assertDomainAllowed(step.url, flow.metadata.allowedDomains, name);
      }

      if (!json) {
        process.stdout.write(`  [${step.index}] ${step.type}...`);
      }

      try {
        await executeStep(page, context, step, params, flowDir);
        stepsCompleted++;

        logger.logStep({
          stepIndex: step.index,
          type: step.type,
          status: 'success',
          selector_used: step.selectors?.css,
          retries: 0,
        });

        if (!json) process.stdout.write(chalk.green(' ✓\n'));
      } catch (err) {
        const errMsg = (err as Error).message;
        const screenshot = await captureScreenshot(page, screenshotsDir, `fail_step_${step.index}`).catch(() => '');
        if (screenshot) screenshots.push(screenshot);

        logger.logStep({
          stepIndex: step.index,
          type: step.type,
          status: 'failure',
          retries: 0,
          error: errMsg,
          screenshot,
        });

        // Check for auth failure and retry
        if (await isAuthFailure(page)) {
          if (!json) console.log(chalk.yellow('\n  🔑 Auth failure detected — re-authenticating...'));
          try {
            const { runAuthFlow } = await import('../templates/auth-template.js');
            await runAuthFlow(name, flow.metadata.url);
            await executeStep(page, context, step, params, flowDir);
            stepsCompleted++;
            continue;
          } catch (authErr) {
            stepError = {
              step: step.index,
              type: step.type,
              message: (authErr as Error).message,
              screenshot,
              url: page.url(),
              retriesAttempted: 1,
            };
            break;
          }
        }

        stepError = {
          step: step.index,
          type: step.type,
          message: errMsg,
          screenshot,
          url: page.url(),
          retriesAttempted: 0,
        };

        if (!json) console.log(chalk.red(` ✗ — ${errMsg}`));
        break;
      }
    }

    // Final screenshot on success
    if (!stepError) {
      const finalShot = await captureScreenshot(page, screenshotsDir, 'final').catch(() => '');
      if (finalShot) screenshots.push(finalShot);
    }

    // Save cookies after successful run
    if (!stepError) {
      const cookies = await context.cookies();
      saveCookies(name, cookies as unknown as Record<string, unknown>[]);
    }
  } finally {
    // Save trace
    const tracePath = join(flowDir, 'trace.zip');
    await context.tracing.stop({ path: tracePath }).catch(() => {});
    await context.close();
  }

  const duration_ms = Date.now() - startTime;
  const success = !stepError;
  const log = logger.finish(success);

  // Save run log
  logger.save(logsDir);
  recordRunResult(flowDir, success);

  const result: RunResult = {
    success,
    confirmation: success
      ? `Flow "${name}" completed successfully (${stepsCompleted}/${flow.steps.length} steps)`
      : `Flow "${name}" failed at step ${stepError!.step}`,
    flow: name,
    duration_ms,
    steps_completed: stepsCompleted,
    steps_total: flow.steps.length,
    screenshots,
    error: stepError,
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (success) {
      console.log(chalk.green(`\n✅ ${result.confirmation}`));
      console.log(chalk.gray(`   Duration: ${duration_ms}ms`));
    } else {
      console.log(chalk.red(`\n❌ ${result.confirmation}`));
      if (stepError) {
        console.log(chalk.red(`   Error: ${stepError.message}`));
      }
    }
  }

  return result;
}

/** Execute a single step on the page */
async function executeStep(
  page: Page,
  context: BrowserContext,
  step: import('../lib/step-types.js').RecordedStep,
  params: Record<string, string>,
  flowDir: string
): Promise<void> {
  const { resilientLocator } = await import('../lib/retry.js');

  switch (step.type) {
    case 'navigate': {
      const url = injectParams(step.url ?? step.pageUrl, params);
      await page.goto(url, { waitUntil: 'networkidle' });
      break;
    }
    case 'click': {
      const loc = await resilientLocator(page, step.selectors);
      await loc.click();
      break;
    }
    case 'type': {
      const value = injectParams(step.value ?? '', params);
      const loc = await resilientLocator(page, step.selectors);
      await loc.fill(value);
      break;
    }
    case 'select': {
      const value = injectParams(step.value ?? '', params);
      const loc = await resilientLocator(page, step.selectors);
      await loc.selectOption(value);
      break;
    }
    case 'check': {
      const loc = await resilientLocator(page, step.selectors);
      await loc.check();
      break;
    }
    case 'keypress': {
      await page.keyboard.press(step.key ?? 'Enter');
      break;
    }
    case 'scroll': {
      const deltaY = parseInt(step.value ?? '300');
      await page.mouse.wheel(0, deltaY);
      break;
    }
    case 'frame-switch': {
      // frame-switch is handled inline — just note it
      break;
    }
    case 'tab-switch': {
      await context.waitForEvent('page');
      break;
    }
    case 'wait': {
      await page.waitForLoadState('networkidle');
      break;
    }
    case 'upload': {
      const filePath = injectParams(step.value ?? '', params);
      if (step.selectors.css) {
        await page.locator(step.selectors.css).setInputFiles(filePath);
      }
      break;
    }
    case 'script': {
      const scriptPath = step.scriptPath ?? step.value;
      if (!scriptPath) throw new Error(`Script step ${step.index} has no scriptPath or value`);
      const resolvedPath = isAbsolute(scriptPath) ? scriptPath : join(flowDir, scriptPath);
      const mod = await import(resolvedPath);
      if (typeof mod.default === 'function') {
        await mod.default(page, context, params);
      } else if (typeof mod.run === 'function') {
        await mod.run(page, context, params);
      } else {
        throw new Error(`Script at ${scriptPath} must export a default function or run()`);
      }
      break;
    }
    default:
      throw new Error(`Unsupported step type: "${(step.type as string)}" at step ${step.index}. Known types: navigate, click, type, select, check, keypress, scroll, frame-switch, tab-switch, wait, upload, script`);
  }
}
