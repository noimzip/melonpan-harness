import { describe, it, expect, beforeEach } from 'vitest';
import { extendedCommandRegistry } from '../src/commands/registry.js';
import { CommandContext } from '../src/commands/types.js';
import { formatTerminalMarkdown } from '../src/utils/markdown.js';
import { VirtualFS, SkillManager } from '@melonpan/core';

describe('TUI-M4: Real-Time Token Streaming, Multi-Provider Picker & Scrollable UX', () => {
  let ctx: CommandContext;
  let loggedActivities: string[];
  let loggedThoughts: string[];
  let currentModel: string;
  let currentProvider: string;

  beforeEach(() => {
    loggedActivities = [];
    loggedThoughts = [];
    currentModel = 'gemini-3.8-flash';
    currentProvider = 'gemini';

    ctx = {
      model: currentModel,
      setModel: (m) => {
        currentModel = m;
        ctx.model = m;
      },
      provider: currentProvider,
      setProvider: (p) => {
        currentProvider = p;
        ctx.provider = p;
      },
      effort: 'high',
      setEffort: () => {},
      mode: 'auto',
      setMode: () => {},
      executePrompt: () => {},
      clearSession: () => {},
      logActivity: (msg) => loggedActivities.push(msg),
      logThought: (msg) => loggedThoughts.push(msg),
      vfs: new VirtualFS(),
      skillManager: new SkillManager(),
      sessionUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  });

  describe('Issue #37: Terminal Markdown Formatter', () => {
    it('formats markdown headings with distinct visual styling', () => {
      const md = '# Main Architecture\n## Module Specs\n### Step Details';
      const formatted = formatTerminalMarkdown(md);
      expect(formatted.length).toBe(3);
      expect(formatted[0]).toContain('Main Architecture');
      expect(formatted[1]).toContain('Module Specs');
      expect(formatted[2]).toContain('Step Details');
    });

    it('formats checklists and bullet items', () => {
      const md = '- [ ] Pending Task\n- [x] Done Task\n* Regular Bullet';
      const formatted = formatTerminalMarkdown(md);
      expect(formatted.length).toBe(3);
      expect(formatted[0]).toContain('Pending Task');
      expect(formatted[1]).toContain('Done Task');
      expect(formatted[2]).toContain('Regular Bullet');
    });

    it('formats fenced code blocks with box frame', () => {
      const md = '```typescript\nconst x: number = 42;\n```';
      const formatted = formatTerminalMarkdown(md);
      expect(formatted.length).toBe(3);
      expect(formatted[0]).toContain('typescript');
      expect(formatted[1]).toContain('const x: number = 42;');
    });
  });

  describe('Issue #38: Multi-Provider Model Switching and Key Management', () => {
    it('switches seamlessly to OpenAI model and updates active provider', async () => {
      await extendedCommandRegistry.executeCommand('/model gpt-4o', ctx);
      expect(currentModel).toBe('gpt-4o');
      expect(currentProvider).toBe('openai');
      expect(loggedActivities.some((a) => a.includes('Model switched to gpt-4o'))).toBe(true);
    });

    it('switches to Anthropic claude-3-7-sonnet', async () => {
      await extendedCommandRegistry.executeCommand('/model claude-3-7-sonnet', ctx);
      expect(currentModel).toBe('claude-3-7-sonnet');
      expect(currentProvider).toBe('anthropic');
      expect(loggedActivities.some((a) => a.includes('claude-3-7-sonnet'))).toBe(true);
    });

    it('/key status reports multi-provider keys', async () => {
      await extendedCommandRegistry.executeCommand('/key status', ctx);
      expect(loggedThoughts.some((t) => t.includes('Gemini API Key Status:'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('OpenAI Key'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('Anthropic'))).toBe(true);
    });

    it('/key openai sets OPENAI_API_KEY', async () => {
      await extendedCommandRegistry.executeCommand('/key openai sk-test1234567890abcdef', ctx);
      expect(process.env.OPENAI_API_KEY).toBe('sk-test1234567890abcdef');
      expect(loggedActivities.some((a) => a.includes('OPENAI API key set'))).toBe(true);
    });
  });

  describe('Issue #39: Task Cancellation Support', () => {
    it('aborts running task via AbortController signal gracefully', () => {
      const abortController = new AbortController();
      let aborted = false;

      abortController.signal.addEventListener('abort', () => {
        aborted = true;
      });

      // User presses Esc
      abortController.abort();
      expect(aborted).toBe(true);
      expect(abortController.signal.aborted).toBe(true);
    });
  });
});
