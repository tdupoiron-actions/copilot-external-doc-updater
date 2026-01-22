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
 * Sends a prompt and waits for completion using event-based tracking.
 * This avoids the SDK's internal 60s idle timeout.
 */
function sendPrompt(session, prompt, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    let response = '';
    let done = false;
    let lastActivity = Date.now();

    const timeout = setTimeout(() => finish(response || 'Timeout'), timeoutMs);
    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivity > 15000 && !done) {
        core.info('Idle timeout - assuming completion');
        finish(response || 'Completed');
      }
    }, 3000);

    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      clearInterval(idleCheck);
      session.destroy().catch(() => {});
      resolve(result);
    }

    let toolsRunning = 0;

    session.on((event) => {
      lastActivity = Date.now();
      switch (event.type) {
        case 'tool.execution_start':
          toolsRunning++;
          core.info(`🔧 Tool: ${event.data.toolName}`);
          break;
        case 'tool.execution_end':
          toolsRunning--;
          core.info(`✅ Done: ${event.data.toolName}`);
          break;
        case 'assistant.message':
          if (event.data?.content) response = event.data.content;
          // Only finish if we have content and no tools are running
          if (response && toolsRunning === 0) {
            core.info(`🤖 Response: ${response.substring(0, 500)}${response.length > 500 ? '...' : ''}`);
            finish(response);
          }
          break;
        case 'assistant.message_delta':
          if (event.data?.deltaContent) response += event.data.deltaContent;
          break;
        case 'error':
          core.error(`❌ Error: ${JSON.stringify(event.data)}`);
          finish(response || 'Error');
          break;
      }
    });

    core.info(`🤖 Prompt: ${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}`);
    session.send({ prompt }).catch((err) => {
      if (!done) reject(err);
    });
  });
}

/**
 * Creates a Copilot session with Notion MCP server.
 */
async function createSession(client, notionToken, notionPageId, model) {
  const session = await client.createSession({
    model,
    streaming: true,
    mcpServers: {
      notion: {
        type: 'local',
        command: '/bin/sh',
        args: ['-c', `NOTION_TOKEN=${notionToken} npx -y @notionhq/notion-mcp-server`],
        tools: ['*'],
      },
    },
    systemMessage: {
      content: `You are a documentation assistant with Notion API access.
Target page ID: ${notionPageId}
Be efficient - minimize API calls. Format changelog entries nicely.
Respond briefly when done.`,
    },
  });
  await new Promise((r) => setTimeout(r, 3000));
  return session;
}

/**
 * Main entry point for the GitHub Action.
 */
async function run() {
  const { CopilotClient } = await import('@github/copilot-sdk');
  let client = null;

  try {
    const notionToken = core.getInput('notion-token', { required: true });
    const notionPageId = core.getInput('notion-page-id', { required: true });
    const githubToken = core.getInput('github-token', { required: true });
    const model = core.getInput('model') || 'gpt-4o';
    const updateMode = core.getInput('update-mode') || 'changelog-and-doc';

    const context = github.context;
    const octokit = github.getOctokit(githubToken);
    const { pull_request: pr } = context.payload;
    const isWorkflowDispatch = context.eventName === 'workflow_dispatch';

    let changelogEntry;

    if (pr) {
      core.info('Running in PR mode...');
      const { data: pullRequest } = await octokit.rest.pulls.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.number,
      });
      const { data: files } = await octokit.rest.pulls.listFiles({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.number,
      });
      const filesList = formatPRFiles(files);
      changelogEntry = createPRChangelogEntry(pullRequest, filesList);
      if (updateMode !== 'changelog-only') {
        const docContent = await fetchDocContent(octokit, context.repo.owner, context.repo.repo, pullRequest.head.sha, files);
        changelogEntry = buildDocUpdateContext(changelogEntry, docContent);
      }
    } else if (isWorkflowDispatch) {
      core.info('Running in workflow_dispatch mode...');
      const { data: repo } = await octokit.rest.repos.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
      });
      const { data: commits } = await octokit.rest.repos.listCommits({
        owner: context.repo.owner,
        repo: context.repo.repo,
        sha: repo.default_branch,
        per_page: 1,
      });
      const latestCommit = commits[0];
      const { data: tree } = await octokit.rest.git.getTree({
        owner: context.repo.owner,
        repo: context.repo.repo,
        tree_sha: latestCommit.sha,
        recursive: 'true',
      });
      const filesList = formatTreeFiles(tree.tree);
      changelogEntry = createSyncChangelogEntry(repo, latestCommit, filesList);
      if (updateMode !== 'changelog-only') {
        const docContent = await fetchDocContent(octokit, context.repo.owner, context.repo.repo, latestCommit.sha, tree.tree);
        changelogEntry = buildDocUpdateContext(changelogEntry, docContent);
      }
    } else {
      core.setFailed('This action must be run on a pull_request or workflow_dispatch event');
      return;
    }

    core.info(`Initializing Copilot SDK (model: ${model})...`);
    client = new CopilotClient();
    await client.start();
    core.info('Copilot client started');

    // Step 1: Find or create Changelog page
    core.info('Step 1: Finding or creating Changelog page...');
    const session1 = await createSession(client, notionToken, notionPageId, model);
    const findPrompt = `Find or create a "Changelog" child page under page "${notionPageId}".
Check the page's children first. If "Changelog" exists, return its ID.
Otherwise create it and return the new ID.
Respond with ONLY the 32-character page ID (no dashes).`;
    const response1 = await sendPrompt(session1, findPrompt);
    const changelogPageId = extractPageId(response1);
    if (!changelogPageId) {
      core.setFailed('Failed to get Changelog page ID');
      return;
    }
    core.info(`Changelog page: ${changelogPageId}`);

    // Step 2: Add changelog entry
    core.info('Step 2: Adding changelog entry...');
    const session2 = await createSession(client, notionToken, notionPageId, model);
    const changelogPrompt = buildChangelogPrompt(changelogEntry, changelogPageId);
    const response2 = await sendPrompt(session2, changelogPrompt);
    core.info('Changelog entry added');

    // Step 3: Update documentation (if enabled)
    if (updateMode !== 'changelog-only' && changelogEntry.docContent && changelogEntry.hasReadme) {
      core.info('Step 3: Updating documentation page...');
      const session3 = await createSession(client, notionToken, notionPageId, model);
      const docPrompt = buildDocUpdatePrompt(changelogEntry, notionPageId);
      const response3 = await sendPrompt(session3, docPrompt);
      core.info('Documentation updated');
    }

    core.info('✅ All done!');
    core.setOutput('changelog-page-id', changelogPageId);
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  } finally {
    if (client) client.stop().catch(() => {});
    setTimeout(() => process.exit(0), 1000);
  }
}

run();
