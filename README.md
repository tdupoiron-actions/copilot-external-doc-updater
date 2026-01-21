# copilot-external-doc-updater

A GitHub Action that automatically updates Notion documentation using the **GitHub Copilot SDK** with **Notion MCP Server** integration. The AI decides which Notion API tools to use based on natural language prompts.

## Features

- 🤖 **AI-Driven**: Uses GitHub Copilot SDK to intelligently interact with Notion
- 📝 **Automatic Changelog**: Creates and updates changelog entries on PR merge
- 🔄 **Manual Sync**: Supports workflow_dispatch for on-demand documentation updates
- 🔌 **MCP Integration**: Connects to Notion via the official Notion MCP Server

## How It Works

```
GitHub Action → Copilot SDK → Notion MCP Server → Notion API
```

1. **PR Merged or Manual Trigger**: The action runs when a PR is merged or manually triggered
2. **Context Gathering**: Collects PR details, changed files, or repository state
3. **AI Session**: Creates a Copilot session with the Notion MCP server
4. **Smart Updates**: AI searches for or creates a Changelog page, then appends formatted entries

## Usage

### Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `notion-token` | Notion API integration token | Yes |
| `notion-page-id` | Target Notion page ID (parent for Changelog) | Yes |
| `github-token` | GitHub token for API access | Yes |

### Example Workflow

```yaml
name: Update Documentation
on:
  pull_request:
    types: [closed]
  workflow_dispatch:

jobs:
  update-docs:
    if: github.event.pull_request.merged == true || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: tdupoiron-actions/copilot-external-doc-updater@main
        with:
          notion-token: ${{ secrets.NOTION_TOKEN }}
          notion-page-id: ${{ secrets.NOTION_PAGE_ID }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Setting Up Notion

1. Create a [Notion integration](https://www.notion.so/my-integrations)
2. Copy the integration token (starts with `ntn_`)
3. Share your target Notion page with the integration
4. Copy the page ID from the URL (the 32-character string after the page title)

## Development

### Prerequisites

- Node.js (v18 or higher)
- npm
- GitHub Copilot access (for the SDK)

### Setup

```bash
# Install dependencies
npm install

# Build the action
npm run build
```

### Testing

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run Notion integration test (requires credentials)
NOTION_TOKEN=your_token NOTION_PAGE_ID=your_page_id npm run test:notion

# With test entry creation
NOTION_TOKEN=your_token NOTION_PAGE_ID=your_page_id npm run test:notion -- --create-test
```

### Test Structure

Tests are located alongside source files with a `.test.js` suffix:

- `src/utils.test.js` - Unit tests for utility functions
- `scripts/test-notion.mjs` - Integration test for Notion MCP connection

## Architecture

### Copilot SDK + MCP Server

The action uses the `@github/copilot-sdk` to create AI sessions that can interact with external tools via the Model Context Protocol (MCP):

```javascript
const { CopilotClient } = await import('@github/copilot-sdk');

const client = new CopilotClient();
await client.start();

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
});

// AI decides which Notion tools to use
await session.sendAndWait({
  prompt: 'Search for a Changelog page and append a new entry...',
});
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `@actions/core` | GitHub Action inputs/outputs/logging |
| `@actions/github` | GitHub API client (Octokit) |
| `@github/copilot-sdk` | Copilot SDK for AI-driven sessions |
| `@notionhq/notion-mcp-server` | Notion MCP server (runtime dependency) |
| `@vercel/ncc` | Bundle action for distribution |

## License

MIT
