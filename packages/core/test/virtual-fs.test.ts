import { describe, it, expect } from 'vitest';
import { VirtualFS, InMemoryVFS, LocalDiskFS } from '../src/vfs/index.js';

describe('VirtualFS / InMemoryVFS & LocalDiskFS (Issues #2, #3, #10, #20)', () => {
  it('writes and reads files with path normalization and line ranges', () => {
    const vfs = new InMemoryVFS();
    vfs.writeFile('./index.html', 'line1\nline2\nline3\nline4');

    expect(vfs.hasFile('index.html')).toBe(true);
    expect(vfs.exists('./index.html')).toBe(true);
    expect(vfs.readFile('index.html')).toBe('line1\nline2\nline3\nline4');
    expect(vfs.readFile('index.html', { startLine: 2, endLine: 3 })).toBe('line2\nline3');
  });

  it('edits files using search and replace and generates unifiedDiff, addedLines, removedLines (#20)', () => {
    const vfs = new VirtualFS();
    vfs.writeFile('index.html', '<html>\n<title>Old Title</title>\n</html>');

    const result = vfs.editFile('index.html', '<title>Old Title</title>', '<title>Neon Cyber Title</title>\n<meta charset="utf-8">');
    expect(result.success).toBe(true);
    expect(vfs.readFile('index.html')).toBe('<html>\n<title>Neon Cyber Title</title>\n<meta charset="utf-8">\n</html>');
    expect(result.unifiedDiff).toContain('--- a/index.html');
    expect(result.unifiedDiff).toContain('+++ b/index.html');
    expect(result.unifiedDiff).toContain('-<title>Old Title</title>');
    expect(result.unifiedDiff).toContain('+<title>Neon Cyber Title</title>');
    expect(result.addedLines).toBe(2);
    expect(result.removedLines).toBe(1);
  });

  it('prevents data corruption from special $ replacement patterns in editFile (#2)', () => {
    const vfs = new VirtualFS();
    vfs.writeFile('app.js', 'const price = 10;\nconst tpl = "hello";');

    const res = vfs.editFile(
      'app.js',
      'const price = 10;',
      'const price = "$100 & $& $\' $` ${amount}";'
    );
    expect(res.success).toBe(true);
    expect(vfs.readFile('app.js')).toBe(
      'const price = "$100 & $& $\' $` ${amount}";\nconst tpl = "hello";'
    );
  });

  it('deletes files properly via deleteFile (#10)', () => {
    const vfs = new VirtualFS();
    vfs.writeFile('plan.md', '# Draft Plan');
    expect(vfs.hasFile('plan.md')).toBe(true);

    const deleted = vfs.deleteFile('./plan.md');
    expect(deleted).toBe(true);
    expect(vfs.hasFile('plan.md')).toBe(false);
    expect(vfs.readFile('plan.md')).toBeUndefined();
    expect(vfs.deleteFile('plan.md')).toBe(false);
  });

  it('returns error when search pattern is not found during edit', () => {
    const vfs = new VirtualFS();
    vfs.writeFile('index.html', '<div>Content</div>');

    const result = vfs.editFile('index.html', 'NonExistent', 'Replacement');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Search pattern not found');
  });

  it('returns error when editing non-existent file', () => {
    const vfs = new VirtualFS();
    const result = vfs.editFile('missing.js', 'a', 'b');
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('returns all files as an object map and filters with listFiles', () => {
    const vfs = new VirtualFS();
    vfs.writeFile('src/a.ts', 'AAA');
    vfs.writeFile('src/b.js', 'BBB');
    vfs.writeFile('node_modules/pkg/index.js', 'IGNORE');

    const files = vfs.getFiles();
    expect(files['src/a.ts']).toBe('AAA');

    const listedTs = vfs.listFiles('src', { pattern: '*.ts' });
    expect(listedTs).toEqual(['src/a.ts']);

    const allNonIgnored = vfs.listFiles();
    expect(allNonIgnored).toEqual(['src/a.ts', 'src/b.js']);
  });

  it('flushes files to disk and prevents path traversal or root-overwrite (#3)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'melonpan-vfs-test-'));
    try {
      const vfs = new VirtualFS();
      vfs.writeFile('nested/test.txt', 'Nested Content');
      vfs.writeFile('/index.html', 'Root Slash Sanitized');
      vfs.writeFile('../../evil.txt', 'Traversal Sanitized');

      const written = await vfs.flushToDisk(tempDir);
      expect(written).toHaveLength(3);

      for (const writtenPath of written) {
        expect(writtenPath.startsWith(tempDir + path.sep)).toBe(true);
      }

      const contentNested = await fs.readFile(path.join(tempDir, 'nested/test.txt'), 'utf-8');
      expect(contentNested).toBe('Nested Content');

      const contentRoot = await fs.readFile(path.join(tempDir, 'index.html'), 'utf-8');
      expect(contentRoot).toBe('Root Slash Sanitized');

      const contentEvil = await fs.readFile(path.join(tempDir, 'evil.txt'), 'utf-8');
      expect(contentEvil).toBe('Traversal Sanitized');

      // Direct tampering of internal map with raw '../' must throw path traversal error
      (vfs as any).files.set('../outside.txt', 'malicious');
      const vfs2 = new VirtualFS();
      (vfs2 as any).files.set('', 'root-overwrite');
      await expect(vfs2.flushToDisk(tempDir)).rejects.toThrow(/Path traversal detected/);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('LocalDiskFS reads, writes, edits with $ safety, lists, deletes, and blocks path traversal (#20, #3)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'melonpan-diskfs-test-'));
    try {
      const diskFs = new LocalDiskFS({ rootDir: tempDir });
      await diskFs.writeFile('src/main.ts', 'const cost = 5;\nconsole.log(cost);');
      expect(await diskFs.exists('src/main.ts')).toBe(true);

      const editRes = await diskFs.editFile('src/main.ts', 'const cost = 5;', 'const cost = "$500 $&";');
      expect(editRes.success).toBe(true);
      expect(editRes.unifiedDiff).toContain('-const cost = 5;');
      expect(editRes.unifiedDiff).toContain('+const cost = "$500 $&";');

      const content = await diskFs.readFile('src/main.ts');
      expect(content).toBe('const cost = "$500 $&";\nconsole.log(cost);');

      const files = await diskFs.listFiles();
      expect(files).toEqual(['src/main.ts']);

      expect(await diskFs.deleteFile('src/main.ts')).toBe(true);
      expect(await diskFs.exists('src/main.ts')).toBe(false);

      await expect(diskFs.readFile('../../etc/passwd')).rejects.toThrow(/Path traversal blocked/);
      await expect(diskFs.writeFile('/tmp/outside-melonpan.txt', 'bad')).rejects.toThrow(/Path traversal blocked/);

      // Symlink pointing outside workspace root must also be blocked (#3)
      const outsideFile = path.join(os.tmpdir(), `outside-secret-${Date.now()}.txt`);
      await fs.writeFile(outsideFile, 'secret-outside-data', 'utf-8');
      try {
        const symlinkPath = path.join(tempDir, 'escaped-link.txt');
        await fs.symlink(outsideFile, symlinkPath);
        await expect(diskFs.readFile('escaped-link.txt')).rejects.toThrow(/Path traversal blocked/);
        await expect(diskFs.writeFile('escaped-link.txt', 'overwrite')).rejects.toThrow(/Path traversal blocked/);
      } finally {
        await fs.rm(outsideFile, { force: true });
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
