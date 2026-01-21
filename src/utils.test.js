const {
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
} = require('./utils');

describe('formatPRFiles', () => {
  it('should format PR files correctly', () => {
    const files = [
      { filename: 'src/index.js', status: 'modified', additions: 10, deletions: 5 },
      { filename: 'README.md', status: 'added', additions: 20, deletions: 0 },
    ];

    const result = formatPRFiles(files);

    expect(result).toBe(
      '- src/index.js (modified, +10/-5)\n- README.md (added, +20/-0)'
    );
  });

  it('should return empty string for empty array', () => {
    const result = formatPRFiles([]);
    expect(result).toBe('');
  });
});

describe('formatTreeFiles', () => {
  it('should format tree files correctly', () => {
    const tree = [
      { path: 'src/index.js', type: 'blob' },
      { path: 'src/utils.js', type: 'blob' },
      { path: 'src', type: 'tree' },
    ];

    const result = formatTreeFiles(tree);

    expect(result).toBe('- src/index.js\n- src/utils.js');
  });

  it('should respect the limit parameter', () => {
    const tree = [
      { path: 'file1.js', type: 'blob' },
      { path: 'file2.js', type: 'blob' },
      { path: 'file3.js', type: 'blob' },
    ];

    const result = formatTreeFiles(tree, 2);

    expect(result).toBe('- file1.js\n- file2.js');
  });

  it('should filter out non-blob items', () => {
    const tree = [
      { path: 'src', type: 'tree' },
      { path: 'file.js', type: 'blob' },
    ];

    const result = formatTreeFiles(tree);

    expect(result).toBe('- file.js');
  });
});

describe('createPRChangelogEntry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-21'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should create a PR changelog entry', () => {
    const pullRequest = {
      title: 'Add new feature',
      number: 42,
      user: { login: 'testuser' },
      html_url: 'https://github.com/org/repo/pull/42',
      body: 'This PR adds a new feature',
    };
    const filesList = '- src/index.js (modified, +10/-5)';

    const result = createPRChangelogEntry(pullRequest, filesList);

    expect(result).toEqual({
      type: 'pr',
      date: '2026-01-21',
      title: 'Add new feature',
      prNumber: 42,
      author: 'testuser',
      url: 'https://github.com/org/repo/pull/42',
      summary: 'This PR adds a new feature',
      files: '- src/index.js (modified, +10/-5)',
    });
  });

  it('should use default summary when body is empty', () => {
    const pullRequest = {
      title: 'Fix bug',
      number: 1,
      user: { login: 'dev' },
      html_url: 'https://github.com/org/repo/pull/1',
      body: null,
    };

    const result = createPRChangelogEntry(pullRequest, '');

    expect(result.summary).toBe('No description provided');
  });
});

describe('createSyncChangelogEntry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-21'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should create a sync changelog entry', () => {
    const repo = {
      default_branch: 'main',
      description: 'A test repository',
    };
    const latestCommit = {
      sha: 'abc1234567890',
      commit: {
        author: { name: 'Test Author' },
        message: 'Latest commit message',
      },
      html_url: 'https://github.com/org/repo/commit/abc1234',
    };
    const filesList = '- src/index.js';

    const result = createSyncChangelogEntry(repo, latestCommit, filesList);

    expect(result).toEqual({
      type: 'sync',
      date: '2026-01-21',
      title: 'Documentation sync from main',
      commit: 'abc1234',
      author: 'Test Author',
      url: 'https://github.com/org/repo/commit/abc1234',
      summary: 'Synced documentation from main branch.\n\nLatest commit: Latest commit message',
      files: '- src/index.js',
      repoDescription: 'A test repository',
    });
  });

  it('should use default description when repo has none', () => {
    const repo = {
      default_branch: 'main',
      description: null,
    };
    const latestCommit = {
      sha: 'abc1234567890',
      commit: {
        author: { name: 'Author' },
        message: 'Commit',
      },
      html_url: 'https://github.com/org/repo/commit/abc1234',
    };

    const result = createSyncChangelogEntry(repo, latestCommit, '');

    expect(result.repoDescription).toBe('No description');
  });
});

describe('buildNotionBlocks', () => {
  it('should build Notion blocks for a PR entry', () => {
    const entry = {
      type: 'pr',
      date: '2026-01-21',
      title: 'Add feature',
      prNumber: 42,
      author: 'testuser',
      url: 'https://github.com/org/repo/pull/42',
      summary: 'A new feature',
      files: '- file.js',
    };

    const blocks = buildNotionBlocks(entry);

    expect(blocks).toHaveLength(5);
    expect(blocks[0].type).toBe('heading_2');
    expect(blocks[0].heading_2.rich_text[0].text.content).toBe('2026-01-21 - Add feature');
    expect(blocks[1].paragraph.rich_text[0].text.content).toBe('PR #42 by @testuser');
    expect(blocks[4].type).toBe('divider');
  });

  it('should build Notion blocks for a sync entry', () => {
    const entry = {
      type: 'sync',
      date: '2026-01-21',
      title: 'Documentation sync from main',
      commit: 'abc1234',
      author: 'Test Author',
      url: 'https://github.com/org/repo/commit/abc1234',
      summary: 'Synced docs',
      files: '- file.js',
    };

    const blocks = buildNotionBlocks(entry);

    expect(blocks[1].paragraph.rich_text[0].text.content).toBe('Commit abc1234 by Test Author');
  });

  it('should truncate summary to 2000 characters', () => {
    const longSummary = 'a'.repeat(3000);
    const entry = {
      type: 'pr',
      date: '2026-01-21',
      title: 'Test',
      prNumber: 1,
      author: 'user',
      url: 'https://example.com',
      summary: longSummary,
      files: '',
    };

    const blocks = buildNotionBlocks(entry);

    expect(blocks[2].paragraph.rich_text[0].text.content).toHaveLength(2000);
  });
});

describe('fetchDocContent', () => {
  it('should fetch README.md by default', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: {
              content: Buffer.from('# Hello World').toString('base64'),
              encoding: 'base64',
            },
          }),
        },
      },
    };

    const result = await fetchDocContent(mockOctokit, 'owner', 'repo', 'main');

    expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      path: 'README.md',
      ref: 'main',
    });
    expect(result['README.md']).toBe('# Hello World');
  });

  it('should filter changed files to doc files only', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: {
              content: Buffer.from('content').toString('base64'),
              encoding: 'base64',
            },
          }),
        },
      },
    };

    const changedFiles = [
      { filename: 'src/index.js' },
      { filename: 'docs/guide.md' },
      { filename: 'CONTRIBUTING.md' },
    ];

    await fetchDocContent(mockOctokit, 'owner', 'repo', 'main', changedFiles);

    // Should fetch README.md (always) + docs/guide.md + CONTRIBUTING.md
    expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledTimes(3);
  });

  it('should handle file fetch errors gracefully', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockRejectedValue(new Error('Not found')),
        },
      },
    };

    const result = await fetchDocContent(mockOctokit, 'owner', 'repo', 'main');

    expect(result).toEqual({});
  });

  it('should limit files to 5 max', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: {
              content: Buffer.from('content').toString('base64'),
              encoding: 'base64',
            },
          }),
        },
      },
    };

    const changedFiles = [
      'doc1.md',
      'doc2.md',
      'doc3.md',
      'doc4.md',
      'doc5.md',
      'doc6.md',
      'doc7.md',
    ];

    await fetchDocContent(mockOctokit, 'owner', 'repo', 'main', changedFiles);

    // Should only fetch 5 files max
    expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledTimes(5);
  });

  it('should handle string file paths in changedFiles', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: {
              content: Buffer.from('content').toString('base64'),
              encoding: 'base64',
            },
          }),
        },
      },
    };

    const changedFiles = ['README.md', 'docs/api.md'];

    await fetchDocContent(mockOctokit, 'owner', 'repo', 'main', changedFiles);

    expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'README.md' })
    );
  });

  it('should handle object with path property in changedFiles', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: {
              content: Buffer.from('content').toString('base64'),
              encoding: 'base64',
            },
          }),
        },
      },
    };

    const changedFiles = [{ path: 'changelog.md' }];

    await fetchDocContent(mockOctokit, 'owner', 'repo', 'main', changedFiles);

    // README.md (always added first) + changelog.md
    expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledTimes(2);
  });

  it('should skip files with non-base64 encoding', async () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: {
              content: 'raw content',
              encoding: 'utf-8',
            },
          }),
        },
      },
    };

    const result = await fetchDocContent(mockOctokit, 'owner', 'repo', 'main');

    expect(result).toEqual({});
  });
});

describe('buildDocUpdateContext', () => {
  it('should build context with hasReadme true when README exists', () => {
    const entry = {
      type: 'pr',
      title: 'Test PR',
      date: '2026-01-21',
    };
    const docContent = {
      'README.md': '# Project',
      'docs/guide.md': '# Guide',
    };

    const result = buildDocUpdateContext(entry, docContent);

    expect(result).toEqual({
      type: 'pr',
      title: 'Test PR',
      date: '2026-01-21',
      docContent,
      hasReadme: true,
      docFiles: ['README.md', 'docs/guide.md'],
    });
  });

  it('should build context with hasReadme false when no README', () => {
    const entry = { type: 'sync', title: 'Sync' };
    const docContent = { 'docs/api.md': '# API' };

    const result = buildDocUpdateContext(entry, docContent);

    expect(result.hasReadme).toBe(false);
    expect(result.docFiles).toEqual(['docs/api.md']);
  });

  it('should handle case-insensitive README detection', () => {
    const entry = { type: 'pr' };
    const docContent = { 'readme.md': '# Project' };

    const result = buildDocUpdateContext(entry, docContent);

    expect(result.hasReadme).toBe(true);
  });

  it('should handle empty docContent', () => {
    const entry = { type: 'sync' };
    const docContent = {};

    const result = buildDocUpdateContext(entry, docContent);

    expect(result.hasReadme).toBe(false);
    expect(result.docFiles).toEqual([]);
  });
});

describe('extractPageId', () => {
  it('should extract UUID with dashes', () => {
    const text = 'The page ID is 12345678-1234-1234-1234-123456789abc';
    const result = extractPageId(text);
    expect(result).toBe('12345678123412341234123456789abc');
  });

  it('should extract UUID without dashes', () => {
    const text = 'Page: 12345678123412341234123456789abc';
    const result = extractPageId(text);
    expect(result).toBe('12345678123412341234123456789abc');
  });

  it('should return null for empty text', () => {
    expect(extractPageId(null)).toBeNull();
    expect(extractPageId('')).toBeNull();
    expect(extractPageId(undefined)).toBeNull();
  });

  it('should return null when no UUID found', () => {
    const text = 'No page ID here';
    expect(extractPageId(text)).toBeNull();
  });

  it('should extract first UUID when multiple present', () => {
    const text = 'First: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee Second: 11111111-2222-3333-4444-555555555555';
    const result = extractPageId(text);
    expect(result).toBe('aaaaaaaabbbbccccddddeeeeeeeeeeee');
  });
});

describe('buildChangelogPrompt', () => {
  it('should build PR changelog prompt correctly', () => {
    const entry = {
      type: 'pr',
      date: '2026-01-21',
      title: 'Add new feature',
      prNumber: 42,
      author: 'testuser',
      url: 'https://github.com/test/repo/pull/42',
      summary: 'This is a test summary',
      files: '- src/index.js (modified, +10/-5)',
    };
    const pageId = 'test-page-id';

    const result = buildChangelogPrompt(entry, pageId);

    expect(result).toContain('test-page-id');
    expect(result).toContain('2026-01-21 - Add new feature');
    expect(result).toContain('PR #42 by @testuser');
    expect(result).toContain('https://github.com/test/repo/pull/42');
    expect(result).toContain('This is a test summary');
    expect(result).toContain('Changed Files');
    expect(result).toContain('src/index.js');
  });

  it('should build sync changelog prompt correctly', () => {
    const entry = {
      type: 'sync',
      date: '2026-01-21',
      title: 'Documentation sync from main',
      commit: 'abc1234',
      author: 'Test Author',
      url: 'https://github.com/test/repo/commit/abc1234',
      summary: 'Synced documentation',
      files: '- README.md',
    };
    const pageId = 'sync-page-id';

    const result = buildChangelogPrompt(entry, pageId);

    expect(result).toContain('Commit abc1234 by Test Author');
    expect(result).toContain('Documentation sync from main');
  });

  it('should handle empty files list', () => {
    const entry = {
      type: 'pr',
      date: '2026-01-21',
      title: 'Minor fix',
      prNumber: 1,
      author: 'user',
      url: 'https://example.com',
      summary: 'Fix',
      files: '',
    };

    const result = buildChangelogPrompt(entry, 'page-id');

    expect(result).not.toContain('Changed Files');
  });

  it('should truncate long summaries', () => {
    const longSummary = 'x'.repeat(3000);
    const entry = {
      type: 'pr',
      date: '2026-01-21',
      title: 'Test',
      prNumber: 1,
      author: 'user',
      url: 'https://example.com',
      summary: longSummary,
      files: '',
    };

    const result = buildChangelogPrompt(entry, 'page-id');

    // Summary should be truncated to 2000 chars
    expect(result.length).toBeLessThan(longSummary.length);
  });
});

describe('buildDocUpdatePrompt', () => {
  it('should build doc update prompt with README', () => {
    const entry = {
      type: 'pr',
      prNumber: 42,
      title: 'Update docs',
      docContent: {
        'README.md': '# My Project\n\nThis is a test project.',
      },
    };
    const pageId = 'doc-page-id';

    const result = buildDocUpdatePrompt(entry, pageId);

    expect(result).toContain('doc-page-id');
    expect(result).toContain('# My Project');
    expect(result).toContain('PR #42: Update docs');
    expect(result).toContain('Convert Markdown headings to Notion headings');
  });

  it('should build doc update prompt for sync entry', () => {
    const entry = {
      type: 'sync',
      commit: 'abc1234',
      title: 'Sync docs',
      docContent: {
        'README.md': '# Synced Project',
      },
    };

    const result = buildDocUpdatePrompt(entry, 'page-id');

    expect(result).toContain('Commit abc1234: Sync docs');
  });

  it('should return null when no README found', () => {
    const entry = {
      type: 'pr',
      prNumber: 1,
      title: 'Test',
      docContent: {
        'docs/api.md': '# API',
      },
    };

    const result = buildDocUpdatePrompt(entry, 'page-id');

    expect(result).toBeNull();
  });

  it('should handle case-insensitive README detection', () => {
    const entry = {
      type: 'pr',
      prNumber: 1,
      title: 'Test',
      docContent: {
        'readme.md': '# Lowercase README',
      },
    };

    const result = buildDocUpdatePrompt(entry, 'page-id');

    expect(result).toContain('# Lowercase README');
  });

  it('should truncate long README content', () => {
    const longContent = 'x'.repeat(10000);
    const entry = {
      type: 'pr',
      prNumber: 1,
      title: 'Test',
      docContent: {
        'README.md': longContent,
      },
    };

    const result = buildDocUpdatePrompt(entry, 'page-id');

    expect(result).toContain('[Content truncated...]');
    expect(result.length).toBeLessThan(longContent.length);
  });
});
