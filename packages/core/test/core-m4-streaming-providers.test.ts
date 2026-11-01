import { describe, it, expect, vi } from 'vitest';
import {
  extractGeminiResponseParts,
  GeminiProvider,
  OpenAICompatibleProvider,
  SimulatedProvider,
  ProviderRegistry,
  MelonpanCore,
  AgentEvent,
} from '../src/index.js';

describe('Core-M4: ILLMProvider, Candidate Thought Extraction, Delta Streaming, AbortSignal & Replay Buffer', () => {
  describe('1. Candidate Thought Extraction (#4)', () => {
    it('extracts part.thought === true from candidates[0].content.parts even when response.text is undefined', () => {
      const mockGeminiResponse = {
        // @google/genai returns undefined for .text when only thought + functionCall parts exist
        text: undefined,
        candidates: [
          {
            content: {
              parts: [
                {
                  thought: true,
                  text: 'Deep internal reasoning about collision physics and HUD layout.',
                },
                {
                  functionCall: {
                    id: 'call-1',
                    name: 'write_file',
                    args: { path: 'index.html', content: '<html></html>' },
                  },
                },
              ],
            },
          },
        ],
      };

      const extracted = extractGeminiResponseParts(mockGeminiResponse);
      expect(extracted.thoughts).toEqual([
        'Deep internal reasoning about collision physics and HUD layout.',
      ]);
      expect(extracted.texts).toEqual([]);
    });
  });

  describe('2. ProviderRegistry & OpenAICompatibleProvider (#27)', () => {
    it('registers and switches between GeminiProvider, OpenAICompatibleProvider, and custom providers', async () => {
      const registry = new ProviderRegistry();
      expect(registry.listProviders()).toContain('gemini');
      expect(registry.listProviders()).toContain('openai-compat');
      expect(registry.listProviders()).toContain('simulated');

      // Test OpenAICompatibleProvider with mock fetchImpl
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                reasoning_content: 'Reasoning via OpenAI-compatible backend.',
                content: 'Final assistant answer.',
                tool_calls: [
                  {
                    id: 'tc_openai_1',
                    type: 'function',
                    function: {
                      name: 'complete_task',
                      arguments: JSON.stringify({ summary: 'Completed via OpenAI compat' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 140,
            completion_tokens: 60,
          },
        }),
      })) as any;

      const openAiProvider = new OpenAICompatibleProvider({
        id: 'local-vllm',
        baseUrl: 'http://localhost:8000/v1',
        apiKey: 'test-key',
        fetchImpl: mockFetch,
      });

      registry.registerProvider(openAiProvider);
      registry.setDefaultProvider('local-vllm');
      expect(registry.getDefaultProviderId()).toBe('local-vllm');

      const chunks = [];
      for await (const c of openAiProvider.streamChat({
        model: 'qwen-coder',
        systemInstruction: 'You are a coder.',
        messages: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      })) {
        chunks.push(c);
      }

      expect(chunks.some((c) => c.type === 'thought_delta' && c.delta?.includes('Reasoning via OpenAI'))).toBe(true);
      expect(chunks.some((c) => c.type === 'text_delta' && c.delta === 'Final assistant answer.')).toBe(true);
      expect(chunks.some((c) => c.type === 'tool_call_delta')).toBe(true);
      expect(chunks.some((c) => c.type === 'tool_call' && c.toolCall?.name === 'complete_task')).toBe(true);
    });
  });

  describe('3. Real-Time Delta Streaming (THOUGHT_DELTA, TEXT_DELTA, TOOL_CALL_DELTA) (#27)', () => {
    it('emits real-time delta events alongside full ReAct lifecycle events when driven by ILLMProvider', async () => {
      const simProvider = new SimulatedProvider([
        () => [
          { type: 'thought_delta', delta: 'Chunk 1 of thought... ' },
          { type: 'thought_delta', delta: 'Chunk 2 of thought.' },
          {
            type: 'tool_call_delta',
            delta: '{"path":"hello.txt","content":"world"}',
            toolCall: {
              id: 'tc-1',
              name: 'write_file',
              args: { path: 'hello.txt', content: 'world' },
            },
          },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-1',
              name: 'write_file',
              args: { path: 'hello.txt', content: 'world' },
            },
          },
          {
            type: 'usage',
            usage: { promptTokens: 120, completionTokens: 45, totalTokens: 165 },
          },
          { type: 'done' },
        ],
        () => [
          { type: 'text_delta', delta: 'All done!' },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-2',
              name: 'complete_task',
              args: { summary: 'Created hello.txt successfully' },
            },
          },
          {
            type: 'usage',
            usage: { promptTokens: 180, completionTokens: 30, totalTokens: 210 },
          },
          { type: 'done' },
        ],
      ]);

      const core = new MelonpanCore({
        provider: simProvider,
        enableStreaming: true,
      });

      const events: AgentEvent[] = [];
      for await (const ev of core.run('Create hello.txt')) {
        events.push(ev);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain('THOUGHT_DELTA');
      expect(types).toContain('TOOL_CALL_DELTA');
      expect(types).toContain('TEXT_DELTA');
      expect(types).toContain('FILE_CHANGED');
      expect(types).toContain('COMPLETE');

      expect(core.getVirtualFiles()['hello.txt']).toBe('world');

      // Check monotonic seq numbers (#52, #53)
      for (let i = 0; i < events.length; i++) {
        expect(events[i]!.seq).toBe(i + 1);
      }
    });
  });

  describe('4. Cascading AbortSignal Cancellation & Reconnection Replay (#27, #53)', () => {
    it('immediately cancels execution when AbortSignal triggers and provides getEventsSince / getStateSnapshot', async () => {
      const abortController = new AbortController();

      const slowProvider = new SimulatedProvider([
        () => {
          // Abort mid-stream on turn 1
          abortController.abort('ESC pressed by user');
          return [
            { type: 'thought_delta', delta: 'Starting work before abort...' },
          ];
        },
      ]);

      const core = new MelonpanCore({
        provider: slowProvider,
      });

      const events: AgentEvent[] = [];
      for await (const ev of core.run('Long task', { signal: abortController.signal })) {
        events.push(ev);
      }

      const completeEv = events.find((e) => e.type === 'COMPLETE');
      expect(completeEv).toBeDefined();
      expect(completeEv?.payload.aborted).toBe(true);

      // Reconnection replay buffer verification (#53)
      const allReplayed = core.getEventsSince(0);
      expect(allReplayed.length).toBe(events.length);

      const partialReplayed = core.getEventsSince(2);
      expect(partialReplayed.length).toBe(events.length - 2);
      expect(partialReplayed[0]!.seq).toBe(3);

      const snapshot = core.getStateSnapshot();
      expect(snapshot.lastSeq).toBe(events.length);
      expect(snapshot.sessionId).toBeDefined();
    });
  });
});
