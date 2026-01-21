# Copilot Instructions for copilot-external-doc-updater

## Project Overview

This is a **JavaScript GitHub Action** that automatically updates Notion documentation when PRs are merged or via manual trigger. It uses the Model Context Protocol (MCP) SDK to communicate with Notion's MCP server.

## Architecture

```
src/index.js → (builds via ncc) → dist/index.js → (runs as GitHub Action)
                                        ↓
                              Notion MCP Server (spawned via npx)
                                        ↓
                                   Notion API
```

**Single entry point**: All logic lives in [src/index.js](src/index.js) - no module splitting. The action connects to Notion via `@modelcontextprotocol/sdk`, spawning `@notionhq/notion-mcp-server` as a subprocess.

## Key Patterns

### Two Execution Modes

The action handles two distinct trigger types (see `run()` in [src/index.js](src/index.js)):

1. **PR mode** (`pull_request` event) — Extracts PR title, body, author, and changed files
2. **Sync mode** (`workflow_dispatch` event) — Syncs from default branch, uses latest commit info

Always check `context.eventName` and `context.payload.pull_request` to determine mode.

### MCP Client Lifecycle

```javascript
// 1. Create transport with spawned process
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@notionhq/notion-mcp-server'],
  env: { ...process.env, NOTION_TOKEN: notionToken },
});

// 2. Connect client
const mcpClient = new Client({ name: 'copilot-doc-updater', version: '1.0.0' });
await mcpClient.connect(transport);

// 3. Use tools via mcpClient.callTool({ name, arguments })

// 4. Always close on exit or error
await mcpClient.close();
```

### Notion Block Structure

Changelog entries use Notion's block API with this structure: `heading_2` → `paragraph` (link) → `paragraph` (summary) → `toggle` (files) → `divider`. See `notion_append_block_children` call for exact format.

## Build & Test

```bash
npm install              # Install dependencies
npm run build            # Bundle with ncc → dist/index.js
```

**Important**: Always run `npm run build` after modifying `src/index.js`. The action runs from `dist/index.js`, not the source.

### Test Workflow

Trigger via GitHub Actions UI (workflow_dispatch) or by merging a PR. Requires secrets:
- `NOTION_TOKEN` — Notion integration token
- `NOTION_PAGE_ID` — Target parent page ID

## Dependencies

| Package | Purpose |
|---------|---------|
| `@actions/core` | GitHub Action inputs/outputs/logging |
| `@actions/github` | GitHub API client (Octokit) |
| `@modelcontextprotocol/sdk` | MCP client for Notion communication |
| `@vercel/ncc` | Bundle action for distribution |

## Conventions

- **Error handling**: Use `core.setFailed()` for fatal errors, `core.warning()` for recoverable issues
- **Logging**: Use `core.info()` for progress messages
- **Secrets**: Never log token values; pass via environment to subprocess
- **Notion limits**: Truncate long content (e.g., `summary.substring(0, 2000)`)
