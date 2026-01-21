/**
 * Utility functions for the Copilot External Doc Updater.
 * Extracted for testability.
 */

/**
 * Formats a list of changed files from a PR.
 * @param {Array} files - Array of file objects from GitHub API.
 * @returns {string} Formatted list of files.
 */
function formatPRFiles(files) {
  return files
    .map((f) => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`)
    .join('\n');
}

/**
 * Formats a list of files from a repository tree.
 * @param {Array} tree - Array of tree items from GitHub API.
 * @param {number} limit - Maximum number of files to include.
 * @returns {string} Formatted list of files.
 */
function formatTreeFiles(tree, limit = 50) {
  return tree
    .filter((item) => item.type === 'blob')
    .slice(0, limit)
    .map((f) => `- ${f.path}`)
    .join('\n');
}

/**
 * Creates a changelog entry for a PR event.
 * @param {Object} pullRequest - PR data from GitHub API.
 * @param {string} filesList - Formatted list of changed files.
 * @returns {Object} Changelog entry object.
 */
function createPRChangelogEntry(pullRequest, filesList) {
  return {
    type: 'pr',
    date: new Date().toISOString().split('T')[0],
    title: pullRequest.title,
    prNumber: pullRequest.number,
    author: pullRequest.user.login,
    url: pullRequest.html_url,
    summary: pullRequest.body || 'No description provided',
    files: filesList,
  };
}

/**
 * Creates a changelog entry for a sync (workflow_dispatch) event.
 * @param {Object} repo - Repository data from GitHub API.
 * @param {Object} latestCommit - Latest commit data from GitHub API.
 * @param {string} filesList - Formatted list of files.
 * @returns {Object} Changelog entry object.
 */
function createSyncChangelogEntry(repo, latestCommit, filesList) {
  return {
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
}

/**
 * Builds Notion blocks for a changelog entry.
 * @param {Object} changelogEntry - The changelog entry object.
 * @returns {Array} Array of Notion block objects.
 */
function buildNotionBlocks(changelogEntry) {
  const headingText = `${changelogEntry.date} - ${changelogEntry.title}`;

  const referenceText =
    changelogEntry.type === 'pr'
      ? `PR #${changelogEntry.prNumber} by @${changelogEntry.author}`
      : `Commit ${changelogEntry.commit} by ${changelogEntry.author}`;

  return [
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
  ];
}

module.exports = {
  formatPRFiles,
  formatTreeFiles,
  createPRChangelogEntry,
  createSyncChangelogEntry,
  buildNotionBlocks,
};
