/**
 * task-queue.test.ts — Tests for task queue add/remove/list/run-all
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';

// Use a temp file for the queue during tests
const TEST_QUEUE_FILE = join(tmpdir(), `ba-test-queue-${Date.now()}.json`);
process.env['BROWSER_AUTO_QUEUE_FILE'] = TEST_QUEUE_FILE;

import {
  loadQueue,
  addTask,
  dropTask,
  setTaskParam,
  getReadyTasks,
  markTaskDone,
  markTaskFailed,
} from '../lib/task-queue.js';

beforeEach(() => {
  if (existsSync(TEST_QUEUE_FILE)) rmSync(TEST_QUEUE_FILE);
});

afterEach(() => {
  if (existsSync(TEST_QUEUE_FILE)) rmSync(TEST_QUEUE_FILE);
});

describe('loadQueue', () => {
  it('returns empty array when no queue file exists', () => {
    expect(loadQueue()).toEqual([]);
  });
});

describe('addTask', () => {
  it('adds a task and persists it', () => {
    const task = addTask('my-flow', { email: 'test@example.com' }, []);
    const queue = loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(task.id);
    expect(queue[0].flow).toBe('my-flow');
    expect(queue[0].status).toBe('ready');
  });

  it('marks task as pending when missingParams is non-empty', () => {
    const task = addTask('my-flow', {}, ['email', 'name']);
    expect(task.status).toBe('pending');
    expect(task.missingParams).toEqual(['email', 'name']);
  });

  it('marks task as ready when no missing params', () => {
    const task = addTask('my-flow', { email: 'x@x.com' }, []);
    expect(task.status).toBe('ready');
  });

  it('assigns a unique ID to each task', () => {
    const t1 = addTask('flow-a', {}, []);
    const t2 = addTask('flow-b', {}, []);
    expect(t1.id).not.toBe(t2.id);
  });
});

describe('dropTask', () => {
  it('removes a task by ID', () => {
    const task = addTask('my-flow', {}, []);
    const removed = dropTask(task.id);
    expect(removed).toBe(true);
    expect(loadQueue()).toHaveLength(0);
  });

  it('returns false for unknown ID', () => {
    expect(dropTask('nonexistent-id')).toBe(false);
  });
});

describe('setTaskParam', () => {
  it('fills a missing param and transitions to ready', () => {
    const task = addTask('my-flow', {}, ['email']);
    const updated = setTaskParam(task.id, 'email', 'user@example.com');
    expect(updated).not.toBeNull();
    expect(updated!.params['email']).toBe('user@example.com');
    expect(updated!.missingParams).toHaveLength(0);
    expect(updated!.status).toBe('ready');
  });

  it('keeps task pending if more params are missing', () => {
    const task = addTask('my-flow', {}, ['email', 'name']);
    const updated = setTaskParam(task.id, 'email', 'user@example.com');
    expect(updated!.status).toBe('pending');
    expect(updated!.missingParams).toEqual(['name']);
  });

  it('returns null for unknown task ID', () => {
    const result = setTaskParam('unknown', 'email', 'x@x.com');
    expect(result).toBeNull();
  });
});

describe('getReadyTasks', () => {
  it('returns only ready tasks', () => {
    addTask('pending-flow', {}, ['param']);
    addTask('ready-flow', { p: 'v' }, []);
    const ready = getReadyTasks();
    expect(ready.every((t) => t.status === 'ready')).toBe(true);
    expect(ready.some((t) => t.flow === 'ready-flow')).toBe(true);
  });
});

describe('markTaskDone / markTaskFailed', () => {
  it('updates task status to done', () => {
    const task = addTask('flow', {}, []);
    markTaskDone(task.id);
    const queue = loadQueue();
    expect(queue.find((t) => t.id === task.id)!.status).toBe('done');
  });

  it('updates task status to failed', () => {
    const task = addTask('flow', {}, []);
    markTaskFailed(task.id);
    const queue = loadQueue();
    expect(queue.find((t) => t.id === task.id)!.status).toBe('failed');
  });
});
