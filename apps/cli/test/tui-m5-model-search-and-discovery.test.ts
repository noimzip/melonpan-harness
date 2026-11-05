import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extendedCommandRegistry } from '../src/commands/registry.js';
import { CommandContext } from '../src/commands/types.js';
import { VirtualFS, SkillManager, DiscoveredModel } from '@melonpan/core';
import { formatDiscoveredToPickerItems } from '../src/app.js';
import { ModalPicker, PickerItem } from '../src/components/modal-picker.js';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import React from 'react';

describe('TUI-M5: Model Search, API Routing, and Free Model Prioritization', () => {
  let ctx: CommandContext;
  let loggedActivities: string[];
  let loggedThoughts: string[];
  let currentModel: string;
  let currentProvider: string;
  let openedPickerType: string | null;

  const originalEnv = { ...process.env };

  beforeEach(() => {
    loggedActivities = [];
    loggedThoughts = [];
    currentModel = 'gemini-3.8-flash';
    currentProvider = 'gemini';
    openedPickerType = null;

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
      openPicker: (p) => {
        openedPickerType = p;
      },
      logActivity: (msg) => loggedActivities.push(msg),
      logThought: (msg) => loggedThoughts.push(msg),
      vfs: new VirtualFS(),
      skillManager: new SkillManager(),
      sessionUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Routing to OpenRouter, OrcaRouter, Groq, and Surplus', () => {
    it('/key supports openrouter, orcarouter, groq, and surplus API key configuration', async () => {
      await extendedCommandRegistry.executeCommand(
        '/key openrouter sk-or-v1-abcdef1234567890',
        ctx
      );
      expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-v1-abcdef1234567890');
      expect(loggedActivities.some((a) => a.includes('OPENROUTER API key set'))).toBe(true);

      await extendedCommandRegistry.executeCommand(
        '/key orcarouter sk-orca-1234567890abcdef',
        ctx
      );
      expect(process.env.ORCAROUTER_API_KEY).toBe('sk-orca-1234567890abcdef');
      expect(loggedActivities.some((a) => a.includes('ORCAROUTER API key set'))).toBe(true);

      await extendedCommandRegistry.executeCommand('/key groq gsk-1234567890abcdef', ctx);
      expect(process.env.GROQ_API_KEY).toBe('gsk-1234567890abcdef');
      expect(loggedActivities.some((a) => a.includes('GROQ API key set'))).toBe(true);

      await extendedCommandRegistry.executeCommand('/key surplus inf_test_key_1234567890', ctx);
      expect(process.env.SURPLUS_API_KEY).toBe('inf_test_key_1234567890');
      expect(loggedActivities.some((a) => a.includes('SURPLUS API key set'))).toBe(true);

      // Verify /key save surplus and /key surplus save
      await extendedCommandRegistry.executeCommand('/key save surplus inf_saved_key_1111', ctx);
      expect(process.env.SURPLUS_API_KEY).toBe('inf_saved_key_1111');
      expect(loggedActivities.some((a) => a.includes('SURPLUS API key saved to .env'))).toBe(true);

      await extendedCommandRegistry.executeCommand('/key surplus save inf_saved_key_2222', ctx);
      expect(process.env.SURPLUS_API_KEY).toBe('inf_saved_key_2222');
      expect(loggedActivities.some((a) => a.includes('SURPLUS API key set and saved'))).toBe(true);
    });

    it('/key status displays OpenRouter, OrcaRouter, Groq, and Surplus statuses', async () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test12345678';
      process.env.ORCAROUTER_API_KEY = 'sk-orca-test12345678';
      process.env.GROQ_API_KEY = 'gsk-test12345678';
      process.env.SURPLUS_API_KEY = 'inf_test12345678';

      await extendedCommandRegistry.executeCommand('/key status', ctx);
      expect(loggedThoughts.some((t) => t.includes('OpenRouter'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('OrcaRouter'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('Groq'))).toBe(true);
      expect(loggedThoughts.some((t) => t.includes('Surplus'))).toBe(true);
    });

    it('/model switches provider seamlessly to openrouter, orcarouter, groq, and surplus', async () => {
      // OpenRouter
      await extendedCommandRegistry.executeCommand(
        '/model meta-llama/llama-3.2-3b-instruct:free',
        ctx
      );
      expect(currentModel).toBe('meta-llama/llama-3.2-3b-instruct:free');
      expect(currentProvider).toBe('openrouter');

      // OrcaRouter
      await extendedCommandRegistry.executeCommand(
        '/model orcarouter/deepseek/deepseek-v4-flash-free',
        ctx
      );
      expect(currentModel).toBe('orcarouter/deepseek/deepseek-v4-flash-free');
      expect(currentProvider).toBe('orcarouter');

      // Groq
      await extendedCommandRegistry.executeCommand('/model llama-3.3-70b-versatile', ctx);
      expect(currentModel).toBe('llama-3.3-70b-versatile');
      expect(currentProvider).toBe('groq');

      // Surplus (prefix routing)
      await extendedCommandRegistry.executeCommand('/model surplus/deepseek/deepseek-chat', ctx);
      expect(currentModel).toBe('surplus/deepseek/deepseek-chat');
      expect(currentProvider).toBe('surplus');

      // Surplus (custom model with surplus/ prefix)
      await extendedCommandRegistry.executeCommand('/model surplus/some-custom-model', ctx);
      expect(currentModel).toBe('surplus/some-custom-model');
      expect(currentProvider).toBe('surplus');
    });
  });

  describe('2. Free Model Prioritization & Default Order Preservation', () => {
    it('sorts free models to the very top of each provider list while keeping default order for the rest', () => {
      const discovered: DiscoveredModel[] = [
        { id: 'paid-1', provider: 'openrouter', isFree: false, name: 'Paid 1' },
        { id: 'free-1', provider: 'openrouter', isFree: true, name: 'Free 1' },
        { id: 'paid-2', provider: 'openrouter', isFree: false, name: 'Paid 2' },
        { id: 'free-2', provider: 'openrouter', isFree: true, name: 'Free 2' },
        { id: 'paid-3', provider: 'openrouter', isFree: false, name: 'Paid 3' },
      ];

      const items = formatDiscoveredToPickerItems(discovered);
      const ids = items.map((it) => it.id);

      // Free models must be at top!
      expect(ids.slice(0, 2)).toEqual(['free-1', 'free-2']);
      // Remaining models must be in their original default order!
      expect(ids.slice(2)).toEqual(['paid-1', 'paid-2', 'paid-3']);
      // Free items must have isFree === true
      expect(items[0].isFree).toBe(true);
      expect(items[1].isFree).toBe(true);
      expect(items[2].isFree).toBe(false);
    });

    it('/model suggestions tags free models with [free] and places them at top', () => {
      const suggestions = extendedCommandRegistry.getAutocompleteSuggestions('/model free', ctx);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].description).toContain('[free]');
    });
  });

  describe('3. ModalPicker Search & Right-Side "free" Badge Rendering', () => {
    const renderHelper = (props: {
      items: PickerItem[];
      selectedId: string;
      enableSearch?: boolean;
    }) => {
      let text = '';
      const stream = new PassThrough();
      stream.on('data', (c) => {
        text += c.toString();
      });
      const inst = render(
        React.createElement(ModalPicker, {
          title: 'Select Model',
          items: props.items,
          selectedId: props.selectedId,
          enableSearch: props.enableSearch ?? true,
          onSelect: () => {},
          onCancel: () => {},
        }),
        { stdout: stream as any, stderr: stream as any }
      );
      inst.unmount();
      return text;
    };

    it('renders "free" text badge for free models', () => {
      const items: PickerItem[] = [
        {
          id: 'meta-llama/llama-3.2-3b-instruct:free',
          label: 'meta-llama/llama-3.2-3b-instruct:free',
          description: 'Free Llama',
          isFree: true,
        },
        {
          id: 'gpt-4o',
          label: 'gpt-4o',
          description: 'Standard model',
          isFree: false,
        },
      ];

      const rendered = renderHelper({ items, selectedId: 'gpt-4o' });
      expect(rendered).toContain('free');
      expect(rendered).toContain('meta-llama/llama-3.2-3b-instruct:free');
      expect(rendered).toContain('gpt-4o');
    });

    it('renders interactive search prompt in ModalPicker', () => {
      const items: PickerItem[] = [
        { id: 'm1', label: 'model-one', isFree: false },
        { id: 'm2', label: 'model-two', isFree: true },
      ];

      const rendered = renderHelper({ items, selectedId: 'm1', enableSearch: true });
      expect(rendered).toContain('Search:');
      expect(rendered).toContain('type to search');
    });

    it('renders message when no models are available (API keys not set)', () => {
      const rendered = renderHelper({ items: [], selectedId: 'none' });
      expect(rendered).toContain('No models available');
      expect(rendered).toContain('/key');
    });

    it('matches free models when searching "free" even if label or description does not explicitly contain "free"', () => {
      const items: PickerItem[] = [
        { id: 'zero-pricing-model', label: 'Zero Model', description: 'Zero Cost', isFree: true },
        { id: 'paid-model', label: 'Paid Model', description: 'Expensive', isFree: false },
      ];

      const rendered = renderHelper({ items, selectedId: 'zero-pricing-model', enableSearch: true });
      expect(rendered).toContain('Zero Model');
      expect(rendered).toContain('free');
    });
  });

  describe('4. /boost Command Support & Seamless Integration', () => {
    it('/boost without args opens the model picker', async () => {
      await extendedCommandRegistry.executeCommand('/boost', ctx);
      expect(openedPickerType).toBe('model');
      expect(loggedActivities.some((a) => a.includes('Active Model:'))).toBe(true);
    });

    it('/boost switches model and routes provider just like /model', async () => {
      await extendedCommandRegistry.executeCommand(
        '/boost meta-llama/llama-3.2-3b-instruct:free',
        ctx
      );
      expect(currentModel).toBe('meta-llama/llama-3.2-3b-instruct:free');
      expect(currentProvider).toBe('openrouter');
      expect(loggedActivities.some((a) => a.includes('Model switched to'))).toBe(true);
    });

    it('/boost provides autocomplete suggestions starting with /boost', () => {
      const suggestions = extendedCommandRegistry.getAutocompleteSuggestions('/boost free', ctx);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].text.startsWith('/boost ')).toBe(true);
      expect(suggestions[0].description).toContain('[free]');
    });

    it('/b autocompletes to /boost', () => {
      const suggestions = extendedCommandRegistry.getAutocompleteSuggestions('/b', ctx);
      expect(suggestions.some((s) => s.text === '/boost ' && s.display === '/boost')).toBe(true);
    });

    it('/key openrouter invokes refreshModels when provided on context', async () => {
      let refreshCalled = false;
      ctx.refreshModels = async () => {
        refreshCalled = true;
      };

      await extendedCommandRegistry.executeCommand(
        '/key openrouter sk-or-new-key-12345678',
        ctx
      );
      expect(refreshCalled).toBe(true);
    });
  });
});
