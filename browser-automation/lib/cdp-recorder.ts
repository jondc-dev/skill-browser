/**
 * cdp-recorder.ts — Chrome DevTools Protocol event capture (§5.2)
 */

import type { BrowserContext, CDPSession, Page } from 'playwright';
import type { RecordedStep, SelectorSet } from './step-types.js';
import { captureScreenshot } from './screenshot.js';

/** Auth-related URL patterns */
const AUTH_URL_PATTERNS = ['/login', '/auth', '/signin', '/sign-in', '/session'];

/** Check if a URL is an auth-related URL */
function isAuthUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return AUTH_URL_PATTERNS.some((p) => lower.includes(p));
}

/** Check if a node description indicates an auth field */
function isAuthField(description: string): boolean {
  const lower = description.toLowerCase();
  return lower.includes('password') || lower.includes('username') || lower.includes('email');
}

/** Build a SelectorSet from CDP node info */
function buildSelectorsFromNode(
  node: {
    nodeId?: number;
    attributes?: string[];
    localName?: string;
    nodeValue?: string;
  }
): SelectorSet {
  const attrs: Record<string, string> = {};
  const attrList = node.attributes ?? [];
  for (let i = 0; i < attrList.length - 1; i += 2) {
    attrs[attrList[i]] = attrList[i + 1];
  }

  const selectors: SelectorSet = {};
  const testIdAttrs = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
  for (const attr of testIdAttrs) {
    if (attrs[attr]) {
      selectors.testId = `[${attr}="${attrs[attr]}"]`;
      break;
    }
  }

  if (attrs['aria-label']) {
    selectors.aria = `[aria-label="${attrs['aria-label']}"]`;
  }

  if (attrs['id'] && !/^\d/.test(attrs['id'])) {
    selectors.css = `#${CSS.escape ? CSS.escape(attrs['id']) : attrs['id']}`;
  } else if (node.localName) {
    const classes = (attrs['class'] ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
    selectors.css = classes.length > 0
      ? `${node.localName}.${classes.join('.')}`
      : node.localName;
  }

  return selectors;
}

/** Recorder that captures CDP events and converts them to RecordedStep[] */
export class CdpRecorder {
  private steps: RecordedStep[] = [];
  private stepIndex = 0;
  private screenshotsDir: string;
  private stopped = false;

  constructor(screenshotsDir: string) {
    this.screenshotsDir = screenshotsDir;
  }

  /** Attach CDP listeners to a page */
  async attach(page: Page, context: BrowserContext): Promise<void> {
    const cdp: CDPSession = await context.newCDPSession(page);

    await cdp.send('DOM.enable');
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // Track navigation
    page.on('framenavigated', async (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      this.addStep({
        type: 'navigate',
        selectors: {},
        url,
        pageUrl: url,
        isAuthStep: isAuthUrl(url),
      });
    });

    // Inject client-side recording script
    await page.addInitScript(() => {
      // Store event queue on window for CDP consumption
      (window as unknown as Record<string, unknown>)['__baEvents'] = [];

      const push = (evt: unknown) => {
        ((window as unknown as Record<string, unknown[]>)['__baEvents']).push(evt);
      };

      document.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        push({ kind: 'click', tag: t.tagName, id: t.id, className: t.className, text: t.textContent?.trim()?.slice(0, 80) });
      }, true);

      document.addEventListener('change', (e) => {
        const t = e.target as HTMLInputElement;
        push({ kind: 'change', tag: t.tagName, id: t.id, className: t.className, value: t.value, type: t.type });
      }, true);

      document.addEventListener('keydown', (e) => {
        if (['Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          push({ kind: 'keypress', key: e.key });
        }
      }, true);

      document.addEventListener('scroll', () => {
        push({ kind: 'scroll', deltaY: window.scrollY });
      }, { passive: true });
    });

    // Poll for injected events
    const poll = setInterval(async () => {
      if (this.stopped) {
        clearInterval(poll);
        return;
      }

      try {
        const result = await page.evaluate(() => {
          const events = (window as unknown as Record<string, unknown[]>)['__baEvents'] ?? [];
          (window as unknown as Record<string, unknown[]>)['__baEvents'] = [];
          return events;
        });

        for (const evt of result as Array<Record<string, unknown>>) {
          await this.processEvent(evt, page);
        }
      } catch {
        // page may have navigated
      }
    }, 300);
  }

  private async processEvent(evt: Record<string, unknown>, page: Page): Promise<void> {
    const pageUrl = page.url();
    const selectors: SelectorSet = {};

    if (evt['id']) selectors.css = `#${evt['id']}`;
    if (evt['text']) selectors.text = evt['text'] as string;

    const isAuth = isAuthUrl(pageUrl) || isAuthField(String(evt['id'] ?? ''));

    switch (evt['kind']) {
      case 'click': {
        const screenshot = await captureScreenshot(page, this.screenshotsDir, `step_${this.stepIndex}_click`).catch(() => undefined);
        this.addStep({ type: 'click', selectors, pageUrl, isAuthStep: isAuth, screenshot });
        break;
      }

      case 'change': {
        const inputType = String(evt['type'] ?? 'text');
        if (inputType === 'checkbox') {
          this.addStep({ type: 'check', selectors, pageUrl, isAuthStep: isAuth });
        } else if (inputType === 'select-one' || (evt['tag'] as string)?.toLowerCase() === 'select') {
          this.addStep({ type: 'select', selectors, value: String(evt['value'] ?? ''), pageUrl, isAuthStep: isAuth });
        } else {
          this.addStep({ type: 'type', selectors, value: String(evt['value'] ?? ''), pageUrl, isAuthStep: isAuth });
        }
        break;
      }

      case 'keypress': {
        this.addStep({ type: 'keypress', selectors: {}, key: String(evt['key'] ?? 'Enter'), pageUrl });
        break;
      }

      case 'scroll': {
        this.addStep({ type: 'scroll', selectors: {}, value: String(evt['deltaY'] ?? 0), pageUrl });
        break;
      }
    }
  }

  private addStep(partial: Omit<RecordedStep, 'index' | 'timestamp'>): void {
    const step: RecordedStep = {
      index: this.stepIndex++,
      timestamp: Date.now(),
      ...partial,
    };
    this.steps.push(step);
    process.stdout.write(`  [${step.index}] ${step.type}${step.isAuthStep ? ' (auth)' : ''}\n`);
  }

  /** Stop recording and return captured steps */
  stop(): RecordedStep[] {
    this.stopped = true;
    return this.steps;
  }

  /** Return auth steps only */
  getAuthSteps(): RecordedStep[] {
    return this.steps.filter((s) => s.isAuthStep);
  }
}
