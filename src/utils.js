/**
 * Utility functions for the Copilot External Doc Updater.
 * Extracted for testability.
 */

const {
  TREE_FILE_LIMIT,
  DOC_FILES_LIMIT,
  MAX_SUMMARY_LENGTH,
  MAX_README_CONTENT_LENGTH,
  SHORT_SHA_LENGTH,
} = require('./constants');

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
function formatTreeFiles(tree, limit = TREE_FILE_LIMIT) {
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
    commit: latestCommit.sha.substring(0, SHORT_SHA_LENGTH),
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
              content: changelogEntry.summary.substring(0, MAX_SUMMARY_LENGTH),
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

/**
 * Fetches the content of documentation files from a repository.
 * Prioritizes README.md and other common doc files.
 * @param {Object} octokit - GitHub API client.
 * @param {string} owner - Repository owner.
 * @param {string} repo - Repository name.
 * @param {string} ref - Git reference (branch/commit SHA).
 * @param {Array} changedFiles - Optional array of changed file paths to filter.
 * @returns {Promise<Object>} Object with file paths as keys and content as values.
 */
async function fetchDocContent(octokit, owner, repo, ref, changedFiles = null) {
  const docPatterns = [
    /^readme\.md$/i,
    /^docs?\//i,
    /\.md$/i,
    /^contributing\.md$/i,
    /^changelog\.md$/i,
  ];

  const docContent = {};
  const filesToFetch = [];

  // If we have a list of changed files, filter to doc files only
  if (changedFiles && changedFiles.length > 0) {
    for (const file of changedFiles) {
      const path = typeof file === 'string' ? file : file.filename || file.path;
      if (docPatterns.some((pattern) => pattern.test(path))) {
        filesToFetch.push(path);
      }
    }
  }

  // Always try to fetch README.md if not already included
  if (!filesToFetch.some((f) => /^readme\.md$/i.test(f))) {
    filesToFetch.unshift('README.md');
  }

  // Limit to prevent excessive API calls
  const filesToProcess = filesToFetch.slice(0, DOC_FILES_LIMIT);

  for (const path of filesToProcess) {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if (data.content && data.encoding === 'base64') {
        docContent[path] = Buffer.from(data.content, 'base64').toString('utf-8');
      }
    } catch {
      // File doesn't exist or couldn't be fetched, skip silently
    }
  }

  return docContent;
}

/**
 * Builds a documentation update context object.
 * @param {Object} entry - The changelog entry object.
 * @param {Object} docContent - Object with file paths and their content.
 * @returns {Object} Documentation update context.
 */
function buildDocUpdateContext(entry, docContent) {
  return {
    ...entry,
    docContent,
    hasReadme: Object.keys(docContent).some((path) => /^readme\.md$/i.test(path)),
    docFiles: Object.keys(docContent),
  };
}

/**
 * Extract a Notion page ID from AI response text.
 * Handles various formats like UUIDs with/without dashes.
 * @param {string} text - Text containing a potential page ID.
 * @returns {string|null} Extracted page ID or null if not found.
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
 * @param {Object} entry - The changelog entry object.
 * @param {string} pageId - The Notion page ID to append to.
 * @returns {string} The prompt for the AI.
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

**Summary paragraph:** ${entry.summary.substring(0, MAX_SUMMARY_LENGTH)}
${filesSection}

**Divider** at the end to separate from future entries.

Use the Notion API to append these blocks. Be efficient and make a single API call if possible.`;
}

/**
 * Build a natural language prompt for updating the main documentation page.
 * @param {Object} entry - The changelog entry object with docContent.
 * @param {string} pageId - The Notion page ID to update.
 * @returns {string|null} The prompt for the AI, or null if no README found.
 */
function buildDocUpdatePrompt(entry, pageId) {
  // Get README content (first matching README file)
  const readmeKey = Object.keys(entry.docContent).find((path) => /^readme\.md$/i.test(path));
  const readmeContent = readmeKey ? entry.docContent[readmeKey] : null;

  if (!readmeContent) {
    return null;
  }

  // Truncate content if too long
  const truncatedContent = readmeContent.length > MAX_README_CONTENT_LENGTH
    ? `${readmeContent.substring(0, MAX_README_CONTENT_LENGTH)}\n\n[Content truncated...]`
    : readmeContent;

  const referenceInfo = entry.type === 'pr'
    ? `PR #${entry.prNumber}: ${entry.title}`
    : `Commit ${entry.commit}: ${entry.title}`;

  return `Update the main documentation page with ID "${pageId}" based on the following README.md content.

**Context:** This update is from ${referenceInfo}

**README.md Content:**
\`\`\`markdown
${truncatedContent}
\`\`\`

**Instructions:**
1. First, read the current content of page "${pageId}" to understand its structure.
2. Update the page content to reflect the README.md content above, following these guidelines:
   - Convert Markdown headings to Notion headings (# = heading_1, ## = heading_2, ### = heading_3)
   - Convert Markdown code blocks to Notion code blocks with appropriate language
   - Convert Markdown lists to Notion bulleted or numbered lists
   - Convert Markdown links to Notion links
   - Preserve any existing Notion-specific content that isn't in the README (like the Changelog subpage)
3. If the page is empty or has minimal content, create the full structure from the README.
4. Be efficient - update only what has changed if possible.

Use the Notion API to perform these updates.`;
}

module.exports = {
  formatPRFiles,
  formatTreeFiles,
  createPRChangelogEntry,
  createSyncChangelogEntry,
  buildNotionBlocks,
  fetchDocContent,
  buildDocUpdateContext,
  extractPageId,
  buildChangelogPrompt,
  buildDocUpdatePrompt,
};
