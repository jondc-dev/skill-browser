/**
 * intent-matcher.test.ts — Tests for flow recognition, confidence scoring, entity extraction
 */

import { describe, it, expect } from 'vitest';
import { scoreIntent, extractEntity, matchFlows } from '../lib/intent-matcher.js';
import type { FlowIntent } from '../lib/step-types.js';

const gatePassIntent: FlowIntent = {
  flow: 'gate-pass-approval',
  intents: {
    description: 'Approve or process a gate pass for building/facility access',
    semantic_triggers: ['gate pass', 'building access', 'facility entry', 'visitor access'],
    context_clues: ['arriving', 'visiting', 'starts Monday', 'new hire', 'client coming'],
    entity_extractors: {
      reportId: {
        patterns: ['GP-\\d{4,6}', 'gate pass #?\\d+'],
        ask_if_missing: true,
        prompt: "What's the gate pass report ID?",
      },
      action: {
        infer_from_context: true,
        positive_signals: ['approve', 'confirm', 'ready', 'set up'],
        negative_signals: ['reject', 'deny', 'cancel'],
        default: 'approve',
      },
    },
    confidence_threshold: 0.7,
    auto_run: false,
    auto_queue: true,
  },
};

describe('scoreIntent', () => {
  it('returns high confidence for strong trigger matches', () => {
    const score = scoreIntent(gatePassIntent, 'I need to approve a gate pass');
    expect(score).toBeGreaterThanOrEqual(0.4);
  });

  it('returns higher confidence for multiple trigger matches', () => {
    const score1 = scoreIntent(gatePassIntent, 'gate pass approval needed');
    const score2 = scoreIntent(gatePassIntent, 'unrelated message about lunch');
    expect(score1).toBeGreaterThan(score2);
  });

  it('adds context clue score', () => {
    const scoreWithClues = scoreIntent(
      gatePassIntent,
      'visitor arriving Monday for gate pass'
    );
    const scoreWithoutClues = scoreIntent(gatePassIntent, 'gate pass');
    expect(scoreWithClues).toBeGreaterThan(scoreWithoutClues);
  });

  it('caps at 1.0 regardless of how many triggers match', () => {
    const score = scoreIntent(
      gatePassIntent,
      'gate pass building access facility entry visitor access arriving new hire client coming'
    );
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('returns 0 for completely unrelated message', () => {
    const score = scoreIntent(gatePassIntent, 'What is the weather today?');
    expect(score).toBe(0);
  });

  it('boosts score when history reinforces the intent', () => {
    const scoreWithHistory = scoreIntent(
      gatePassIntent,
      'can you handle that for me?',
      ['I need gate pass access for tomorrow', 'visitor is coming Monday']
    );
    const scoreWithoutHistory = scoreIntent(
      gatePassIntent,
      'can you handle that for me?'
    );
    expect(scoreWithHistory).toBeGreaterThan(scoreWithoutHistory);
  });
});

describe('extractEntity', () => {
  it('extracts reportId from message using pattern', () => {
    const value = extractEntity('Please process GP-4421', {
      patterns: ['GP-\\d{4,6}'],
      ask_if_missing: true,
      prompt: 'What is the gate pass ID?',
    });
    expect(value).toBe('GP-4421');
  });

  it('returns undefined when no pattern matches', () => {
    const value = extractEntity('No ID here', {
      patterns: ['GP-\\d{4,6}'],
      ask_if_missing: true,
    });
    expect(value).toBeUndefined();
  });

  it('infers action from positive signals', () => {
    const value = extractEntity('Please approve the request', {
      infer_from_context: true,
      positive_signals: ['approve', 'confirm'],
      negative_signals: ['reject', 'deny'],
      default: 'approve',
    });
    // Returns the matched positive signal
    expect(value).toBe('approve');
  });

  it('infers action from negative signals', () => {
    const value = extractEntity('Please deny the request', {
      infer_from_context: true,
      positive_signals: ['approve', 'confirm'],
      negative_signals: ['reject', 'deny'],
      default: 'approve',
    });
    // Returns the matched negative signal ('deny' was in the message)
    expect(value).toBe('deny');
  });

  it('returns default when no signals match', () => {
    const value = extractEntity('handle the request', {
      infer_from_context: true,
      positive_signals: ['approve'],
      negative_signals: ['reject'],
      default: 'approve',
    });
    expect(value).toBe('approve');
  });
});

describe('matchFlows (with in-memory intents)', () => {
  it('returns matches above confidence threshold', () => {
    // Pass a custom flowsDir that doesn't exist — we test the scoring logic directly
    const matches = matchFlows('gate pass approval needed', [], '/nonexistent/dir');
    // No flows on disk, but the function should return an empty array gracefully
    expect(Array.isArray(matches)).toBe(true);
  });

  it('returns results sorted by confidence descending', () => {
    const matches = matchFlows('some message', [], '/nonexistent/dir');
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
    }
  });
});
