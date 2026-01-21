const core = require('@actions/core');
const github = require('@actions/github');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { spawn } = require('child_process');

async function run() {
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

      const filesList = files.map(f => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`).join('\n');
      
      changelogEntry = {
        type: 'pr',
        date: new Date().toISOString().split('T')[0],
        title: pullRequest.title,
        prNumber: pullRequest.number,
        author: pullRequest.user.login,
        url: pullRequest.html_url,
        summary: pullRequest.body || 'No description provided',
        files: filesList,
      };
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
      
      const filesList = tree.tree
        .filter(item => item.type === 'blob')
        .slice(0, 50) // Limit to first 50 files
        .map(f => `- ${f.path}`)
        .join('\n');
      
      changelogEntry = {
        type: 'sync',
        date: new Date().toISOString().split('T')[0],
        title: `Documentation sync from ${repo.default_branch}`,
        commit: latestCommit.sha.substring(0, 7),
        author: latestCommit.commit.author.name,
        url: latestCommit.html_url,
        summary: `Synced documentation from ${repo.default_branch} branch.\n\nLatest commit: ${latestCommit.commit.message}`,
        files: filesList,
        repoDescription: repo.description || 'No description',
      };
    } else {
      core.setFailed('This action must be run on a pull_request or workflow_dispatch event');
      return;
    }

    core.info('Initializing Notion MCP client...');

    // Initialize MCP client for Notion
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: {
        ...process.env,
        NOTION_TOKEN: notionToken,
      },
    });

    const mcpClient = new Client({
      name: 'copilot-doc-updater',
      version: '1.0.0',
    });

    await mcpClient.connect(transport);

    core.info('Connected to Notion MCP server');

    // List available tools
    const tools = await mcpClient.listTools();
    core.info(`Available Notion tools: ${tools.tools.map(t => t.name).join(', ')}`);

    core.info('Searching for existing Changelog page...');

    // Search for Changelog child page
    let changelogPageId = null;
    try {
      const searchResult = await mcpClient.callTool({
        name: 'notion_search',
        arguments: {
          query: 'Changelog',
        },
      });
      
      const searchData = JSON.parse(searchResult.content[0].text);
      const changelogPage = searchData.results?.find(
        page => page.parent?.page_id === notionPageId && 
                page.properties?.title?.title?.[0]?.plain_text === 'Changelog'
      );
      
      if (changelogPage) {
        changelogPageId = changelogPage.id;
        core.info(`Found existing Changelog page: ${changelogPageId}`);
      }
    } catch (error) {
      core.warning(`Search failed: ${error.message}`);
    }

    // Create Changelog page if it doesn't exist
    if (!changelogPageId) {
      core.info('Creating new Changelog page...');
      try {
        const createResult = await mcpClient.callTool({
          name: 'notion_create_page',
          arguments: {
            parent_page_id: notionPageId,
            title: 'Changelog',
            properties: {},
          },
        });
        
        const createData = JSON.parse(createResult.content[0].text);
        changelogPageId = createData.id;
        core.info(`Created Changelog page: ${changelogPageId}`);
      } catch (error) {
        core.setFailed(`Failed to create Changelog page: ${error.message}`);
        await mcpClient.close();
        return;
      }
    }

    // Build changelog blocks based on entry type
    const headingText = changelogEntry.type === 'pr'
      ? `${changelogEntry.date} - ${changelogEntry.title}`
      : `${changelogEntry.date} - ${changelogEntry.title}`;
    
    const referenceText = changelogEntry.type === 'pr'
      ? `PR #${changelogEntry.prNumber} by @${changelogEntry.author}`
      : `Commit ${changelogEntry.commit} by ${changelogEntry.author}`;

    // Append changelog entry to the page
    core.info('Appending changelog entry...');
    try {
      await mcpClient.callTool({
        name: 'notion_append_block_children',
        arguments: {
          block_id: changelogPageId,
          children: [
            {
              type: 'heading_2',
              heading_2: {
                rich_text: [
                  {
                    type: 'text',
                    text: {
                      content: headingText,
                    },
                  },
                ],
              },
            },
            {
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  {
                    type: 'text',
                    text: {
                      content: referenceText,
                      link: { url: changelogEntry.url },
                    },
                  },
                ],
              },
            },
            {
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  {
                    type: 'text',
                    text: {
                      content: changelogEntry.summary.substring(0, 2000),
                    },
                  },
                ],
              },
            },
            {
              type: 'toggle',
              toggle: {
                rich_text: [
                  {
                    type: 'text',
                    text: {
                      content: 'Changed files',
                    },
                  },
                ],
                children: [
                  {
                    type: 'code',
                    code: {
                      rich_text: [
                        {
                          type: 'text',
                          text: {
                            content: changelogEntry.files,
                          },
                        },
                      ],
                      language: 'plain text',
                    },
                  },
                ],
              },
            },
            {
              type: 'divider',
              divider: {},
            },
          ],
        },
      });
      
      core.info('Changelog entry added successfully');
    } catch (error) {
      core.setFailed(`Failed to append changelog entry: ${error.message}`);
      await mcpClient.close();
      return;
    }

    // Close MCP connection
    await mcpClient.close();

    core.info('Documentation update completed successfully');
    core.setOutput('changelog-page-id', changelogPageId);
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

run();
