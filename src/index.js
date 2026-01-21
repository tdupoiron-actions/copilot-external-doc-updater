const core = require('@actions/core');
const github = require('@actions/github');
const {
  formatPRFiles,
  formatTreeFiles,
  createPRChangelogEntry,
  createSyncChangelogEntry,
} = require('./utils');

/**
 * Main entry point for the GitHub Action.
 * Uses the GitHub Copilot SDK with Notion MCP server to update documentation.
 * The AI decides which Notion API tools to use based on natural language prompts.
 */
async function run() {
  // Dynamic import for ESM-only Copilot SDK
  const { CopilotClient } = await import('@github/copilot-sdk');

  let client = null;
  let session = null;

  try {
    // Read inputs
    const notionToken = core.getInput('notion-token', { required: true });
    const notionPageId = core.getInput('notion-page-id', { required: true });
    const githubToken = core.getInput('github-token', { required: true });

    // Get context
    const context = github.context;
    const octokit = github.getOctokit(githubToken);

    // Determine if this is a PR event or workflow_dispatch
    const { pull_request: pr } = context.payload;
    const isWorkflowDispatch = context.eventName === 'workflow_dispatch';

    let changelogEntry;

    if (pr) {
      // PR-based update
      core.info('Running in PR mode...');

      // Fetch PR details
      const { data: pullRequest } = await octokit.rest.pulls.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.number,
      });

      // Fetch changed files
      const { data: files } = await octokit.rest.pulls.listFiles({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.number,
      });

      const filesList = formatPRFiles(files);
      changelogEntry = createPRChangelogEntry(pullRequest, filesList);
    } else if (isWorkflowDispatch) {
      // Manual trigger - update from main branch
      core.info('Running in workflow_dispatch mode - updating from main branch...');

      // Get repository info
      const { data: repo } = await octokit.rest.repos.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
      });

      // Get latest commit on default branch
      const { data: commits } = await octokit.rest.repos.listCommits({
        owner: context.repo.owner,
        repo: context.repo.repo,
        sha: repo.default_branch,
        per_page: 1,
      });

      const latestCommit = commits[0];

      // Get repository tree to list files
      const { data: tree } = await octokit.rest.git.getTree({
        owner: context.repo.owner,
        repo: context.repo.repo,
        tree_sha: latestCommit.sha,
        recursive: 'true',
      });

      const filesList = formatTreeFiles(tree.tree);
      changelogEntry = createSyncChangelogEntry(repo, latestCommit, filesList);
    } else {
      core.setFailed('This action must be run on a pull_request or workflow_dispatch event');
      return;
    }

    core.info('Initializing Copilot SDK with Notion MCP server...');

    // Initialize Copilot client
    client = new CopilotClient();
    await client.start();

    core.info('Copilot client started');

    // Create session with Notion MCP server
    // The AI will have access to all Notion tools and decide which to use
    session = await client.createSession({
      model: 'gpt-4o',
      streaming: false,
      mcpServers: {
        notion: {
          type: 'local',
          command: '/bin/bash',
          args: ['-c', `NOTION_TOKEN=${notionToken} npx -y @notionhq/notion-mcp-server`],
          tools: ['*'], // Allow all Notion tools
        },
      },
      systemMessage: {
        content: `You are a documentation update assistant that manages Notion changelogs.
You have access to Notion API tools through the MCP server.
The target Notion page ID is: ${notionPageId}
Be concise and efficient - use the minimum number of API calls needed.
When creating changelog entries, format them nicely with headings, paragraphs, and dividers.`,
      },
    });

    core.info(`Copilot session created: ${session.sessionId}`);

    // Step 1: Search for or create Changelog page
    core.info('Searching for or creating Changelog page...');

    const searchResult = await session.sendAndWait({
      prompt: `Search for a child page named "Changelog" under the page with ID "${notionPageId}".
If you find it, respond with just its page ID.
If you don't find it, create a new page titled "Changelog" as a child of page "${notionPageId}" and respond with the new page ID.
Only respond with the page ID, nothing else.`,
    });

    // Extract the changelog page ID from the AI response
    const changelogPageId = extractPageId(searchResult.content);

    if (!changelogPageId) {
      core.setFailed('Failed to find or create Changelog page');
      return;
    }

    core.info(`Using Changelog page: ${changelogPageId}`);

    // Step 2: Append changelog entry using AI
    core.info('Appending changelog entry...');

    await session.sendAndWait({
      prompt: buildChangelogPrompt(changelogEntry, changelogPageId),
    });

    core.info('Changelog entry added successfully');
    core.info('Documentation update completed successfully');
    core.setOutput('changelog-page-id', changelogPageId);
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  } finally {
    // Clean up resources
    if (session) {
      try {
        await session.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
    if (client) {
      try {
        await client.stop();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Extract a Notion page ID from AI response text.
 * Handles various formats like UUIDs with/without dashes.
 */
function extractPageId(text) {
  if (!text) return null;

  // Match UUID format (with or without dashes)
  const uuidPattern = /[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}/gi;
  const matches = text.match(uuidPattern);

  return matches ? matches[0].replace(/-/g, '') : null;
}

/**
 * Build a natural language prompt for creating a changelog entry.
 */
function buildChangelogPrompt(entry, pageId) {
  // entry.files is a pre-formatted string from formatPRFiles/formatTreeFiles
  const filesSection = entry.files && entry.files.trim().length > 0
    ? `\n\n**Toggle block titled "Changed Files":** containing the following list:\n${entry.files}`
    : '';

  const referenceText = entry.type === 'pr'
    ? `PR #${entry.prNumber} by @${entry.author}`
    : `Commit ${entry.commit} by ${entry.author}`;

  return `Append a new changelog entry to page "${pageId}" with the following content:

**Heading (heading_2):** ${entry.date} - ${entry.title}

**Link paragraph:** ${referenceText} - [View on GitHub](${entry.url})

**Summary paragraph:** ${entry.summary.substring(0, 2000)}
${filesSection}

**Divider** at the end to separate from future entries.

Use the Notion API to append these blocks. Be efficient and make a single API call if possible.`;
}

run();
