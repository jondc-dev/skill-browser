/**
 * run-logger.ts — Structured step-level run logs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { RunLog, StepLogEntry, StepType } from './step-types.js';

/** Mutable run log builder */
export class RunLogger {
  private log: RunLog;
  private stepStart: number = Date.now();

  constructor(flow: string, params?: Record<string, unknown>) {
    this.log = {
      runId: randomUUID(),
      flow,
      startedAt: new Date().toISOString(),
      completedAt: '',
      success: false,
      duration_ms: 0,
      steps: [],
      params,
    };
  }

  get runId(): string {
    return this.log.runId;
  }

  /** Mark the start of a step */
  beginStep(stepIndex: number): void {
    void stepIndex; // stepIndex is not used here; timing is captured from Date.now()
    this.stepStart = Date.now();
  }

  /** Record a completed step */
  logStep(entry: Omit<StepLogEntry, 'duration_ms'>): void {
    this.log.steps.push({
      ...entry,
      duration_ms: Date.now() - this.stepStart,
    });
  }

  /** Finalise the run log */
  finish(success: boolean): RunLog {
    this.log.completedAt = new Date().toISOString();
    this.log.success = success;
    this.log.duration_ms =
      new Date(this.log.completedAt).getTime() -
      new Date(this.log.startedAt).getTime();
    return this.log;
  }

  /** Save the run log to a directory */
  save(logsDir: string): string {
    mkdirSync(logsDir, { recursive: true });
    const fileName = `run-${this.log.runId}.json`;
    const filePath = join(logsDir, fileName);
    writeFileSync(filePath, JSON.stringify(this.log, null, 2), 'utf8');
    return filePath;
  }

  /** Get the current log (read-only snapshot) */
  getLog(): RunLog {
    return this.log;
  }
}
