/**
 * codegen.ts — Step-to-Playwright code generation (§7)
 */

import type { RecordedStep } from './step-types.js';
import { prioritizedSelectors, bestSelector } from './selector-engine.js';
import { extractPlaceholders } from './param-injector.js';

/** Parameter detection patterns */
const PARAM_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\b[A-Z]{2,}-\d{4,6}\b/, name: 'reportId' },
  { pattern: /\b\d{4}-\d{2}-\d{2}\b/, name: 'date' },
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/, name: 'email' },
];

/** Detect if a value should be parameterised and return the param placeholder */
export function detectParam(value: string, fieldHint?: string): string | null {
  for (const { pattern, name } of PARAM_PATTERNS) {
    if (pattern.test(value)) return `{{${name}}}`;
  }
  if (fieldHint) {
    const lower = fieldHint.toLowerCase();
    if (lower.includes('name')) return '{{name}}';
    if (lower.includes('phone')) return '{{phone}}';
    if (lower.includes('address')) return '{{address}}';
  }
  return null;
}

/** Generate the selector string for resilientLocator() call */
function selectorArg(step: RecordedStep): string {
  const selectors = prioritizedSelectors(step.selectors);
  if (selectors.length === 0) return JSON.stringify({ css: 'body' });

  const obj: Record<string, string> = {};
  if (step.selectors.testId) obj['testId'] = step.selectors.testId;
  if (step.selectors.aria) obj['aria'] = step.selectors.aria;
  if (step.selectors.css) obj['css'] = step.selectors.css;
  if (step.selectors.text) obj['text'] = step.selectors.text;
  if (step.selectors.xpath) obj['xpath'] = step.selectors.xpath;

  return JSON.stringify(obj, null, 2)
    .split('\n')
    .map((l, i) => (i === 0 ? l : '    ' + l))
    .join('\n');
}

/** Generate Playwright code for a single step */
export function generateStepCode(
  step: RecordedStep,
  prevStep?: RecordedStep
): string {
  const lines: string[] = [];

  if (step.waitBefore && step.waitBefore > 0) {
    lines.push(`  await page.waitForTimeout(${step.waitBefore});`);
  }

  const hasAmbiguousSelector =
    !step.selectors.testId && !step.selectors.aria && !step.selectors.text;

  switch (step.type) {
    case 'navigate': {
      const url = step.url ?? step.pageUrl;
      lines.push(`  await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle' });`);
      break;
    }

    case 'click': {
      if (hasAmbiguousSelector) {
        lines.push(`  // TODO: verify selector for click step ${step.index}`);
      }
      lines.push(`  await resilientLocator(page, ${selectorArg(step)}).click();`);

      // Intelligent wait: if next step navigates to a new URL
      if (prevStep && step.pageUrl !== prevStep.pageUrl) {
        lines.push(`  await page.waitForURL(${JSON.stringify(step.pageUrl)});`);
      }
      break;
    }

    case 'type': {
      const rawValue = step.value ?? '';
      const paramValue = detectParam(rawValue, step.selectors.aria ?? step.selectors.css);
      const value = paramValue ?? JSON.stringify(rawValue);

      if (hasAmbiguousSelector) {
        lines.push(`  // TODO: verify selector for type step ${step.index}`);
      }
      if (paramValue) {
        lines.push(`  // TODO: parameterized value detected: ${paramValue}`);
      }
      lines.push(`  await resilientLocator(page, ${selectorArg(step)}).fill(${value});`);
      break;
    }

    case 'select': {
      const value = JSON.stringify(step.value ?? '');
      lines.push(`  await resilientLocator(page, ${selectorArg(step)}).selectOption(${value});`);
      break;
    }

    case 'check': {
      lines.push(`  await resilientLocator(page, ${selectorArg(step)}).check();`);
      break;
    }

    case 'upload': {
      const sel = bestSelector(step.selectors);
      lines.push(`  await page.locator(${JSON.stringify(sel)}).setInputFiles(params.filePath ?? '');`);
      break;
    }

    case 'keypress': {
      const key = step.key ?? 'Enter';
      lines.push(`  await page.keyboard.press(${JSON.stringify(key)});`);
      break;
    }

    case 'scroll': {
      const deltaY = parseInt(step.value ?? '300');
      lines.push(`  await page.mouse.wheel(0, ${deltaY});`);
      break;
    }

    case 'frame-switch': {
      const frameSel = step.frameSelector ?? 'iframe';
      lines.push(`  const frame = page.frameLocator(${JSON.stringify(frameSel)});`);
      break;
    }

    case 'tab-switch': {
      lines.push(`  const newPage = await context.waitForEvent('page');`);
      lines.push(`  await newPage.waitForLoadState();`);
      break;
    }

    case 'wait': {
      const selector = bestSelector(step.selectors);
      if (selector !== 'body') {
        lines.push(`  await page.waitForSelector(${JSON.stringify(selector)}, { state: 'visible' });`);
      } else {
        lines.push(`  await page.waitForLoadState('networkidle');`);
      }
      break;
    }

    default: {
      lines.push(`  // TODO: unsupported step type: ${(step as RecordedStep).type}`);
    }
  }

  return lines.join('\n');
}

/** Detect parameters across all steps and build a schema */
export function detectParameters(
  steps: RecordedStep[]
): Record<string, { type: string; description: string; required: boolean }> {
  const params: Record<string, { type: string; description: string; required: boolean }> = {};

  for (const step of steps) {
    if (step.type === 'type' && step.value) {
      const param = detectParam(step.value, step.selectors.aria ?? step.selectors.css);
      if (param) {
        const name = param.slice(2, -2);
        params[name] = {
          type: name === 'date' ? 'date' : 'string',
          description: `Detected from step ${step.index}`,
          required: true,
        };
      }
    }
  }

  return params;
}

/** Generate the full Playwright script for a flow */
export function generateScript(
  flowName: string,
  steps: RecordedStep[],
  params: Record<string, { type: string; description: string; required: boolean }>
): string {
  const paramInterface = Object.entries(params)
    .map(([k, v]) => `  ${k}${v.required ? '' : '?'}: ${v.type === 'date' ? 'string' : v.type};`)
    .join('\n');

  const stepCodes = steps
    .map((step, i) => {
      const annotation = step.annotation ? `  // ${step.annotation}` : '';
      const code = generateStepCode(step, steps[i - 1]);
      return [annotation, `  // Step ${step.index}: ${step.type}`, code]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  return `/**
 * Generated Playwright script for flow: ${flowName}
 * Generated at: ${new Date().toISOString()}
 * DO NOT EDIT manually — re-run "browser-auto generate ${flowName}" to regenerate.
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { resilientLocator } from '../lib/retry.js';

export interface Params {
${paramInterface || '  [key: string]: string;'}
}

export async function run(params: Params = {} as Params): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context: BrowserContext = await browser.newContext();
  const page: Page = await context.newPage();

  try {
${stepCodes}

    console.log('✅ Flow "${flowName}" completed successfully.');
  } finally {
    await context.close();
    await browser.close();
  }
}

// Run directly when executed as a script
run().catch((err: Error) => {
  console.error('❌ Flow failed:', err.message);
  process.exit(1);
});
`;
}
