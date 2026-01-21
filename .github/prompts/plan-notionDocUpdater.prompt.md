# Plan: Notion Documentation Updater GitHub Action

A simple JavaScript GitHub Action using Copilot SDK + Notion MCP to update documentation on PR merge. Copilot analyzes PR changes, updates the main Notion page, and manages a changelog subpage automatically.

## Steps

1. **Initialize project** — Create [package.json](package.json) with dependencies: `@github/copilot-sdk`, `@github/copilot`, `@actions/core`, `@actions/github`, and dev dependency `@vercel/ncc` for bundling.

2. **Create action manifest** — Define [action.yml](action.yml) with `node20` runtime, inputs (`notion-token`, `notion-page-id`, `github-token`), and entry point `dist/index.js`.

3. **Implement main logic** — In [src/index.js](src/index.js):
   - Read inputs via `core.getInput()`
   - Fetch PR context (title, body, diff, files) using `@actions/github`
   - Initialize `CopilotClient` with `cliPath` pointing to local CLI
   - Configure Notion MCP: `{ command: "npx", args: ["-y", "@notionhq/notion-mcp-server"], env: { NOTION_TOKEN }, tools: ["*"] }`
   - Create session with system prompt: "Update the Notion page with PR changes. Find or create a Changelog child page and append an entry."
   - Send PR context as user prompt, await completion

4. **Bundle action** — Run `ncc build src/index.js -o dist` to produce [dist/index.js](dist/index.js).

5. **Create test workflow** — Add [.github/workflows/test.yml](.github/workflows/test.yml):
   - Trigger: `pull_request: types: [closed]` with `if: github.event.pull_request.merged`
   - Use: `uses: ./` with secrets for `notion-token` and `notion-page-id`

## Project Structure

```
├── action.yml
├── package.json
├── src/
│   └── index.js
├── dist/
│   └── index.js
├── .github/workflows/
│   └── test.yml
├── LICENSE
└── README.md
```
