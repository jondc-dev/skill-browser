/**
 * step-types.ts — TypeScript type definitions for Browser Automation Skill
 */

/** All possible types of recorded browser interactions */
export type StepType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'select'
  | 'check'
  | 'upload'
  | 'wait'
  | 'keypress'
  | 'scroll'
  | 'frame-switch'
  | 'tab-switch';

/** Multiple selector strategies per element, in priority order */
export interface SelectorSet {
  testId?: string;
  aria?: string;
  css?: string;
  text?: string;
  xpath?: string;
  nthMatch?: number;
}

/** A single recorded browser interaction step */
export interface RecordedStep {
  index: number;
  timestamp: number;
  type: StepType;
  selectors: SelectorSet;
  value?: string;
  key?: string;
  url?: string;
  frameSelector?: string;
  pageUrl: string;
  screenshot?: string;
  waitBefore?: number;
  isAuthStep?: boolean;
  mfaType?: 'prompt' | 'totp';
  annotation?: string;
}

/** Metadata stored alongside a flow's steps */
export interface FlowMetadata {
  name: string;
  recordedAt: string;
  stepsCount: number;
  version: number;
  url: string;
  allowedDomains?: string[];
  hasAuthFlow?: boolean;
  description?: string;
}

/** Full flow document stored as flow.json */
export interface FlowDocument {
  metadata: FlowMetadata;
  steps: RecordedStep[];
  authSteps?: RecordedStep[];
}

/** Result of running a flow */
export interface RunResult {
  success: boolean;
  confirmation: string;
  flow: string;
  duration_ms: number;
  steps_completed: number;
  steps_total: number;
  screenshots: string[];
  error?: StepError;
}

/** Details of a step that failed */
export interface StepError {
  step: number;
  type: string;
  message: string;
  screenshot: string;
  url: string;
  retriesAttempted: number;
}

/** Natural-language intent configuration per flow */
export interface FlowIntent {
  flow: string;
  intents: {
    description: string;
    semantic_triggers: string[];
    context_clues: string[];
    entity_extractors: Record<string, EntityExtractor>;
    confidence_threshold: number;
    auto_run: boolean;
    auto_queue: boolean;
  };
}

/** Entity extraction configuration for a parameter */
export interface EntityExtractor {
  patterns?: string[];
  ask_if_missing?: boolean;
  prompt?: string;
  infer_from_context?: boolean;
  positive_signals?: string[];
  negative_signals?: string[];
  default?: string;
}

/** Matched flow with confidence score and extracted params */
export interface FlowMatch {
  flow: string;
  confidence: number;
  extractedParams: Record<string, string>;
  missingParams: string[];
  suggestedAction: 'run' | 'queue' | 'suggest';
}

/** Configuration for per-step retry behavior */
export interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

/** Result of pre-flight checks before flow execution */
export interface PreflightResult {
  portal_reachable: boolean;
  auth_fresh: boolean;
  params_valid: boolean;
  resources_ok: boolean;
  warnings: string[];
}

/** Single step log entry within a run log */
export interface StepLogEntry {
  stepIndex: number;
  type: StepType;
  status: 'success' | 'failure' | 'skipped';
  duration_ms: number;
  selector_used?: string;
  selectors_tried?: string[];
  retries: number;
  retry_reason?: string;
  screenshot?: string;
  error?: string;
}

/** Full structured run log saved after each execution */
export interface RunLog {
  runId: string;
  flow: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  duration_ms: number;
  steps: StepLogEntry[];
  params?: Record<string, unknown>;
}

/** Cached selector entry for a specific step */
export interface SelectorCacheEntry {
  stepIndex: number;
  winningSelector: string;
  strategy: 'testId' | 'aria' | 'css' | 'text' | 'xpath';
  successCount: number;
  lastUsed: string;
}

/** Queued task waiting for execution */
export interface QueuedTask {
  id: string;
  flow: string;
  params: Record<string, string>;
  missingParams: string[];
  addedAt: string;
  status: 'pending' | 'ready' | 'running' | 'done' | 'failed';
}

/** Flow version entry for history/rollback */
export interface FlowVersion {
  version: number;
  savedAt: string;
  scriptFile: string;
  domHashes?: Record<number, string>;
  successRate?: number;
  runCount?: number;
}
