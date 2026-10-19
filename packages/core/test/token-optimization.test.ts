import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pruneChatHistory,
  ReactAgent,
  SubagentRunner,
  VirtualFS,
  SkillManager,
  MelonpanCore,
} from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Token Optimization: Context Pruning & Clean-Room Subagents', () => {
  describe('1. Context Pruning (pruneChatHistory)', () => {
    it('masks write_file content >= thresholdChars with preserved VFS marker', () => {
      const largeCode = 'const canvas = document.createElement("canvas");\n'.repeat(20);
      expect(largeCode.length).toBeGreaterThan(500);

      const history = [
        {
          role: 'user',
          parts: [{ text: 'Create an arcade game' }],
        },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'write_file',
                args: {
                  path: 'index.html',
                  content: largeCode,
                },
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'write_file',
                response: { output: 'Successfully wrote index.html' },
              },
            },
          ],
        },
      ];

      const result = pruneChatHistory(history, 200);
      expect(result.prunedCallsCount).toBe(1);
      expect(result.savedCharsCount).toBe(largeCode.length - `<Content preserved in VFS: ${largeCode.length} chars>`.length);

      const prunedContent = history[1]!.parts[0]!.functionCall!.args.content;
      expect(prunedContent).toBe(`<Content preserved in VFS: ${largeCode.length} chars>`);
    });

    it('leaves write_file content < thresholdChars unmasked', () => {
      const shortContent = 'console.log("hello");';
      const history = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'write_file',
                args: {
                  path: 'test.js',
                  content: shortContent,
                },
              },
            },
          ],
        },
      ];

      const result = pruneChatHistory(history, 200);
      expect(result.prunedCallsCount).toBe(0);
      expect(result.savedCharsCount).toBe(0);
      expect(history[0]!.parts[0]!.functionCall!.args.content).toBe(shortContent);
    });

    it('does not re-mask or double-mask already pruned content', () => {
      const history = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'write_file',
                args: {
                  path: 'index.html',
                  content: '<Content preserved in VFS: 4500 chars>',
                },
              },
            },
          ],
        },
      ];

      const result = pruneChatHistory(history, 200);
      expect(result.prunedCallsCount).toBe(0);
      expect(history[0]!.parts[0]!.functionCall!.args.content).toBe(
        '<Content preserved in VFS: 4500 chars>'
      );
    });

    it('ignores edit_file, dispatch_subagent, and other tools', () => {
      const largeDiff = 'const x = 123;\n'.repeat(30);
      const history = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'edit_file',
                args: {
                  path: 'index.html',
                  search: 'foo',
                  replace: largeDiff,
                },
              },
            },
            {
              functionCall: {
                name: 'dispatch_subagent',
                args: {
                  agent_type: 'researcher',
                  task_prompt: 'Research particle physics formulas in canvas',
                },
              },
            },
          ],
        },
      ];

      const result = pruneChatHistory(history, 200);
      expect(result.prunedCallsCount).toBe(0);
      expect(history[0]!.parts[0]!.functionCall!.args.replace).toBe(largeDiff);
    });

    it('handles non-array, empty, or malformed history safely', () => {
      expect(pruneChatHistory(null as any)).toEqual({ prunedCallsCount: 0, savedCharsCount: 0 });
      expect(pruneChatHistory([] as any)).toEqual({ prunedCallsCount: 0, savedCharsCount: 0 });
      expect(pruneChatHistory([{} as any, { parts: null } as any])).toEqual({
        prunedCallsCount: 0,
        savedCharsCount: 0,
      });
    });
  });

  describe('2. Clean-Room Subagent Runner & Token Usage Tracking', () => {
    it('executes simulation with clean-room isolation and tracks lastUsage', async () => {
      const runner = new SubagentRunner({ simulate: true });
      const targetCode = '<html><body><canvas id="c"></canvas></body></html>';

      const report = await runner.run(
        'code-reviewer',
        'Review performance and neon aesthetics',
        targetCode
      );

      expect(report).toBeDefined();
      expect(report.length).toBeGreaterThan(20);

      const usage = runner.getLastUsage();
      expect(usage).toBeDefined();
      expect(usage!.promptTokens).toBeGreaterThan(0);
      expect(usage!.completionTokens).toBeGreaterThan(0);
      expect(usage!.totalTokens).toBe(usage!.promptTokens + usage!.completionTokens);
    });

    it('records simulated token counts proportional to fileContext', async () => {
      const runner = new SubagentRunner({ simulate: true });
      await runner.run('researcher', 'Quick question');
      const shortUsage = runner.getLastUsage();

      const largeFile = 'function test() {}\n'.repeat(50);
      await runner.run('researcher', 'Audit code', largeFile);
      const largeUsage = runner.getLastUsage();

      expect(largeUsage!.promptTokens).toBeGreaterThanOrEqual(shortUsage!.promptTokens);
    });
  });

  describe('3. Strict edit_file Guidelines & Token Conservation Rules', () => {
    it('includes token conservation policy in game-generator SKILL.md', async () => {
      const skillPath = path.resolve(__dirname, '../skills/game-generator/SKILL.md');
      const content = await fs.readFile(skillPath, 'utf-8');

      expect(content).toContain('Code Modification & Token Conservation Policy (STRICT)');
      expect(content).toContain('STRICTLY FORBIDDEN from regenerating or rewriting the entire file using `write_file`');
      expect(content).toContain('MUST use `edit_file` to replace only the specific, targeted lines/functions');
    });

    it('runs MelonpanCore ReAct simulation with optimized token usage', async () => {
      const core = new MelonpanCore({ simulate: true, mode: 'act' });
      let completeEvent: any = null;

      for await (const event of core.run('Build space shooter')) {
        if (event.type === 'COMPLETE') {
          completeEvent = event;
        }
      }

      expect(completeEvent).toBeDefined();
      expect(completeEvent.payload.usage).toBeDefined();
      // Verified pruned tokens are significantly lower than unoptimized 8200 tokens
      expect(completeEvent.payload.usage.totalTokens).toBeLessThan(4500);
      expect(completeEvent.payload.usage.promptTokens).toBeLessThan(3000);
    });
  });
});
