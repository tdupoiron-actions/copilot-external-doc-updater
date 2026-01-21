const core = require('@actions/core');
const github = require('@actions/github');
const {
  formatPRFiles,
  formatTreeFiles,
  createPRChangelogEntry,
  createSyncChangelogEntry,
  fetchDocContent,
  buildDocUpdateContext,
  extractPageId,
  buildChangelogPrompt,
  buildDocUpdatePrompt,
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
    const model = core.getInput('model') || 'gpt-4o';
    const updateMode = core.getInput('update-mode') || 'changelog-and-doc';

    // Get context
    const context = github.context;
    const octokit = github.getOctokit(githubToken);

    // Determine if this is a PR event or workflow_dispatch
    const { pull_request: pr } = context.payload;
    const isWorkflowDispatch = context.eventName === 'workflow_dispatch';

    let changelogEntry;

    // Prepare changelog entry based on event type
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

      // Fetch documentation content for doc updates
      if (updateMode !== 'changelog-only') {
        const docContent = await fetchDocContent(
          octokit,
          context.repo.owner,
          context.repo.repo,
          pullRequest.head.sha,
          files,
        );
        changelogEntry = buildDocUpdateContext(changelogEntry, docContent);
      }
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

      // Fetch documentation content for doc updates
      if (updateMode !== 'changelog-only') {
        const docContent = await fetchDocContent(
          octokit,
          context.repo.owner,
          context.repo.repo,
          latestCommit.sha,
          tree.tree,
        );
        changelogEntry = buildDocUpdateContext(changelogEntry, docContent);
      }
    } else {
      core.setFailed('This action must be run on a pull_request or workflow_dispatch event');
      return;
    }

    core.info(`Initializing Copilot SDK with Notion MCP server (model: ${model})...`);

    // Initialize Copilot client
    client = new CopilotClient();
    await client.start();

    core.info('Copilot client started');

    // Create session with Notion MCP server
    // The AI will have access to all Notion tools and decide which to use
    // Use env to pass NOTION_TOKEN to the subprocess - more reliable on CI
    session = await client.createSession({
      model,
      streaming: true, // Use streaming mode for better stream lifecycle management
      mcpServers: {
        notion: {
          type: 'local',
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: {
            NOTION_TOKEN: notionToken,
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_OPTIONS: '--no-warnings', // Suppress experimental warnings
          },
          tools: ['*'], // Allow all Notion tools
        },
      },
      systemMessage: {
        content: `You are a documentation update assistant that manages Notion documentation and changelogs.
You have access to Notion API tools through the MCP server.
The target Notion page ID is: ${notionPageId}
Be concise and efficient - use the minimum number of API calls needed.
When creating changelog entries, format them nicely with headings, paragraphs, and dividers.
When updating documentation, preserve the existing structure and only update relevant sections based on the provided content.`,
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

    // Step 3: Update main documentation page (if enabled and we have doc content)
    if (updateMode !== 'changelog-only' && changelogEntry.docContent && changelogEntry.hasReadme) {
      core.info('Updating main documentation page...');

      await session.sendAndWait({
        prompt: buildDocUpdatePrompt(changelogEntry, notionPageId),
      });

      core.info('Main documentation page updated successfully');
    } else if (updateMode !== 'changelog-only') {
      core.info('Skipping doc update: No README.md or documentation files found in changes');
    }

    core.info('Documentation update completed successfully');
    core.setOutput('changelog-page-id', changelogPageId);
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  } finally {
    // Graceful cleanup with longer delay for CI environments
    // The delay allows pending stream writes to complete before destroying resources
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Clean up resources - session first, then client
    if (session) {
      try {
        await Promise.race([
          session.destroy(),
          new Promise((resolve) => setTimeout(resolve, 5000)), // Timeout after 5s
        ]);
      } catch (cleanupError) {
        // Ignore cleanup errors - stream may already be destroyed
        core.debug(`Session cleanup: ${cleanupError.message}`);
      }
    }

    // Additional delay before stopping client
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (client) {
      try {
        await Promise.race([
          client.stop(),
          new Promise((resolve) => setTimeout(resolve, 5000)), // Timeout after 5s
        ]);
      } catch (cleanupError) {
        // Ignore cleanup errors
        core.debug(`Client cleanup: ${cleanupError.message}`);
      }
    }
  }
}

run();
