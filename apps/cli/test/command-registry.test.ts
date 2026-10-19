import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commandRegistry } from '../src/commands/registry.js';
import { CommandContext, SessionUsage } from '../src/commands/types.js';
import { VirtualFS, SkillManager } from '@melonpan/core';

describe('Melonpan CLI Command Registry & Autocomplete', () => {
  let ctx: CommandContext;
  let loggedActivities: string[];
  let loggedThoughts: string[];
  let modelState: string;
  let effortState: string;
  let modeState: 'plan' | 'act' | 'auto';
  let executedPrompt: { prompt: string; mode?: 'plan' | 'act' | 'auto' } | null;
  let sessionCleared: boolean;
  let vfs: VirtualFS;
  let skillManager: SkillManager;
  let sessionUsage: SessionUsage;

  beforeEach(async () => {
    loggedActivities = [];
    loggedThoughts = [];
    modelState = 'gemini-3.8-flash';
    effortState = 'high';
    modeState = 'auto';
    executedPrompt = null;
    sessionCleared = false;
    vfs = new VirtualFS();
    skillManager = new SkillManager();
    await skillManager.loadAllMetadata();
    sessionUsage = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    };

    let apiKeyState = '';
    let isSimulateState = true;

    ctx = {
      model: modelState,
      setModel: (m) => {
        modelState = m;
        ctx.model = m;
      },
      effort: effortState,
      setEffort: (e) => {
        effortState = e;
        ctx.effort = e;
      },
      apiKey: apiKeyState,
      setApiKey: (k) => {
        apiKeyState = k;
        ctx.apiKey = k;
      },
      isSimulate: isSimulateState,
      setSimulate: (s) => {
        isSimulateState = s;
        ctx.isSimulate = s;
      },
      mode: modeState,
      setMode: (m) => {
        modeState = m;
        ctx.mode = m;
      },
      executePrompt: (p, m) => {
        executedPrompt = { prompt: p, mode: m };
      },
      clearSession: () => {
        sessionCleared = true;
      },
      logActivity: (msg) => {
        loggedActivities.push(msg);
      },
      logThought: (msg) => {
        loggedThoughts.push(msg);
      },
      vfs,
      skillManager,
      sessionUsage,
    };
  });

  describe('1. Registered Commands Specification', () => {
    it('should register all 9 required slash commands', () => {
      const all = commandRegistry.getAllCommands();
      const names = all.map((c) => c.name);

      expect(names).toContain('model');
      expect(names).toContain('effort');
      expect(names).toContain('plan');
      expect(names).toContain('clear');
      expect(names).toContain('export');
      expect(names).toContain('help');
      expect(names).toContain('skills');
      expect(names).toContain('cost');
      expect(names).toContain('key');
      expect(names.length).toBe(9);
    });
  });

  describe('2. Autocomplete Suggestions Generator', () => {
    it('returns empty array if input does not start with "/"', () => {
      const suggestions = commandRegistry.getAutocompleteSuggestions('hello world', ctx);
      expect(suggestions).toEqual([]);
    });

    it('returns all 9 commands when input is exactly "/"', () => {
      const suggestions = commandRegistry.getAutocompleteSuggestions('/', ctx);
      expect(suggestions.length).toBe(9);
      const displays = suggestions.map((s) => s.display);
      expect(displays).toContain('/model');
      expect(displays).toContain('/effort');
      expect(displays).toContain('/plan');
      expect(displays).toContain('/clear');
      expect(displays).toContain('/export');
      expect(displays).toContain('/help');
      expect(displays).toContain('/skills');
      expect(displays).toContain('/cost');
      expect(displays).toContain('/key');
    });

    it('filters commands incrementally based on prefix', () => {
      const mSuggestions = commandRegistry.getAutocompleteSuggestions('/m', ctx);
      expect(mSuggestions.map((s) => s.display)).toEqual(['/model']);

      const kSuggestions = commandRegistry.getAutocompleteSuggestions('/k', ctx);
      expect(kSuggestions.map((s) => s.display)).toEqual(['/key']);

      const eSuggestions = commandRegistry.getAutocompleteSuggestions('/e', ctx);
      const eDisplays = eSuggestions.map((s) => s.display);
      expect(eDisplays).toContain('/effort');
      expect(eDisplays).toContain('/export');

      const cSuggestions = commandRegistry.getAutocompleteSuggestions('/c', ctx);
      const cDisplays = cSuggestions.map((s) => s.display);
      expect(cDisplays).toContain('/clear');
      expect(cDisplays).toContain('/cost');
    });

    it('provides sub-argument suggestions for /model', () => {
      const suggestions = commandRegistry.getAutocompleteSuggestions('/model ', ctx);
      expect(suggestions.length).toBe(4);
      const displays = suggestions.map((s) => s.display);
      expect(displays).toContain('gemini-3.5-flash-lite');
      expect(displays).toContain('gemini-3.8-flash');
      expect(displays).toContain('gemini-4-argon');
      expect(displays).toContain('gemma-4-31b-it');

      // Incremental filtering
      const argonSuggestions = commandRegistry.getAutocompleteSuggestions('/model argon', ctx);
      expect(argonSuggestions.map((s) => s.display)).toEqual(['gemini-4-argon']);
      expect(argonSuggestions[0]?.text).toBe('/model gemini-4-argon');
    });

    it('provides sub-argument suggestions for /effort', () => {
      const suggestions = commandRegistry.getAutocompleteSuggestions('/effort ', ctx);
      expect(suggestions.length).toBe(4);
      const displays = suggestions.map((s) => s.display);
      expect(displays).toContain('minimal');
      expect(displays).toContain('low');
      expect(displays).toContain('medium');
      expect(displays).toContain('high');

      // Incremental filtering
      const filtered = commandRegistry.getAutocompleteSuggestions('/effort med', ctx);
      expect(filtered.map((s) => s.display)).toEqual(['medium']);
      expect(filtered[0]?.text).toBe('/effort medium');
    });

    it('provides sub-argument suggestions for /skills', () => {
      const subSuggestions = commandRegistry.getAutocompleteSuggestions('/skills ', ctx);
      const displays = subSuggestions.map((s) => s.display);
      expect(displays).toContain('list');
      expect(displays).toContain('enable <name>');
      expect(displays).toContain('disable <name>');

      // Skill names suggestions for enable
      const enableSuggestions = commandRegistry.getAutocompleteSuggestions('/skills enable ', ctx);
      expect(enableSuggestions.length).toBeGreaterThan(0);
      expect(enableSuggestions.some((s) => s.text.startsWith('/skills enable '))).toBe(true);
    });

    it('provides suggestions for /export and /plan', () => {
      const exportSuggestions = commandRegistry.getAutocompleteSuggestions('/export ', ctx);
      expect(exportSuggestions.length).toBeGreaterThan(0);
      expect(exportSuggestions.map((s) => s.display)).toContain('./output/');

      const planSuggestions = commandRegistry.getAutocompleteSuggestions('/plan ', ctx);
      expect(planSuggestions.length).toBe(1);
      expect(planSuggestions[0]?.display).toBe('<prompt>');
    });

    it('provides sub-argument suggestions for /key', () => {
      const suggestions = commandRegistry.getAutocompleteSuggestions('/key ', ctx);
      expect(suggestions.length).toBe(3);
      const displays = suggestions.map((s) => s.display);
      expect(displays).toContain('status');
      expect(displays).toContain('clear');
      expect(displays).toContain('save <key>');
    });
  });

  describe('3. Command Handlers Execution', () => {
    it('/model [name] switches model, or reports active model without args', async () => {
      await commandRegistry.executeCommand('/model gemini-4-argon', ctx);
      expect(modelState).toBe('gemini-4-argon');
      expect(loggedActivities.some((a) => a.includes('switched to gemini-4-argon'))).toBe(true);

      // Without args
      let pickerOpened = false;
      ctx.openPicker = () => {
        pickerOpened = true;
      };
      await commandRegistry.executeCommand('/model', ctx);
      expect(pickerOpened).toBe(true);
    });

    it('/effort [level] switches thinking level, or reports active level without args', async () => {
      await commandRegistry.executeCommand('/effort minimal', ctx);
      expect(effortState).toBe('minimal');
      expect(loggedActivities.some((a) => a.includes('switched to minimal'))).toBe(true);

      // Without args
      let pickerOpened = false;
      ctx.openPicker = () => {
        pickerOpened = true;
      };
      await commandRegistry.executeCommand('/effort', ctx);
      expect(pickerOpened).toBe(true);
    });

    it('/plan toggles plan mode without args, and executes prompt with args', async () => {
      // Toggle to plan mode
      await commandRegistry.executeCommand('/plan', ctx);
      expect(modeState).toBe('plan');
      expect(loggedActivities.some((a) => a.includes('toggled ON'))).toBe(true);

      // Toggle back to auto mode
      await commandRegistry.executeCommand('/plan', ctx);
      expect(modeState).toBe('auto');
      expect(loggedActivities.some((a) => a.includes('toggled OFF'))).toBe(true);

      // With prompt argument
      await commandRegistry.executeCommand('/plan Build a 2D Platformer', ctx);
      expect(executedPrompt).toEqual({
        prompt: 'Build a 2D Platformer',
        mode: 'plan',
      });
    });

    it('/clear resets session context', async () => {
      await commandRegistry.executeCommand('/clear', ctx);
      expect(sessionCleared).toBe(true);
      expect(loggedActivities.some((a) => a.includes('cleared'))).toBe(true);
    });

    it('/cost reports cumulative session tokens and estimated cost in USD and JPY', async () => {
      await commandRegistry.executeCommand('/cost', ctx);
      expect(loggedActivities.some((a) => a.includes('Token usage: 1,500 tokens'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('USD') && t.includes('JPY'))).toBe(true);
    });

    it('/help displays formatted command guide', async () => {
      await commandRegistry.executeCommand('/help', ctx);
      expect(loggedActivities.some((a) => a.includes('Displayed help information'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('/model'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('/cost'))).toBe(true);
    });

    it('/skills manages agent skills (list, disable, enable)', async () => {
      // List
      await commandRegistry.executeCommand('/skills list', ctx);
      expect(loggedThoughts.some((t) => t.includes('Registered Agent Skills'))).toBe(true);

      // Disable
      const skills = skillManager.getIndexedSkills();
      const firstSkill = skills[0]!.name;

      await commandRegistry.executeCommand(`/skills disable ${firstSkill}`, ctx);
      expect(skillManager.isSkillEnabled(firstSkill)).toBe(false);

      // Enable
      await commandRegistry.executeCommand(`/skills enable ${firstSkill}`, ctx);
      expect(skillManager.isSkillEnabled(firstSkill)).toBe(true);
    });

    it('/export writes files to disk', async () => {
      // Empty VFS
      await commandRegistry.executeCommand('/export ./output/', ctx);
      expect(loggedActivities.some((a) => a.includes('No deliverables'))).toBe(true);

      // With files
      vfs.writeFile('index.html', '<h1>Hello</h1>');
      const flushSpy = vi.spyOn(vfs, 'flushToDisk').mockResolvedValue(['/tmp/output/index.html']);

      await commandRegistry.executeCommand('/export ./output/', ctx);
      expect(flushSpy).toHaveBeenCalledWith('./output/');
      expect(loggedActivities.some((a) => a.includes('Exported 1 files'))).toBe(true);
    });

    it('/key manages Gemini API key (status, set, clear, save)', async () => {
      // 1. Initial status (no key set)
      await commandRegistry.executeCommand('/key', ctx);
      expect(loggedThoughts.some((t) => t.includes('Gemini API Key Status'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('(not set)'))).toBe(true);

      // 2. Set API Key directly
      await commandRegistry.executeCommand('/key AIzaSyTestKey1234567890abcdef', ctx);
      expect(ctx.apiKey).toBe('AIzaSyTestKey1234567890abcdef');
      expect(ctx.isSimulate).toBe(false);
      expect(loggedActivities.some((a) => a.includes('API key set (AIzaSy...cdef)'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('AIzaSy...cdef'))).toBe(true);
      // Ensure raw key was never exposed in thought or activity
      expect(loggedActivities.some((a) => a.includes('AIzaSyTestKey1234567890abcdef'))).toBe(false);
      expect(loggedThoughts.some((t) => t.includes('AIzaSyTestKey1234567890abcdef'))).toBe(false);

      // 3. Status with key set (using alias /apikey)
      loggedThoughts = [];
      await commandRegistry.executeCommand('/apikey status', ctx);
      expect(loggedThoughts.some((t) => t.includes('AIzaSy...cdef'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('Live'))).toBe(true);

      // 4. Clear key
      await commandRegistry.executeCommand('/key clear', ctx);
      expect(ctx.apiKey).toBe('');
      expect(ctx.isSimulate).toBe(true);
      expect(loggedActivities.some((a) => a.includes('API key cleared'))).toBe(true);

      // 5. Save key
      const keyHandlerModule = await import('../src/commands/handlers/key.js');
      const saveSpy = vi.spyOn(keyHandlerModule, 'saveKeyToEnv').mockResolvedValue('/tmp/.env');
      await commandRegistry.executeCommand('/key save AIzaSyNewSavedKey1234567890', ctx);
      expect(ctx.apiKey).toBe('AIzaSyNewSavedKey1234567890');
      expect(ctx.isSimulate).toBe(false);
      expect(loggedActivities.some((a) => a.includes('API key saved to .env'))).toBe(true);
    });

    it('returns false when input does not start with "/"', async () => {
      const handled = await commandRegistry.executeCommand('Build a breakout game', ctx);
      expect(handled).toBe(false);
    });

    it('handles unknown slash commands gracefully', async () => {
      const handled = await commandRegistry.executeCommand('/unknowncmd', ctx);
      expect(handled).toBe(true);
      expect(loggedActivities.some((a) => a.includes('Unknown command "/unknowncmd"'))).toBe(true);
    });
  });
});
