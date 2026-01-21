# Copilot Instructions for copilot-external-doc-updater

## Project Overview

This is a **JavaScript GitHub Action** that automatically updates Notion documentation when PRs are merged or via manual trigger. It uses the **GitHub Copilot SDK** with **Notion MCP Server** integration, letting the AI decide which Notion API tools to use.

## Architecture

```
src/index.js ─┐
src/utils.js ─┴─→ (builds via ncc) → dist/index.js → (runs as GitHub Action)
                                           ↓
                                 GitHub Copilot SDK
                                           ↓
                                 Notion MCP Server (spawned via npx)
                                           ↓
                                      Notion API
```

**Entry point**: Main logic in [src/index.js](src/index.js) with utility functions extracted to [src/utils.js](src/utils.js) for testability. The action uses `@github/copilot-sdk` to create AI sessions that can interact with Notion through the MCP server.

## Key Patterns

### Copilot SDK + MCP Server Integration

The action uses an AI-driven approach where:
1. **CopilotClient** initializes a connection to the Copilot service
2. **createSession()** configures the Notion MCP server as a tool provider
3. **sendAndWait()** sends natural language prompts and lets AI decide which tools to use

```javascript
// 1. Dynamic import (ESM-only SDK in CommonJS action)
const { CopilotClient } = await import('@github/copilot-sdk');

// 2. Initialize and start client
const client = new CopilotClient();
await client.start();

// 3. Create session with MCP server
const session = await client.createSession({
  model: 'gpt-4o',
  mcpServers: {
    notion: {
      type: 'local',
      command: '/bin/bash',
      args: ['-c', `NOTION_TOKEN=${token} npx -y @notionhq/notion-mcp-server`],
      tools: ['*'],
    },
  },
  systemMessage: { content: 'You are a documentation assistant...' },
});

// 4. Send prompts - AI chooses which Notion tools to use
const result = await session.sendAndWait({
  prompt: 'Search for a Changelog page and create one if it doesn\'t exist...',
});

// 5. Cleanup
await session.destroy();
await client.stop();
```

### Two Execution Modes

The action handles two distinct trigger types (see `run()` in [src/index.js](src/index.js)):

1. **PR mode** (`pull_request` event) — Extracts PR title, body, author, and changed files
2. **Sync mode** (`workflow_dispatch` event) — Syncs from default branch, uses latest commit info

Always check `context.eventName` and `context.payload.pull_request` to determine mode.

### Update Modes

The action supports two update modes via the `update-mode` input:

1. **`changelog-only`** — Only creates changelog entries, no documentation sync
2. **`changelog-and-doc`** (default) — Creates changelog entries AND updates main Notion page from README.md

When `update-mode` is `changelog-and-doc`, the action fetches documentation content (README.md and other doc files) and updates the main Notion page to reflect the repository documentation.

### Environment Variable Handling

The Notion MCP server requires `NOTION_TOKEN`. Since the Copilot SDK spawns the MCP server as a subprocess, we use a bash wrapper to inline the environment variable:

```javascript
command: '/bin/bash',
args: ['-c', `NOTION_TOKEN=${notionToken} npx -y @notionhq/notion-mcp-server`],
```

## File Structure

| File | Purpose |
|------|---------|
| `src/index.js` | Main entry point, orchestrates the action flow |
| `src/utils.js` | Utility functions (formatting, changelog creation, doc fetching) |
| `src/utils.test.js` | Jest tests for utility functions |
| `scripts/test-notion.mjs` | Manual integration test for Notion MCP connection |
| `action.yml` | GitHub Action metadata and inputs definition |

### Key Utility Functions (src/utils.js)

- `formatPRFiles(files)` — Formats PR changed files list
- `formatTreeFiles(tree)` — Formats repository tree files list
- `createPRChangelogEntry(pr, files)` — Creates changelog entry for PR events
- `createSyncChangelogEntry(repo, commit, files)` — Creates changelog entry for sync events
- `fetchDocContent(octokit, owner, repo, ref, files)` — Fetches README.md and doc files content
- `buildDocUpdateContext(entry, docContent)` — Builds context for doc updates

## Build & Test

```bash
npm install              # Install dependencies
npm run build            # Bundle with ncc → dist/index.js
npm test                 # Run Jest unit tests
npm run test:coverage    # Run tests with coverage
npm run test:notion      # Run Notion integration test (requires env vars)
```

**Important**: Always run `npm run build` after modifying source files. The action runs from `dist/index.js`, not the source.

### Local Testing

You can use a `.env` file (don't commit it!) or set environment variables directly:

```bash
# Set environment variables and run integration test
NOTION_TOKEN=your_token NOTION_PAGE_ID=your_page_id npm run test:notion

# With --create-test flag to actually create a test entry
NOTION_TOKEN=your_token NOTION_PAGE_ID=your_page_id npm run test:notion -- --create-test
```

### Test Workflow

Trigger via GitHub Actions UI (workflow_dispatch) or by merging a PR. Requires secrets:
- `NOTION_TOKEN` — Notion integration token
- `NOTION_PAGE_ID` — Target parent page ID

## Action Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `notion-token` | Yes | — | Notion API token for authentication |
| `notion-page-id` | Yes | — | The ID of the Notion page to update |
| `github-token` | Yes | `${{ github.token }}` | GitHub token for API access |
| `model` | No | `gpt-4o` | AI model to use (e.g., gpt-4o, gpt-4.1, claude-sonnet-4) |
| `update-mode` | No | `changelog-and-doc` | What to update: `changelog-only` or `changelog-and-doc` |

## Dependencies

| Package | Purpose |
|---------|---------|
| `@actions/core` | GitHub Action inputs/outputs/logging |
| `@actions/github` | GitHub API client (Octokit) |
| `@github/copilot-sdk` | Copilot SDK for AI-driven sessions with MCP support |
| `@notionhq/notion-mcp-server` | Notion MCP server (spawned via npx at runtime) |
| `@vercel/ncc` | Bundle action for distribution (dev) |
| `dotenv` | Load .env files for local testing (dev) |
| `jest` | Unit testing framework (dev) |

## Conventions

- **Error handling**: Use `core.setFailed()` for fatal errors, `core.warning()` for recoverable issues
- **Logging**: Use `core.info()` for progress messages
- **Secrets**: Never log token values; pass via environment to subprocess using bash wrapper
- **AI prompts**: Be specific and concise; ask AI to respond with just IDs when needed
- **Cleanup**: Always destroy session and stop client in finally block
- **Testing**: Extract pure functions to utils.js for unit testing; use Jest for tests

## Documentation

If major changes are made, update this README and the [AGENTS.md](AGENTS.md) file to reflect new architecture or usage patterns.
