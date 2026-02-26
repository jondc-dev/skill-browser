---
name: browser-automation
version: 1.0.0
description: Record, replay and manage browser workflows with full auth handling, smart selectors, and natural-language intent matching.
entrypoint: bin/browser-auto
runtime: node
min_node_version: "18"
install: install.sh
capabilities:
  - browser_automation
  - web_interaction
  - credential_management
  - task_queue
  - flow_recording
permissions:
  - network
  - filesystem
  - environment_variables
environment:
  - BROWSER_AUTO_AUTH_KEY: "AES-256-GCM encryption key for auth storage (required)"
  - BROWSER_AUTO_FLOWS_DIR: "Override default flows directory (optional)"
  - BROWSER_AUTO_CDP_URL: "Default CDP endpoint for lightweight mode (optional)"
tags:
  - browser
  - automation
  - playwright
  - rpa
  - web
author: openclaw
---

# Browser Automation Skill

The Browser Automation Skill enables recording, replaying, and intelligently managing browser-based workflows with enterprise-grade features including encrypted credential storage, natural-language intent matching, and per-step retry logic.

## Quick Start

```bash
# Record a new flow
browser-auto record my-flow --url https://example.com

# Generate a Playwright script from the recording
browser-auto generate my-flow

# Run the flow
browser-auto run my-flow --params '{"email":"user@example.com"}'

# Match a natural language message to a flow
browser-auto match "I need to approve the gate pass for John arriving Monday"
```

## Commands

| Command | Description |
|---|---|
| `record <name> --url <url>` | Record a browser flow interactively |
| `generate <name>` | Generate a Playwright script from a recorded flow |
| `run <name> [options]` | Execute a flow with optional parameters |
| `list` | List all stored flows |
| `show <name>` | Show details about a specific flow |
| `delete <name>` | Delete a flow and its artifacts |
| `auth save <name>` | Save current browser cookies for a flow |
| `auth refresh <name>` | Re-run the login flow to refresh session |
| `auth clear <name>` | Clear stored auth data for a flow |
| `auth set-creds <name>` | Store login credentials (username/password) |
| `auth set-totp <name>` | Store a TOTP secret for MFA |
| `match <message>` | Match natural language to stored flows |
| `queue list` | Show the pending task queue |
| `queue run-all` | Execute all ready tasks in the queue |
| `queue drop <id>` | Remove a task from the queue |
| `queue set-param <id> <param> <value>` | Fill in a missing parameter for a queued task |
| `history <name>` | Show version history for a flow |
| `rollback <name>` | Revert a flow to the last working version |
| `stats <name>` | Show health statistics for a flow |
| `resume --code <code>` | Resume an MFA-paused flow with a one-time code |
| `exec <script> [args...]` | Run a script with the skill's Node dependencies (playwright, etc.) available |
| `doctor` | Run system health checks |

## Architecture

### Recording (`record`)
Launches a headed Chromium browser and attaches Chrome DevTools Protocol listeners to capture all user interactions. Every click, type, navigation, and form interaction is recorded with multiple selector strategies (testId > aria > css > xpath) for maximum replay reliability.

### Script Generation (`generate`)
Converts recorded flow steps to production-quality Playwright TypeScript scripts with intelligent wait generation, parameter detection, and `resilientLocator()` calls for robust element finding.

### Execution (`execute`)
Runs generated scripts with per-step retry and exponential backoff. Automatically re-authenticates when sessions expire. Supports headless/headed, batch, parallel, dry-run, and lightweight CDP-attach modes.

### Auth Management (`session` / `auth-store`)
Stores cookies and credentials encrypted with AES-256-GCM. Detects auth failures during execution and automatically triggers re-login flows. Supports TOTP-based MFA via `otplib`.

### Intent Matching (`intent-matcher`)
Analyzes natural language messages and conversation history to identify which stored flows are relevant. Uses semantic triggers, context clues, and entity extraction to match flows with configurable confidence thresholds.

### Task Queue (`task-queue`)
Persistent queue for auto-identified tasks. Tracks missing parameters, allows filling them interactively, and executes ready tasks in bulk.

## Configuration

Flows are stored in `~/.openclaw/browser-auto/flows/` by default. Each flow directory contains:
- `flow.json` — recorded steps and metadata
- `script.ts` — generated Playwright script
- `params.schema.json` — detected parameters with Zod validation
- `flow-intent.json` — natural language matching configuration
- `auth/` — encrypted auth artifacts
- `screenshots/` — step-level debug screenshots
- `run-logs/` — structured execution logs

## Running Custom Scripts

When writing `.mjs` or `.ts` scripts that import `playwright` directly, use `browser-auto exec` to ensure the skill's `node_modules/` is on the module resolution path:

```bash
# Run a custom script with playwright and other skill dependencies available
browser-auto exec my-script.ts
browser-auto exec /tmp/approve-wcrs.mjs --param1 value1
```

This sets `NODE_PATH` to the skill's `node_modules/` directory so Node.js ESM resolution can find `playwright` regardless of which directory the script runs from.

**Alternatives:**
- Set `NODE_PATH` manually: `NODE_PATH=/path/to/browser-automation/node_modules node my-script.mjs`
- Global install (for system-wide access): `BROWSER_AUTO_GLOBAL_INSTALL=true bash install.sh`

## Working with SPAs & Lazy-Loaded Components

Modern web apps built with React, Vue, Livewire, Turbo, and similar frameworks render components **lazily** — they don't exist in the DOM until a user interaction loads them. Attempting to query or interact with these components before they mount will fail.

### The Pattern

Always perform the UI interaction (click, hover, navigation) that triggers the component to mount **before** calling `page.evaluate()` or `page.waitForSelector()` on it.

```typescript
// ❌ WRONG — component doesn't exist yet
const details = await page.evaluate(() => Livewire.find('details'));

// ✅ CORRECT — trigger the component to mount first
await page.click('[data-action="open-details"]');
await page.waitForSelector('.details-panel', { state: 'visible' });
const details = await page.evaluate(() => Livewire.find('details'));
```

### Livewire-Specific

Livewire components mount when their parent view is rendered. For detail panels and side drawers, click to open the panel first — the Livewire component ID won't be available until the panel is visible.

### Recording Tips for SPAs

When recording flows for SPAs, include the interaction that triggers component mounting as an **explicit step**. Don't skip clicks or hovers that open panels, drawers, or modals — they are required prerequisites for subsequent steps.

### General SPA Tips

- Use `waitForSelector('.element', { state: 'visible' })` after interactions that reveal new content
- Use `waitForLoadState('networkidle')` after AJAX-driven page transitions
- Increase timeouts with `--delay-between <ms>` when components are slow to mount
- Always wait for overlays and modals to be visible before interacting with their children
- For single-page navigation (no full reload), prefer waiting for a specific element rather than `waitForLoadState('load')`

## Security

- All credentials and cookies are encrypted with AES-256-GCM
- Auth key is read from `BROWSER_AUTO_AUTH_KEY` environment variable
- Domain allowlisting prevents navigation to unexpected hosts
- Sensitive parameters are masked in all logs
