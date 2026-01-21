# Copilot Instructions for copilot-external-doc-updater

## Project Overview

This is a **JavaScript GitHub Action** that automatically updates Notion documentation when PRs are merged or via manual trigger. It uses the **GitHub Copilot SDK** with **Notion MCP Server** integration, letting the AI decide which Notion API tools to use.

## Architecture

```
src/index.js → (builds via ncc) → dist/index.js → (runs as GitHub Action)
                                        ↓
                              GitHub Copilot SDK
                                        ↓
                              Notion MCP Server (spawned via npx)
                                        ↓
                                   Notion API
```

**Single entry point**: All logic lives in [src/index.js](src/index.js) - no module splitting. The action uses `@github/copilot-sdk` to create AI sessions that can interact with Notion through the MCP server.

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

### Environment Variable Handling

The Notion MCP server requires `NOTION_TOKEN`. Since the Copilot SDK spawns the MCP server as a subprocess, we use a bash wrapper to inline the environment variable:

```javascript
command: '/bin/bash',
args: ['-c', `NOTION_TOKEN=${notionToken} npx -y @notionhq/notion-mcp-server`],
```

## Build & Test

```bash
npm install              # Install dependencies
npm run build            # Bundle with ncc → dist/index.js
npm run test:notion      # Run Notion integration test (requires env vars)
```

**Important**: Always run `npm run build` after modifying `src/index.js`. The action runs from `dist/index.js`, not the source.

### Local Testing

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

## Dependencies

| Package | Purpose |
|---------|---------|
| `@actions/core` | GitHub Action inputs/outputs/logging |
| `@actions/github` | GitHub API client (Octokit) |
| `@github/copilot-sdk` | Copilot SDK for AI-driven sessions with MCP support |
| `@notionhq/notion-mcp-server` | Notion MCP server (spawned via npx at runtime) |
| `@vercel/ncc` | Bundle action for distribution |

## Conventions

- **Error handling**: Use `core.setFailed()` for fatal errors, `core.warning()` for recoverable issues
- **Logging**: Use `core.info()` for progress messages
- **Secrets**: Never log token values; pass via environment to subprocess using bash wrapper
- **AI prompts**: Be specific and concise; ask AI to respond with just IDs when needed
- **Cleanup**: Always destroy session and stop client in finally block
