/**
 * task-queue.ts — Persistent task queue for auto-queued flows
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { QueuedTask } from './step-types.js';

/** Path to the persistent queue file */
export function getQueueFile(): string {
  return (
    process.env['BROWSER_AUTO_QUEUE_FILE'] ??
    join(homedir(), '.openclaw', 'browser-auto', 'queue.json')
  );
}

/** Load all tasks from the queue file */
export function loadQueue(): QueuedTask[] {
  const file = getQueueFile();
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as QueuedTask[];
  } catch {
    return [];
  }
}

/** Persist all tasks to the queue file */
export function saveQueue(tasks: QueuedTask[]): void {
  const file = getQueueFile();
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(tasks, null, 2), 'utf8');
}

/** Add a new task to the queue. Returns the new task. */
export function addTask(
  flow: string,
  params: Record<string, string>,
  missingParams: string[]
): QueuedTask {
  const tasks = loadQueue();
  const task: QueuedTask = {
    id: randomUUID(),
    flow,
    params,
    missingParams,
    addedAt: new Date().toISOString(),
    status: missingParams.length === 0 ? 'ready' : 'pending',
  };
  tasks.push(task);
  saveQueue(tasks);
  return task;
}

/** Remove a task from the queue by ID */
export function dropTask(id: string): boolean {
  const tasks = loadQueue();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  saveQueue(tasks);
  return true;
}

/** Set a parameter value on a queued task */
export function setTaskParam(
  id: string,
  param: string,
  value: string
): QueuedTask | null {
  const tasks = loadQueue();
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;

  task.params[param] = value;
  task.missingParams = task.missingParams.filter((p) => p !== param);
  if (task.missingParams.length === 0) {
    task.status = 'ready';
  }

  saveQueue(tasks);
  return task;
}

/** Get all tasks with a specific status */
export function getTasksByStatus(
  status: QueuedTask['status']
): QueuedTask[] {
  return loadQueue().filter((t) => t.status === status);
}

/** Get all ready tasks */
export function getReadyTasks(): QueuedTask[] {
  return getTasksByStatus('ready');
}

/** Mark a task as running */
export function markTaskRunning(id: string): void {
  updateTaskStatus(id, 'running');
}

/** Mark a task as done */
export function markTaskDone(id: string): void {
  updateTaskStatus(id, 'done');
}

/** Mark a task as failed */
export function markTaskFailed(id: string): void {
  updateTaskStatus(id, 'failed');
}

function updateTaskStatus(id: string, status: QueuedTask['status']): void {
  const tasks = loadQueue();
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task.status = status;
    saveQueue(tasks);
  }
}
