/**
 * generate.ts — Flow→Script generator (§5.3)
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { generateScript, detectParameters } from '../lib/codegen.js';
import { archiveCurrentScript } from '../lib/flow-versioning.js';
import { loadFlow, getFlowDir } from './list.js';

export interface GenerateOptions {
  name: string;
}

/** Generate a Playwright script from a recorded flow */
export async function generate(options: GenerateOptions): Promise<void> {
  const { name } = options;
  const flowDir = getFlowDir(name);

  const flow = loadFlow(name);
  if (!flow) {
    console.error(chalk.red(`❌ Flow "${name}" not found. Record it first.`));
    process.exit(1);
  }

  const { steps } = flow;

  // Archive current script if it exists
  archiveCurrentScript(flowDir);

  // Detect parameters
  const params = detectParameters(steps);

  // Generate script
  const scriptCode = generateScript(name, steps, params);

  // Write script.ts
  const scriptPath = join(flowDir, 'script.ts');
  writeFileSync(scriptPath, scriptCode, 'utf8');

  // Write params.schema.json
  const schemaPath = join(flowDir, 'params.schema.json');
  if (Object.keys(params).length > 0) {
    const schema = Object.fromEntries(
      Object.entries(params).map(([k, v]) => [
        k,
        { type: v.type, description: v.description, required: v.required },
      ])
    );
    writeFileSync(schemaPath, JSON.stringify(schema, null, 2), 'utf8');
    console.log(chalk.green(`✅ Params schema: ${schemaPath}`));
  }

  // Create default flow-intent.json if it doesn't exist
  const intentPath = join(flowDir, 'flow-intent.json');
  if (!existsSync(intentPath)) {
    const defaultIntent = {
      flow: name,
      intents: {
        description: `Automated flow: ${name}`,
        semantic_triggers: [name.replace(/-/g, ' ')],
        context_clues: [],
        entity_extractors: Object.fromEntries(
          Object.keys(params).map((k) => [
            k,
            { ask_if_missing: true, prompt: `What is the ${k}?` },
          ])
        ),
        confidence_threshold: 0.7,
        auto_run: false,
        auto_queue: true,
      },
    };
    writeFileSync(intentPath, JSON.stringify(defaultIntent, null, 2), 'utf8');
  }

  console.log(chalk.green(`\n✅ Script generated for flow: ${name}`));
  console.log(chalk.gray(`   Script: ${scriptPath}`));
  console.log(chalk.gray(`   Steps: ${steps.length}`));
  if (Object.keys(params).length > 0) {
    console.log(chalk.cyan(`\n   Detected parameters:`));
    for (const [k, v] of Object.entries(params)) {
      console.log(chalk.cyan(`     {{${k}}} — ${v.description}`));
    }
  }
  console.log(chalk.cyan(`\n   Run: browser-auto run ${name}`));
}
