import { describe, it, expect } from 'vitest';
import { VirtualFS } from '../src/vfs/virtual-fs.js';

describe('VirtualFS', () => {
  it('writes and reads files with path normalization', () => {
    const vfs = new VirtualFS();
    vfs.writeFile('./index.html', '<h1>Hello</h1>');

    expect(vfs.hasFile('index.html')).toBe(true);
    expect(vfs.hasFile('./index.html')).toBe(true);
    expect(vfs.readFile('index.html')).toBe('<h1>Hello</h1>');
  });

  it('edits files using search and replace', () => {
    const vfs = new VirtualFS();
    vfs.writeFile('index.html', '<title>Old Title</title>');

    const result = vfs.editFile('index.html', 'Old Title', 'Neon Cyber Title');
    expect(result.success).toBe(true);
    expect(vfs.readFile('index.html')).toBe('<title>Neon Cyber Title</title>');
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

  it('returns all files as an object map', () => {
    const vfs = new VirtualFS();
    vfs.writeFile('a.txt', 'AAA');
    vfs.writeFile('b.txt', 'BBB');

    const files = vfs.getFiles();
    expect(files).toEqual({
      'a.txt': 'AAA',
      'b.txt': 'BBB',
    });
  });

  it('flushes files to disk in specified directory', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'melonpan-vfs-test-'));
    try {
      const vfs = new VirtualFS();
      vfs.writeFile('nested/test.txt', 'Nested Content');
      vfs.writeFile('root.txt', 'Root Content');

      const written = await vfs.flushToDisk(tempDir);
      expect(written).toHaveLength(2);

      const contentNested = await fs.readFile(path.join(tempDir, 'nested/test.txt'), 'utf-8');
      expect(contentNested).toBe('Nested Content');

      const contentRoot = await fs.readFile(path.join(tempDir, 'root.txt'), 'utf-8');
      expect(contentRoot).toBe('Root Content');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

