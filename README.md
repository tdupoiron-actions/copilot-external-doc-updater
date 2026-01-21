# copilot-external-doc-updater

A GitHub Action that automatically updates Notion documentation using the **GitHub Copilot SDK** with **Notion MCP Server** integration. The AI decides which Notion API tools to use based on natural language prompts.

## Features

- 🤖 **AI-Driven**: Uses GitHub Copilot SDK to intelligently interact with Notion
- 📝 **Automatic Changelog**: Creates and updates changelog entries on PR merge
- � **Documentation Sync**: Optionally syncs README.md content to Notion pages
- 🔄 **Manual Sync**: Supports `workflow_dispatch` for on-demand documentation updates
- 🔌 **MCP Integration**: Connects to Notion via the official Notion MCP Server
- 🎯 **Flexible Models**: Supports multiple AI models (GPT-4o, GPT-4.1, Claude Sonnet 4, etc.)

## How It Works

```
GitHub Action → Copilot SDK → Notion MCP Server → Notion API
```

1. **PR Merged or Manual Trigger**: The action runs when a PR is merged or manually triggered
2. **Context Gathering**: Collects PR details, changed files, or repository state
3. **AI Session**: Creates a Copilot session with the Notion MCP server
4. **Smart Updates**: AI searches for or creates a Changelog page, then appends formatted entries
5. **Documentation Sync** (optional): Updates the main Notion page with README.md content

## Usage

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `notion-token` | Notion API integration token | Yes | - |
| `notion-page-id` | Target Notion page ID (parent for Changelog) | Yes | - |
| `github-token` | GitHub token with Copilot access (must be a PAT, see below) | Yes | `${{ github.token }}` |
| `model` | AI model to use (e.g., `gpt-4o`, `gpt-4.1`, `claude-sonnet-4`) | No | `gpt-4o` |
| `update-mode` | What to update: `changelog-only` or `changelog-and-doc` | No | `changelog-and-doc` |

> ⚠️ **Important: GitHub Token Requirements**
>
> The `github-token` input **must be a Personal Access Token (PAT)** with Copilot access—the default `GITHUB_TOKEN` will not work. This is because:
>
> 1. **Copilot API Access**: The GitHub Copilot SDK requires authentication with a token that has Copilot permissions. The built-in `GITHUB_TOKEN` is scoped to repository operations and does not include Copilot API access.
> 2. **User Context**: Copilot features are tied to user accounts with active Copilot subscriptions. A PAT carries your user identity and subscription context.
>
> **To create a suitable PAT:**
> 1. Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
> 2. Create a new token (classic or fine-grained)
> 3. Ensure your account has an active GitHub Copilot subscription
> 4. Store the token as a repository secret (e.g., `COPILOT_TOKEN`)
> 5. Use `${{ secrets.COPILOT_TOKEN }}` in your workflow

### Update Modes

- **`changelog-only`**: Only creates changelog entries in Notion, no documentation sync
- **`changelog-and-doc`** (default): Creates changelog entries AND updates the main Notion page from README.md

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
      - uses: actions/checkout@v4

      - uses: tdupoiron-actions/copilot-external-doc-updater@main
        with:
          notion-token: ${{ secrets.NOTION_TOKEN }}
          notion-page-id: ${{ secrets.NOTION_PAGE_ID }}
          github-token: ${{ secrets.COPILOT_TOKEN }}  # Must be a PAT with Copilot access
          model: 'claude-sonnet-4'  # or gpt-4o, gpt-4.1, etc.
          update-mode: 'changelog-and-doc'
```

### Changelog-Only Mode

If you only want to track changes without syncing documentation:

```yaml
- uses: tdupoiron-actions/copilot-external-doc-updater@main
  with:
    notion-token: ${{ secrets.NOTION_TOKEN }}
    notion-page-id: ${{ secrets.NOTION_PAGE_ID }}
    github-token: ${{ secrets.COPILOT_TOKEN }}  # Must be a PAT with Copilot access
    update-mode: 'changelog-only'
```

### Setting Up Notion

1. Create a [Notion integration](https://www.notion.so/my-integrations)
2. Copy the integration token (starts with `ntn_`)
3. Share your target Notion page with the integration
4. Copy the page ID from the URL (the 32-character string after the page title)

## What Gets Created in Notion

### Changelog Entries

For each PR merge or manual sync, the action creates a changelog entry with:

- **Heading**: Date and PR title (or sync info)
- **Reference**: Link to PR or commit on GitHub
- **Summary**: PR description or commit message
- **Changed Files**: Collapsible toggle with the list of modified files
- **Divider**: Separates entries for readability

### Documentation Sync (changelog-and-doc mode)

When enabled, the action also:

1. Fetches README.md and other documentation files from the repository
2. Converts Markdown to Notion blocks (headings, code blocks, lists, links)
3. Updates the main Notion page to reflect the current documentation

## Development

### Prerequisites

- Node.js v20 or higher
- npm
- GitHub Copilot access (for the SDK)

### Setup

```bash
# Install dependencies
npm install

# Build the action (required after any source changes)
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

You can also use a `.env` file for local testing (don't commit it!):

```bash
# .env
NOTION_TOKEN=ntn_xxx
NOTION_PAGE_ID=your_page_id
```

### Project Structure

```
├── action.yml           # GitHub Action metadata and inputs
├── src/
│   ├── index.js         # Main entry point, orchestrates the action
│   ├── utils.js         # Utility functions (formatting, changelog creation)
│   └── utils.test.js    # Jest unit tests
├── scripts/
│   └── test-notion.mjs  # Manual integration test for Notion MCP
└── dist/
    └── index.js         # Bundled action (generated by ncc)
```

## Architecture

### Copilot SDK + MCP Server Integration

The action uses an AI-driven approach where:

1. **CopilotClient** initializes a connection to the Copilot service
2. **createSession()** configures the Notion MCP server as a tool provider
3. **sendAndWait()** sends natural language prompts and lets AI decide which tools to use

```javascript
// Dynamic import for ESM-only Copilot SDK
const { CopilotClient } = await import('@github/copilot-sdk');

// Initialize and start client
const client = new CopilotClient();
await client.start();

// Create session with Notion MCP server
const session = await client.createSession({
  model: 'gpt-4o',
  mcpServers: {
    notion: {
      type: 'local',
      command: '/bin/bash',
      args: ['-c', `NOTION_TOKEN=${token} npx -y @notionhq/notion-mcp-server`],
      tools: ['*'], // Allow all Notion tools
    },
  },
  systemMessage: {
    content: 'You are a documentation assistant...',
  },
});

// AI decides which Notion tools to use
const result = await session.sendAndWait({
  prompt: 'Search for a Changelog page and append a new entry...',
});

// Cleanup
await session.destroy();
await client.stop();
```

### Two Execution Modes

The action handles two trigger types:

1. **PR mode** (`pull_request` event): Extracts PR title, body, author, and changed files
2. **Sync mode** (`workflow_dispatch` event): Syncs from default branch, uses latest commit info

### Dependencies

| Package | Purpose |
|---------|---------|
| `@actions/core` | GitHub Action inputs/outputs/logging |
| `@actions/github` | GitHub API client (Octokit) |
| `@github/copilot-sdk` | Copilot SDK for AI-driven sessions with MCP support |
| `@notionhq/notion-mcp-server` | Notion MCP server (spawned via npx at runtime) |
| `@vercel/ncc` | Bundle action for distribution (dev) |
| `dotenv` | Load .env files for local testing (dev) |
| `jest` | Unit testing framework (dev) |

## Outputs

| Output | Description |
|--------|-------------|
| `changelog-page-id` | The ID of the Changelog page that was used or created |

## License

MIT
