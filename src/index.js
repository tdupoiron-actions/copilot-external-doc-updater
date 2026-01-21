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
    // Use shell wrapper to ensure NOTION_TOKEN is properly passed to npx subprocess
    session = await client.createSession({
      model,
      streaming: true, // Enable streaming for better responsiveness
      mcpServers: {
        notion: {
          type: 'local',
          command: '/bin/sh',
          args: ['-c', `NOTION_TOKEN=${notionToken} npx -y @notionhq/notion-mcp-server`],
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

    // Timeout for AI operations (5 minutes to allow for complex Notion operations)
    const AI_TIMEOUT = 300000;

    // Add event listener for debugging
    session.on((event) => {
      if (event.type === 'tool.execution_start') {
        core.info(`🔧 AI calling tool: ${event.data.toolName}`);
        if (event.data.input) {
          core.info(`   Input: ${JSON.stringify(event.data.input).substring(0, 500)}`);
        }
      } else if (event.type === 'tool.execution_end') {
        core.info(`✅ Tool completed: ${event.data.toolName}`);
        if (event.data.output) {
          core.info(`   Output: ${JSON.stringify(event.data.output).substring(0, 500)}`);
        }
      } else if (event.type === 'assistant.message_delta') {
        // Log streaming response chunks
        core.info(`📝 AI response chunk: ${event.data.deltaContent}`);
      } else if (event.type === 'error') {
        core.error(`❌ Session error: ${JSON.stringify(event.data)}`);
      } else {
        // Log all other events for debugging
        core.info(`📌 Event: ${event.type}`);
      }
    });

    // Step 1: Search for or create Changelog page
    core.info('Searching for or creating Changelog page...');

    const changelogSearchPrompt = `I need to find or create a "Changelog" page under the parent page with ID "${notionPageId}".

First, try to retrieve the blocks/children of page "${notionPageId}" to see if there's already a child page named "Changelog".

If you find a "Changelog" child page, respond with ONLY its page ID (32 characters, no dashes).

If you don't find one, create a new page with title "Changelog" as a child of page "${notionPageId}", then respond with ONLY the new page ID (32 characters, no dashes).

Your response must be ONLY the page ID, nothing else. Example format: 1234567890abcdef1234567890abcdef`;

    core.info(`📤 Sending prompt:\n${changelogSearchPrompt}`);

    const searchResult = await session.sendAndWait({
      prompt: changelogSearchPrompt,
      timeout: AI_TIMEOUT,
    });

    core.info(`📥 Full AI response object: ${JSON.stringify(searchResult)}`);
    
    // Handle both SDK response formats: searchResult.content or searchResult.data.content
    const responseContent = searchResult.content || (searchResult.data && searchResult.data.content) || '';
    core.info(`📥 AI response content: ${responseContent}`);

    // Extract the changelog page ID from the AI response
    const changelogPageId = extractPageId(responseContent);

    if (!changelogPageId) {
      core.error(`AI response: ${responseContent}`);
      core.setFailed('Failed to find or create Changelog page - could not extract page ID from AI response');
      return;
    }

    core.info(`Using Changelog page: ${changelogPageId}`);

    // Step 2: Append changelog entry using AI
    core.info('Appending changelog entry...');

    await session.sendAndWait({
      prompt: buildChangelogPrompt(changelogEntry, changelogPageId),
      timeout: AI_TIMEOUT,
    });

    core.info('Changelog entry added successfully');

    // Step 3: Update main documentation page (if enabled and we have doc content)
    if (updateMode !== 'changelog-only' && changelogEntry.docContent && changelogEntry.hasReadme) {
      core.info('Updating main documentation page...');

      await session.sendAndWait({
        prompt: buildDocUpdatePrompt(changelogEntry, notionPageId),
        timeout: AI_TIMEOUT,
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
