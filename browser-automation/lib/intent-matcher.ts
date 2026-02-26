/**
 * intent-matcher.ts — Contextual flow recognition from natural language
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { FlowIntent, FlowMatch, EntityExtractor } from './step-types.js';

/** Get the flows base directory */
function getFlowsDir(): string {
  return (
    process.env['BROWSER_AUTO_FLOWS_DIR'] ??
    join(process.env['HOME'] ?? '~', '.openclaw', 'browser-auto', 'flows')
  );
}

/** Load all flow-intent.json files from the flows directory */
export function loadAllIntents(flowsDir?: string): FlowIntent[] {
  const dir = flowsDir ?? getFlowsDir();
  if (!existsSync(dir)) return [];

  const intents: FlowIntent[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const intentFile = join(dir, entry.name, 'flow-intent.json');
    if (!existsSync(intentFile)) continue;
    try {
      const intent = JSON.parse(readFileSync(intentFile, 'utf8')) as FlowIntent;
      intents.push(intent);
    } catch {
      // skip malformed intent files
    }
  }
  return intents;
}

/** Normalise text: lowercase, collapse whitespace */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Count how many phrases from a list appear in the target string */
function countMatches(phrases: string[], target: string): number {
  const lower = normalise(target);
  return phrases.filter((p) => lower.includes(normalise(p))).length;
}

/**
 * Extract parameter values from a message using an EntityExtractor definition.
 * Returns the extracted value or undefined.
 */
export function extractEntity(
  message: string,
  extractor: EntityExtractor
): string | undefined {
  // Try regex patterns
  if (extractor.patterns) {
    for (const pattern of extractor.patterns) {
      const match = message.match(new RegExp(pattern, 'i'));
      if (match) return match[0];
    }
  }

  // Infer from sentiment signals
  if (extractor.infer_from_context) {
    const lower = normalise(message);

    // Find which negative signal matched (if any)
    const matchedNegative = extractor.negative_signals?.find((s) =>
      lower.includes(normalise(s))
    );
    if (matchedNegative) return matchedNegative;

    // Find which positive signal matched (if any)
    const matchedPositive = extractor.positive_signals?.find((s) =>
      lower.includes(normalise(s))
    );
    if (matchedPositive) return matchedPositive;

    return extractor.default;
  }

  return undefined;
}

/**
 * Score a single FlowIntent against a message + conversation history.
 * Returns confidence in [0, 1].
 */
export function scoreIntent(
  intent: FlowIntent,
  message: string,
  history: string[] = []
): number {
  let score = 0;
  const { intents } = intent;

  // Semantic triggers: 0.4 per match, capped at 0.8
  const triggerCount = countMatches(intents.semantic_triggers, message);
  score += Math.min(triggerCount * 0.4, 0.8);

  // Context clues: 0.15 per match, capped at 0.45
  const clueCount = countMatches(intents.context_clues, message);
  score += Math.min(clueCount * 0.15, 0.45);

  // Conversation history reinforcement: check last 5 messages
  const recentHistory = history.slice(-5);
  const historyText = recentHistory.join(' ');
  const historyTriggers = countMatches(intents.semantic_triggers, historyText);
  const historyClues = countMatches(intents.context_clues, historyText);
  if (historyTriggers > 0 || historyClues > 0) {
    score += 0.15;
  }

  return Math.min(score, 1);
}

/**
 * Match natural language message + conversation history against all stored flows.
 * Returns sorted FlowMatch[] (highest confidence first) above the threshold.
 */
export function matchFlows(
  message: string,
  conversationHistory: string[] = [],
  flowsDir?: string
): FlowMatch[] {
  const intents = loadAllIntents(flowsDir);
  const matches: FlowMatch[] = [];

  for (const intent of intents) {
    const confidence = scoreIntent(intent, message, conversationHistory);
    const threshold = intent.intents.confidence_threshold ?? 0.7;

    if (confidence < threshold) continue;

    // Extract parameters
    const extractedParams: Record<string, string> = {};
    const missingParams: string[] = [];

    for (const [param, extractor] of Object.entries(intent.intents.entity_extractors)) {
      const value = extractEntity(message, extractor);
      if (value !== undefined) {
        extractedParams[param] = value;
      } else if (extractor.ask_if_missing) {
        missingParams.push(param);
      }
    }

    // Determine suggested action
    const allParamsPresent = missingParams.length === 0;
    let suggestedAction: FlowMatch['suggestedAction'];

    if (confidence > 0.85 && allParamsPresent) {
      suggestedAction = intent.intents.auto_run ? 'run' : 'queue';
    } else if (confidence >= threshold) {
      suggestedAction = 'suggest';
    } else {
      continue;
    }

    matches.push({
      flow: intent.flow,
      confidence,
      extractedParams,
      missingParams,
      suggestedAction,
    });
  }

  // Sort by confidence descending
  return matches.sort((a, b) => b.confidence - a.confidence);
}
