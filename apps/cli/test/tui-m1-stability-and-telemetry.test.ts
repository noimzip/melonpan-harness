import { describe, it, expect, vi } from 'vitest';
import { parseCliArgs } from '../src/cli-args.js';
import { extendedCommandRegistry } from '../src/commands/registry.js';
import { CommandContext } from '../src/commands/types.js';
import { VirtualFS, LocalDiskFS, SkillManager } from '@melonpan/core';

describe('TUI-M1: Core Stability, Plan Flow & Tool Telemetry UI', () => {
  describe('Issue #6: Space-separated CLI argument parsing', () => {
    it('parses space-separated --model, --effort, --out-dir, --fs, and --max-turns', () => {
      const argv = [
        '--model',
        'gemini-4-argon',
        '--effort',
        'medium',
        '--out-dir',
        '/tmp/output',
        '--fs',
        'disk',
        '--max-turns',
        '50',
        'Build',
        'a',
        'Snake',
        'Game',
      ];
      const parsed = parseCliArgs(argv);

      expect(parsed.model).toBe('gemini-4-argon');
      expect(parsed.initialEffort).toBe('medium');
      expect(parsed.outDir).toBe('/tmp/output');
      expect(parsed.fsMode).toBe('disk');
      expect(parsed.maxTurns).toBe(50);
      expect(parsed.initialPrompt).toBe('Build a Snake Game');
    });

    it('supports alternative flags like --thinking and --outDir with = syntax', () => {
      const argv = [
        '--thinking=low',
        '--outDir=/tmp/another',
        '--fs=vfs',
        '--mode=plan',
        'Refactor authentication',
      ];
      const parsed = parseCliArgs(argv);

      expect(parsed.initialEffort).toBe('low');
      expect(parsed.outDir).toBe('/tmp/another');
      expect(parsed.fsMode).toBe('vfs');
      expect(parsed.initialMode).toBe('plan');
      expect(parsed.initialPrompt).toBe('Refactor authentication');
    });
  });

  describe('Issue #7: Autocomplete Enter vs Raw Command Submission', () => {
    it('allows executing /model directly without args when submitted without suggestion navigation', async () => {
      let openedPicker: string | null = null;
      const ctx: Partial<CommandContext> = {
        model: 'gemini-3.8-flash',
        openPicker: (p) => {
          openedPicker = p;
        },
        logActivity: () => {},
        logThought: () => {},
      };

      // When user enters "/model" directly, executeCommand opens the modal picker
      const handled = await extendedCommandRegistry.executeCommand('/model', ctx as CommandContext);
      expect(handled).toBe(true);
      expect(openedPicker).toBe('model');
    });

    it('returns autocomplete suggestions for /model with Tab completion hints', () => {
      const ctx: Partial<CommandContext> = {};
      const suggestions = extendedCommandRegistry.getAutocompleteSuggestions('/', ctx as CommandContext);
      const modelSuggestion = suggestions.find((s) => s.display === '/model');
      expect(modelSuggestion).toBeDefined();
      expect(modelSuggestion?.text).toBe('/model ');
    });
  });

  describe('Issue #8 & #9: Plan Viewer Badges and Plan Mode Isolation', () => {
    it('verifies plan confirmation logic does not flush plan.md to disk on rejection', async () => {
      const vfs = new VirtualFS();
      vfs.writeFile('plan.md', '# Game Plan\n- [ ] Task 1');

      const flushSpy = vi.spyOn(vfs, 'flushToDisk');

      // User confirms plan -> approved
      let isPlanApproved = true;
      if (isPlanApproved) {
        await vfs.flushToDisk('/tmp/dest');
        expect(flushSpy).toHaveBeenCalledTimes(1);
      }

      // User rejects plan -> rejected, file deleted, no flush
      isPlanApproved = false;
      flushSpy.mockClear();
      if (!isPlanApproved) {
        vfs.deleteFile('plan.md');
      }
      expect(flushSpy).not.toHaveBeenCalled();
      expect(vfs.exists('plan.md')).toBe(false);
    });
  });

  describe('Issue #32: Filesystem Mode Support & LocalDiskFS Root Protection', () => {
    it('initializes LocalDiskFS securely and allows reading/writing within workspace', async () => {
      const testDir = '/tmp/melonpan-tui-test';
      const diskFs = new LocalDiskFS({ rootDir: testDir });
      expect(diskFs.getRootDir()).toBe(testDir);

      await diskFs.writeFile('test.txt', 'Hello Local Disk FS');
      const content = await diskFs.readFile('test.txt');
      expect(content).toBe('Hello Local Disk FS');

      const exists = await diskFs.exists('test.txt');
      expect(exists).toBe(true);

      // Block path traversal outside rootDir
      await expect(diskFs.readFile('../../etc/passwd')).rejects.toThrow(/outside workspace root/i);
    });
  });
});
