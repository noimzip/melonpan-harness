import { describe, it, expect, beforeEach } from 'vitest';
import { extendedCommandRegistry } from '../src/commands/registry.js';
import { CommandContext } from '../src/commands/types.js';
import { RuleBasedPermissionPolicy, VirtualFS, SkillManager } from '@melonpan/core';

describe('TUI-M2: Interactive Permission Prompt & Live Subagent Tree UI', () => {
  let ctx: CommandContext;
  let loggedActivities: string[];
  let loggedThoughts: string[];
  let policy: RuleBasedPermissionPolicy;

  beforeEach(() => {
    loggedActivities = [];
    loggedThoughts = [];
    policy = new RuleBasedPermissionPolicy();

    ctx = {
      model: 'gemini-3.8-flash',
      setModel: () => {},
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
      permissionPolicy: policy,
      sessionUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  });

  describe('Issue #33: /permissions command and policy management', () => {
    it('/permissions without args reports current policy status', async () => {
      await extendedCommandRegistry.executeCommand('/permissions', ctx);
      expect(loggedActivities.some((a) => a.includes('Permission Policy'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('Permission Policy Status'))).toBe(true);
    });

    it('/permissions auto switches policy to auto-allow mode', async () => {
      await extendedCommandRegistry.executeCommand('/permissions auto', ctx);
      expect(loggedActivities.some((a) => a.includes('Permission mode set to "auto"'))).toBe(true);

      // Verify policy rule evaluation
      const evalResult = policy.evaluate({
        requestId: 'test-1',
        toolName: 'run_command',
        category: 'execute',
        args: { command: 'echo hello' },
        riskLevel: 'medium',
      });
      expect(evalResult).toBe('allow');
    });

    it('/permissions strict denies execution tools', async () => {
      await extendedCommandRegistry.executeCommand('/permissions strict', ctx);
      expect(loggedActivities.some((a) => a.includes('Permission mode set to "strict"'))).toBe(true);

      const evalResult = policy.evaluate({
        requestId: 'test-2',
        toolName: 'run_command',
        category: 'execute',
        args: { command: 'npm test' },
        riskLevel: 'high',
      });
      expect(evalResult).toBe('deny');
    });

    it('provides autocomplete suggestions for /permissions', () => {
      const suggestions = extendedCommandRegistry.getAutocompleteSuggestions('/permissions ', ctx);
      expect(suggestions.length).toBe(3);
      const displays = suggestions.map((s) => s.display);
      expect(displays).toContain('auto');
      expect(displays).toContain('ask');
      expect(displays).toContain('strict');
    });
  });

  describe('Issue #34: /agents command and subagent specifications', () => {
    it('/agents lists all registered clean-room subagents', async () => {
      await extendedCommandRegistry.executeCommand('/agents', ctx);
      expect(loggedActivities.some((a) => a.includes('Registered Subagents'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('coder'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('researcher'))).toBe(true);
    });

    it('/agents <name> displays detailed allowed-tools for coder', async () => {
      await extendedCommandRegistry.executeCommand('/agents coder', ctx);
      expect(loggedActivities.some((a) => a.includes('Subagent: coder'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('write_file') && t.includes('edit_file'))).toBe(true);
    });

    it('provides autocomplete suggestions for /agents', () => {
      const suggestions = extendedCommandRegistry.getAutocompleteSuggestions('/agents ', ctx);
      expect(suggestions.length).toBe(3);
      const displays = suggestions.map((s) => s.display);
      expect(displays).toContain('coder');
      expect(displays).toContain('researcher');
      expect(displays).toContain('code-reviewer');
    });
  });
});
