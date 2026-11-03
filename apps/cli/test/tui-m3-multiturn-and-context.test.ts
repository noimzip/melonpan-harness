import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extendedCommandRegistry } from '../src/commands/registry.js';
import { CommandContext, SessionUsage } from '../src/commands/types.js';
import { VirtualFS, SkillManager } from '@melonpan/core';

describe('TUI-M3: Multi-Turn Conversation View, Context Gauge & Compaction UI', () => {
  let ctx: CommandContext;
  let loggedActivities: string[];
  let loggedThoughts: string[];
  let sessionUsage: SessionUsage;
  let sessionCleared: boolean;
  let compactionTriggered: boolean;

  beforeEach(() => {
    loggedActivities = [];
    loggedThoughts = [];
    sessionCleared = false;
    compactionTriggered = false;

    sessionUsage = {
      promptTokens: 25000,
      completionTokens: 8000,
      totalTokens: 33000,
      contextWindowTokens: 18500,
      maxContextTokens: 128000,
      savedTokens: 6200,
    };

    ctx = {
      model: 'gemini-3.8-flash',
      setModel: () => {},
      effort: 'high',
      setEffort: () => {},
      mode: 'auto',
      setMode: () => {},
      executePrompt: () => {},
      clearSession: () => {
        sessionCleared = true;
      },
      compactSession: async (_instructions) => {
        compactionTriggered = true;
      },
      logActivity: (msg) => loggedActivities.push(msg),
      logThought: (msg) => loggedThoughts.push(msg),
      vfs: new VirtualFS(),
      skillManager: new SkillManager(),
      sessionUsage,
    };
  });

  describe('Issue #35: Multi-Turn Conversation & /compact command', () => {
    it('/compact triggers context compaction on session', async () => {
      await extendedCommandRegistry.executeCommand('/compact Focus on game engine', ctx);
      expect(compactionTriggered).toBe(true);
      expect(loggedActivities.some((a) => a.includes('Context successfully compacted'))).toBe(true);
    });

    it('/compact provides argument suggestions for instructions', () => {
      const suggestions = extendedCommandRegistry.getAutocompleteSuggestions('/compact ', ctx);
      expect(suggestions.length).toBe(1);
      expect(suggestions[0]?.display).toBe('<instructions>');
    });

    it('/clear fully resets session', async () => {
      await extendedCommandRegistry.executeCommand('/clear', ctx);
      expect(sessionCleared).toBe(true);
      expect(loggedActivities.some((a) => a.includes('cleared'))).toBe(true);
    });
  });

  describe('Issue #36: Real-Time Context Gauge and /cost Breakdown', () => {
    it('/cost command clearly distinguishes Billed Tokens vs Current Context Window', async () => {
      await extendedCommandRegistry.executeCommand('/cost', ctx);

      // Section 1: Session Billed Usage
      expect(loggedThoughts.some((t) => t.includes('1. Session Billed Usage'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('33,000 tokens'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('USD') && t.includes('JPY'))).toBe(true);

      // Section 2: Current Context Window
      expect(loggedThoughts.some((t) => t.includes('2. Current Context Window'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('18,500 / 128,000 tokens'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('6,200 tokens freed'))).toBe(true);
    });

    it('/cost reports cached tokens and hit rate when caching is active', async () => {
      ctx.sessionUsage = {
        promptTokens: 20000,
        completionTokens: 2000,
        totalTokens: 22000,
        cachedPromptTokens: 15000,
        contextWindowTokens: 5000,
        maxContextTokens: 128000,
      };
      await extendedCommandRegistry.executeCommand('/cost', ctx);

      expect(loggedThoughts.some((t) => t.includes('Cached (Hit)    : 15,000 tokens (75% hit rate'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('Fresh (Uncached): 5,000 tokens'))).toBe(true);
    });

    it('/cost dynamically resolves maxContextTokens from active model when omitted from sessionUsage', async () => {
      ctx.model = 'gemini-3.8-flash';
      ctx.sessionUsage = {
        promptTokens: 10000,
        completionTokens: 1000,
        totalTokens: 11000,
        contextWindowTokens: 5000,
        savedTokens: 0,
      };
      await extendedCommandRegistry.executeCommand('/cost', ctx);

      // Should dynamically resolve Gemini 3.8 Flash's 1,048,576 tokens
      expect(loggedThoughts.some((t) => t.includes('5,000 / 1,048,576 tokens'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('Remaining Space   : 1,043,576 tokens'))).toBe(true);
    });
  });
});

