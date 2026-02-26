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
  tabUrl?: string;
  fresh?: boolean;
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

/** Connect to CDP with retry and exponential backoff */
async function connectWithRetry(
  wsUrl: string,
  maxRetries = 3,
  baseBackoffMs = 2000,
  json = false
): Promise<import('playwright').Browser> {
  let lastError: Error = new Error('Connection failed');
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const browser = await chromium.connectOverCDP(wsUrl, { timeout: 10000 });
      browser.contexts(); // verify connection is alive
      return browser;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = baseBackoffMs * Math.pow(2, attempt);
        if (!json) {
          console.warn(chalk.yellow(
            `  ⚠️  CDP connection attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}. Retrying in ${delay}ms...`
          ));
        }
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(
    `Failed to connect to browser at ${wsUrl} after ${maxRetries + 1} attempts. ` +
    `Last error: ${lastError.message}. ` +
    `The browser may need to be restarted if it has been running for a long time.`
  );
}

/**
 * Execute a single flow run. Returns a structured RunResult.
 */
export async function execute(options: ExecuteOptions): Promise<RunResult> {
  const { name, params = {}, json = false, dryRun = false, lightweight = false,
    cdpUrl, headed = false, delayBetween = 0, tabUrl, fresh = false } = options;

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
  let targetPage: Page | undefined;
  if (lightweight) {
    const wsUrl = cdpUrl ?? 'http://localhost:9222';
    const browser = await connectWithRetry(wsUrl, 3, 2000, json);
    if (fresh) {
      context = await browser.newContext();
    } else if (tabUrl) {
      // Find the first page whose URL matches the given pattern
      let foundCtx: BrowserContext | undefined;
      for (const ctx of browser.contexts()) {
        for (const pg of ctx.pages()) {
          if (pg.url().includes(tabUrl)) {
            foundCtx = ctx;
            targetPage = pg;
            break;
          }
        }
        if (foundCtx) break;
      }
      context = foundCtx ?? browser.contexts()[0] ?? await browser.newContext();
    } else {
      context = browser.contexts()[0] ?? await browser.newContext();
    }
    // Warn about high tab count
    const allPages = context.pages();
    if (allPages.length > 10 && !json) {
      console.warn(chalk.yellow(`  ⚠️  Browser has ${allPages.length} open tabs. Consider closing unused tabs with: browser-auto tabs clean`));
    }
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

  const page = targetPage ?? await context.newPage();
  const screenshots: string[] = [];
  let stepsCompleted = 0;
  let stepError: StepError | undefined;
  let activeFrameSelector: string | null = null;

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
        activeFrameSelector = await executeStep(page, context, step, params, flowDir, activeFrameSelector);
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
            activeFrameSelector = await executeStep(page, context, step, params, flowDir, activeFrameSelector);
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

/** Resolve a locator with frame awareness */
async function resolveLocator(
  page: Page,
  selectors: import('../lib/step-types.js').SelectorSet,
  activeFrameSelector: string | null
) {
  if (activeFrameSelector) {
    const { prioritizedSelectors } = await import('../lib/selector-engine.js');
    const selectorList = prioritizedSelectors(selectors);
    const frame = page.frameLocator(activeFrameSelector);
    for (const sel of selectorList) {
      try {
        const loc = frame.locator(sel).first();
        if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) return loc;
      } catch { continue; }
    }
    // Fallback: try the first selector even if not visible yet
    if (selectorList.length > 0) return frame.locator(selectorList[0]).first();
    throw new Error(`No selector matched in frame "${activeFrameSelector}" for step`);
  }
  const { resilientLocator } = await import('../lib/retry.js');
  return resilientLocator(page, selectors);
}

/** Execute a single step on the page */
async function executeStep(
  page: Page,
  context: BrowserContext,
  step: import('../lib/step-types.js').RecordedStep,
  params: Record<string, string>,
  flowDir: string,
  activeFrameSelector: string | null
): Promise<string | null> {

  switch (step.type) {
    case 'navigate': {
      const url = injectParams(step.url ?? step.pageUrl, params);
      await page.goto(url, { waitUntil: 'networkidle' });
      return activeFrameSelector;
    }
    case 'click': {
      const loc = await resolveLocator(page, step.selectors, activeFrameSelector);
      await loc.click();
      return activeFrameSelector;
    }
    case 'type': {
      const value = injectParams(step.value ?? '', params);
      const loc = await resolveLocator(page, step.selectors, activeFrameSelector);
      await loc.fill(value);
      return activeFrameSelector;
    }
    case 'select': {
      const value = injectParams(step.value ?? '', params);
      const loc = await resolveLocator(page, step.selectors, activeFrameSelector);
      await loc.selectOption(value);
      return activeFrameSelector;
    }
    case 'check': {
      const loc = await resolveLocator(page, step.selectors, activeFrameSelector);
      await loc.check();
      return activeFrameSelector;
    }
    case 'keypress': {
      await page.keyboard.press(step.key ?? 'Enter');
      return activeFrameSelector;
    }
    case 'scroll': {
      const deltaY = parseInt(step.value ?? '300');
      await page.mouse.wheel(0, deltaY);
      return activeFrameSelector;
    }
    case 'frame-switch': {
      const frameSel = step.frameSelector ?? step.selectors?.css ?? null;
      return frameSel;
    }
    case 'tab-switch': {
      await context.waitForEvent('page');
      return activeFrameSelector;
    }
    case 'wait': {
      const { prioritizedSelectors } = await import('../lib/selector-engine.js');
      const selectorList = prioritizedSelectors(step.selectors);
      if (selectorList.length > 0 && selectorList[0] !== 'body') {
        if (activeFrameSelector) {
          const frame = page.frameLocator(activeFrameSelector);
          await frame.locator(selectorList[0]).waitFor({ state: 'visible', timeout: 15000 });
        } else {
          await page.waitForSelector(selectorList[0], { state: 'visible', timeout: 15000 });
        }
      } else if (step.url) {
        await page.waitForURL(step.url, { timeout: 15000 });
      } else {
        await page.waitForLoadState('networkidle');
      }
      return activeFrameSelector;
    }
    case 'upload': {
      const filePath = injectParams(step.value ?? '', params);
      const loc = await resolveLocator(page, step.selectors, activeFrameSelector);
      await loc.setInputFiles(filePath);
      return activeFrameSelector;
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
      return activeFrameSelector;
    }
    default:
      throw new Error(`Unsupported step type: "${(step.type as string)}" at step ${step.index}. Known types: navigate, click, type, select, check, keypress, scroll, frame-switch, tab-switch, wait, upload, script`);
  }
}
