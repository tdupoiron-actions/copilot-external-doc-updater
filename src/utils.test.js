const {
  formatPRFiles,
  formatTreeFiles,
  createPRChangelogEntry,
  createSyncChangelogEntry,
  buildNotionBlocks,
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
