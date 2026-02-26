#!/usr/bin/env node
/**
 * cli.ts — Commander.js CLI for Browser Automation Skill
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync, rmSync } from 'fs';

// Helpers to get package version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return '1.0.0';
  }
}

const program = new Command();

program
  .name('browser-auto')
  .description('Browser Automation Skill — record, replay and manage browser workflows')
  .version(getVersion());

// ─── record ───────────────────────────────────────────────────────────────────
program
  .command('record <name>')
  .description('Record a browser flow interactively')
  .requiredOption('-u, --url <url>', 'Starting URL for the recording')
  .action(async (name: string, opts: { url: string }) => {
    const { record } = await import('./record.js');
    await record({ name, url: opts.url });
  });

// ─── generate ─────────────────────────────────────────────────────────────────
program
  .command('generate <name>')
  .description('Generate a Playwright script from a recorded flow')
  .action(async (name: string) => {
    const { generate } = await import('./generate.js');
    await generate({ name });
  });

// ─── run ──────────────────────────────────────────────────────────────────────
program
  .command('run <name>')
  .description('Execute a recorded flow')
  .option('-p, --params <json>', 'JSON parameters object', '{}')
  .option('--json', 'Output results as JSON')
  .option('--batch <file>', 'Run with params from each line of a JSON-lines file')
  .option('--parallel <n>', 'Number of parallel runs in batch mode', '1')
  .option('--dry-run', 'Validate without running')
  .option('--lightweight', 'Attach to existing browser via CDP instead of launching new')
  .option('--cdp-url <url>', 'CDP endpoint URL (default: http://localhost:9222)')
  .option('--headed', 'Run with visible browser window')
  .option('--delay-between <ms>', 'Delay in ms between steps', '0')
  .action(async (name: string, opts: {
    params: string;
    json?: boolean;
    batch?: string;
    parallel: string;
    dryRun?: boolean;
    lightweight?: boolean;
    cdpUrl?: string;
    headed?: boolean;
    delayBetween: string;
  }) => {
    const { execute } = await import('./execute.js');
    let params: Record<string, string> = {};
    try {
      params = JSON.parse(opts.params) as Record<string, string>;
    } catch {
      console.error(chalk.red('❌ Invalid --params JSON'));
      process.exit(1);
    }

    if (opts.batch) {
      // Batch mode: run for each line in file
      const { readFileSync } = await import('fs');
      const lines = readFileSync(opts.batch, 'utf8')
        .split('\n')
        .filter((l) => l.trim());
      const parallel = parseInt(opts.parallel);
      
      // Process in chunks of `parallel`
      for (let i = 0; i < lines.length; i += parallel) {
        const chunk = lines.slice(i, i + parallel);
        await Promise.all(
          chunk.map((line) => {
            const batchParams = JSON.parse(line) as Record<string, string>;
            return execute({ name, params: batchParams, json: opts.json, dryRun: opts.dryRun });
          })
        );
      }
    } else {
      await execute({
        name,
        params,
        json: opts.json,
        dryRun: opts.dryRun,
        lightweight: opts.lightweight,
        cdpUrl: opts.cdpUrl,
        headed: opts.headed,
        delayBetween: parseInt(opts.delayBetween),
      });
    }
  });

// ─── list ─────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all stored flows')
  .action(async () => {
    const { printFlowList } = await import('./list.js');
    printFlowList();
  });

// ─── show ─────────────────────────────────────────────────────────────────────
program
  .command('show <name>')
  .description('Show details about a specific flow')
  .action(async (name: string) => {
    const { loadFlow, getFlowDir } = await import('./list.js');
    const flow = loadFlow(name);
    if (!flow) {
      console.error(chalk.red(`❌ Flow "${name}" not found.`));
      process.exit(1);
    }
    const flowDir = getFlowDir(name);
    const hasScript = existsSync(join(flowDir, 'script.ts'));
    const hasAuth = existsSync(join(flowDir, 'auth-flow.json'));

    console.log(chalk.bold(`\nFlow: ${name}`));
    console.log(chalk.gray(`  Recorded: ${new Date(flow.metadata.recordedAt).toLocaleString()}`));
    console.log(chalk.gray(`  Steps: ${flow.metadata.stepsCount}`));
    console.log(chalk.gray(`  Version: ${flow.metadata.version}`));
    console.log(chalk.gray(`  URL: ${flow.metadata.url}`));
    console.log(chalk.gray(`  Script: ${hasScript ? '✓' : '✗'}`));
    console.log(chalk.gray(`  Auth flow: ${hasAuth ? '✓' : '✗'}`));
    if (flow.metadata.allowedDomains?.length) {
      console.log(chalk.gray(`  Allowed domains: ${flow.metadata.allowedDomains.join(', ')}`));
    }
    console.log();
  });

// ─── delete ───────────────────────────────────────────────────────────────────
program
  .command('delete <name>')
  .description('Delete a flow and its artifacts')
  .action(async (name: string) => {
    const { getFlowDir } = await import('./list.js');
    const flowDir = getFlowDir(name);
    if (!existsSync(flowDir)) {
      console.error(chalk.red(`❌ Flow "${name}" not found.`));
      process.exit(1);
    }
    rmSync(flowDir, { recursive: true, force: true });
    console.log(chalk.green(`✅ Flow "${name}" deleted.`));
  });

// ─── auth ─────────────────────────────────────────────────────────────────────
const auth = program.command('auth').description('Manage authentication for flows');

auth
  .command('save <name>')
  .description('Save current browser cookies for a flow')
  .action(async (name: string) => {
    const { authSave } = await import('./session.js');
    await authSave(name);
  });

auth
  .command('refresh <name>')
  .description('Re-run the login flow to refresh session')
  .action(async (name: string) => {
    const { authRefresh } = await import('./session.js');
    await authRefresh(name);
  });

auth
  .command('clear <name>')
  .description('Clear stored auth data for a flow')
  .action(async (name: string) => {
    const { authClear } = await import('./session.js');
    authClear(name);
  });

auth
  .command('set-creds <name>')
  .description('Store login credentials for a flow')
  .requiredOption('-u, --username <username>', 'Username or email')
  .option('-p, --password [password]', 'Password (prompted if not supplied)')
  .action(async (name: string, opts: { username: string; password?: string | boolean }) => {
    let password = typeof opts.password === 'string' ? opts.password : '';
    if (!password) {
      // Simple prompt fallback
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      password = await new Promise<string>((resolve) => {
        rl.question('Password: ', (ans) => { rl.close(); resolve(ans); });
      });
    }
    const { authSetCreds } = await import('./session.js');
    authSetCreds(name, opts.username, password);
  });

auth
  .command('set-totp <name>')
  .description('Store a TOTP secret for MFA')
  .requiredOption('-s, --secret <secret>', 'TOTP base32 secret')
  .action(async (name: string, opts: { secret: string }) => {
    const { authSetTotp } = await import('./session.js');
    authSetTotp(name, opts.secret);
  });

// ─── match ────────────────────────────────────────────────────────────────────
program
  .command('match <message>')
  .description('Match natural language to stored flows')
  .action(async (message: string) => {
    const { matchFlows } = await import('../lib/intent-matcher.js');
    const matches = matchFlows(message);

    if (matches.length === 0) {
      console.log(chalk.yellow('No matching flows found.'));
      return;
    }

    console.log(chalk.bold(`\nMatching flows for: "${message}"\n`));
    for (const m of matches) {
      const confPct = Math.round(m.confidence * 100);
      const confColor = confPct >= 85 ? chalk.green : confPct >= 70 ? chalk.yellow : chalk.gray;
      console.log(`  ${chalk.cyan(m.flow)} — ${confColor(`${confPct}% confidence`)} [${m.suggestedAction}]`);
      if (Object.keys(m.extractedParams).length > 0) {
        console.log(chalk.gray(`    params: ${JSON.stringify(m.extractedParams)}`));
      }
      if (m.missingParams.length > 0) {
        console.log(chalk.yellow(`    missing: ${m.missingParams.join(', ')}`));
      }
    }
    console.log();
  });

// ─── queue ────────────────────────────────────────────────────────────────────
const queue = program.command('queue').description('Manage the pending task queue');

queue
  .command('list')
  .description('Show all pending tasks')
  .action(async () => {
    const { loadQueue } = await import('../lib/task-queue.js');
    const tasks = loadQueue();

    if (tasks.length === 0) {
      console.log(chalk.yellow('No tasks in queue.'));
      return;
    }

    console.log(chalk.bold(`\nTask queue (${tasks.length}):\n`));
    for (const task of tasks) {
      const statusColor =
        task.status === 'ready' ? chalk.green :
        task.status === 'running' ? chalk.cyan :
        task.status === 'done' ? chalk.gray :
        task.status === 'failed' ? chalk.red : chalk.yellow;

      console.log(`  ${chalk.dim(task.id.slice(0, 8))}  ${chalk.cyan(task.flow.padEnd(25))} ${statusColor(task.status.padEnd(10))}`);
      if (task.missingParams.length > 0) {
        console.log(chalk.yellow(`    Missing: ${task.missingParams.join(', ')}`));
      }
    }
    console.log();
  });

queue
  .command('run-all')
  .description('Execute all ready tasks')
  .action(async () => {
    const { getReadyTasks, markTaskRunning, markTaskDone, markTaskFailed } = await import('../lib/task-queue.js');
    const { execute } = await import('./execute.js');
    const tasks = getReadyTasks();

    if (tasks.length === 0) {
      console.log(chalk.yellow('No ready tasks in queue.'));
      return;
    }

    console.log(chalk.bold(`Running ${tasks.length} task(s)...\n`));
    for (const task of tasks) {
      markTaskRunning(task.id);
      try {
        await execute({ name: task.flow, params: task.params });
        markTaskDone(task.id);
      } catch (err) {
        markTaskFailed(task.id);
        console.error(chalk.red(`Failed task ${task.id}: ${(err as Error).message}`));
      }
    }
  });

queue
  .command('drop <id>')
  .description('Remove a task from the queue')
  .action(async (id: string) => {
    const { dropTask } = await import('../lib/task-queue.js');
    const dropped = dropTask(id);
    if (dropped) console.log(chalk.green(`✅ Task ${id} removed.`));
    else console.error(chalk.red(`❌ Task ${id} not found.`));
  });

queue
  .command('set-param <id> <param> <value>')
  .description('Fill in a missing parameter for a queued task')
  .action(async (id: string, param: string, value: string) => {
    const { setTaskParam } = await import('../lib/task-queue.js');
    const task = setTaskParam(id, param, value);
    if (task) {
      console.log(chalk.green(`✅ Set ${param}=${value} on task ${id}.`));
      if (task.missingParams.length === 0) {
        console.log(chalk.cyan('  Task is now ready to run.'));
      }
    } else {
      console.error(chalk.red(`❌ Task ${id} not found.`));
    }
  });

// ─── history ──────────────────────────────────────────────────────────────────
program
  .command('history <name>')
  .description('Show version history for a flow')
  .action(async (name: string) => {
    const { loadVersionHistory } = await import('../lib/flow-versioning.js');
    const { getFlowDir } = await import('./list.js');
    const history = loadVersionHistory(getFlowDir(name));

    if (history.length === 0) {
      console.log(chalk.yellow(`No version history for flow "${name}".`));
      return;
    }

    console.log(chalk.bold(`\nVersion history for: ${name}\n`));
    for (const v of history.reverse()) {
      const rate = v.successRate !== undefined ? `${Math.round(v.successRate * 100)}%` : 'n/a';
      console.log(
        `  v${v.version}  ${new Date(v.savedAt).toLocaleDateString().padEnd(12)} ` +
          `runs: ${(v.runCount ?? 0).toString().padStart(3)}  success: ${rate.padStart(5)}  ` +
          chalk.dim(v.scriptFile)
      );
    }
    console.log();
  });

// ─── rollback ─────────────────────────────────────────────────────────────────
program
  .command('rollback <name>')
  .description('Revert a flow to the last working version')
  .action(async (name: string) => {
    const { rollback } = await import('../lib/flow-versioning.js');
    const { getFlowDir } = await import('./list.js');
    const success = rollback(getFlowDir(name));
    if (success) console.log(chalk.green(`✅ Flow "${name}" rolled back.`));
    else console.error(chalk.red(`❌ No previous version found for "${name}".`));
  });

// ─── stats ────────────────────────────────────────────────────────────────────
program
  .command('stats <name>')
  .description('Show health statistics for a flow')
  .action(async (name: string) => {
    const { loadVersionHistory } = await import('../lib/flow-versioning.js');
    const { getFlowDir } = await import('./list.js');
    const history = loadVersionHistory(getFlowDir(name));

    const totalRuns = history.reduce((s, v) => s + (v.runCount ?? 0), 0);
    const totalSuccesses = history.reduce(
      (s, v) => s + Math.round((v.successRate ?? 0) * (v.runCount ?? 0)),
      0
    );
    const overallRate = totalRuns > 0 ? Math.round((totalSuccesses / totalRuns) * 100) : 0;

    console.log(chalk.bold(`\nStats for: ${name}`));
    console.log(`  Total runs: ${totalRuns}`);
    console.log(`  Success rate: ${overallRate}%`);
    console.log(`  Versions: ${history.length}`);
    console.log();
  });

// ─── resume ───────────────────────────────────────────────────────────────────
program
  .command('resume')
  .description('Resume an MFA-paused flow')
  .requiredOption('--code <code>', 'One-time MFA code')
  .action(async (opts: { code: string }) => {
    const { resumeMfa } = await import('./session.js');
    await resumeMfa(opts.code);
  });

// ─── doctor ───────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Run system health checks')
  .action(async () => {
    console.log(chalk.bold('\n🩺 Browser Automation Skill — Health Check\n'));

    // Node version
    const nodeOk = parseInt(process.version.slice(1)) >= 18;
    console.log(`  Node.js ${process.version}: ${nodeOk ? chalk.green('✓') : chalk.red('✗ (need >=18)')}`);

    // Playwright
    try {
      await import('playwright');
      console.log(`  Playwright: ${chalk.green('✓')}`);
    } catch {
      console.log(`  Playwright: ${chalk.red('✗ (not installed)')}`);
    }

    // Auth key
    const hasAuthKey = !!process.env['BROWSER_AUTO_AUTH_KEY'];
    console.log(`  BROWSER_AUTO_AUTH_KEY: ${hasAuthKey ? chalk.green('✓') : chalk.yellow('⚠ not set (auth features unavailable)')}`);

    // Flows directory
    const { listFlowNames } = await import('./list.js');
    const flowCount = listFlowNames().length;
    console.log(`  Stored flows: ${chalk.cyan(flowCount.toString())}`);

    console.log();
  });

program.parse();
