# Workflows Instructions

This folder contains GitHub Actions workflow definitions for the **copilot-external-doc-updater** action.

## Workflow: test.yml

The main workflow that tests and runs the Notion documentation updater action.

### Triggers

| Trigger | Condition | Purpose |
|---------|-----------|---------|
| `pull_request` | When a PR is closed and merged | Automatically update Notion changelog with PR details |
| `workflow_dispatch` | Manual trigger from Actions UI | Sync documentation from main branch on demand |

### Job: update-docs

Runs on `ubuntu-latest` with Node.js 24. Only executes when:
- Manually triggered via `workflow_dispatch`, OR
- A pull request was merged (not just closed)

### Required Secrets

| Secret | Description |
|--------|-------------|
| `NOTION_TOKEN` | Notion integration token for API authentication |
| `NOTION_PAGE_ID` | Target Notion page ID where documentation is updated |
| `GITHUB_TOKEN` | Automatically provided by GitHub for API access |

### Inputs (workflow_dispatch)

| Input | Type | Description |
|-------|------|-------------|
| `update-from-main` | boolean | Update documentation from main branch code |

## Conventions

- **Self-referencing action**: Uses `uses: ./` to test the action from the current repository
- **Model selection**: Configure AI model via the `model` input (e.g., `claude-sonnet-4`, `gpt-4.1`)
- **Condition guards**: Always check `github.event.pull_request.merged == true` for PR triggers to avoid running on closed-but-not-merged PRs
