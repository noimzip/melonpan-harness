import { describe, it, expect, vi } from 'vitest';
import {
  extractGeminiResponseParts,
  extractGeminiFunctionCalls,
  GeminiProvider,
  ReactAgent,
  AgentSession,
  LlmSummaryCompactionStrategy,
  SubagentRunner,
  LLMMessage,
  LLMStreamChunk,
  ToolRegistry,
  VirtualFS,
} from '../src/index.js';

let mockGenerateContent = vi.fn();
let mockGenerateContentStream = vi.fn();
let mockChatsCreate = vi.fn(() => ({
  history: [],
  sendMessage: vi.fn(),
}));

// Mock @google/genai module for testing GeminiProvider
vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  return {
    ...actual,
    GoogleGenAI: class MockGoogleGenAI {
      models: any;
      chats: any;
      constructor() {
        this.models = {
          generateContent: (...args: any[]) => mockGenerateContent(...args),
          generateContentStream: (...args: any[]) => mockGenerateContentStream(...args),
        };
        this.chats = {
          create: (...args: any[]) => mockChatsCreate(...args),
        };
      }
    },
  };
});

describe('Thought Signature Preservation in functionCall parts (Gemini 2.5 / 3 Thinking Mode)', () => {
  describe('1. extractGeminiFunctionCalls & extractGeminiResponseParts', () => {
    it('extracts thoughtSignature from part level (camelCase)', () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: 'fc-1',
                    name: 'default_api:activate_skill',
                    args: { name: 'code-review' },
                  },
                  thoughtSignature: 'sig_part_camel_123',
                },
              ],
            },
          },
        ],
      };

      const calls = extractGeminiFunctionCalls(mockResponse);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.name).toBe('default_api:activate_skill');
      expect(calls[0]?.thoughtSignature).toBe('sig_part_camel_123');
      expect(calls[0]?.thought_signature).toBe('sig_part_camel_123');
    });

    it('extracts thought_signature from part level (snake_case)', () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: 'fc-2',
                    name: 'write_file',
                    args: { path: 'test.ts', content: 'console.log(1);' },
                  },
                  thought_signature: 'sig_part_snake_456',
                },
              ],
            },
          },
        ],
      };

      const calls = extractGeminiFunctionCalls(mockResponse);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.thoughtSignature).toBe('sig_part_snake_456');
      expect(calls[0]?.thought_signature).toBe('sig_part_snake_456');
    });

    it('extracts thoughtSignature / thought_signature when nested inside functionCall', () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: 'fc-3',
                    name: 'run_command',
                    args: { command: 'ls -la' },
                    thoughtSignature: 'sig_fc_nested_789',
                  },
                },
              ],
            },
          },
        ],
      };

      const calls = extractGeminiFunctionCalls(mockResponse);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.thoughtSignature).toBe('sig_fc_nested_789');
      expect(calls[0]?.thought_signature).toBe('sig_fc_nested_789');
    });

    it('falls back to candidate-level or sibling part thought signature for parallel tool calls', () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  thought: true,
                  text: 'Reasoning about running multiple parallel tools...',
                  thoughtSignature: 'sig_sibling_thought_001',
                },
                {
                  functionCall: {
                    id: 'fc-parallel-1',
                    name: 'read_file',
                    args: { path: 'a.txt' },
                  },
                },
                {
                  functionCall: {
                    id: 'fc-parallel-2',
                    name: 'read_file',
                    args: { path: 'b.txt' },
                  },
                },
              ],
            },
          },
        ],
      };

      const calls = extractGeminiFunctionCalls(mockResponse);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.thoughtSignature).toBe('sig_sibling_thought_001');
      expect(calls[1]?.thoughtSignature).toBe('sig_sibling_thought_001');
    });

    it('falls back to functionCalls array when candidates parts are absent', () => {
      const mockResponse = {
        functionCalls: [
          {
            id: 'fc-fallback',
            name: 'complete_task',
            args: { summary: 'Done' },
            thoughtSignature: 'sig_fallback_array',
          },
        ],
      };

      const calls = extractGeminiFunctionCalls(mockResponse);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.name).toBe('complete_task');
      expect(calls[0]?.thoughtSignature).toBe('sig_fallback_array');
    });

    it('extractGeminiResponseParts extracts thoughts, texts, and thoughtSignatures', () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  thought: true,
                  text: 'Considering architecture...',
                  thoughtSignature: 'sig_thought_block_1',
                },
                {
                  text: 'Here is the preliminary answer.',
                },
              ],
            },
          },
        ],
      };

      const res = extractGeminiResponseParts(mockResponse);
      expect(res.thoughts).toEqual(['Considering architecture...']);
      expect(res.texts).toEqual(['Here is the preliminary answer.']);
      expect(res.thoughtSignatures).toEqual(['sig_thought_block_1']);
    });
  });

  describe('2. GeminiProvider contents payload construction and chunk streaming', () => {
    it('ensures GeminiProvider.streamChat strictly attaches thoughtSignature and thought_signature to functionCall parts in contents payload', async () => {
      const provider = new GeminiProvider({ apiKey: 'test-api-key' });

      let capturedContents: any = null;

      mockGenerateContent = vi.fn(async (params: any) => {
        capturedContents = params.contents;
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Finished task.',
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
        };
      });

      const historyMessages: LLMMessage[] = [
        {
          role: 'user',
          parts: [{ text: 'Activate skill code-review' }],
        },
        {
          role: 'model',
          parts: [
            {
              thought: true,
              text: 'Thinking: skill activation requested.',
            },
            {
              functionCall: {
                id: 'call_act_1',
                name: 'default_api:activate_skill',
                args: { name: 'code-review' },
                thought_signature: 'sig_encrypted_react_token_xyz',
              },
              thoughtSignature: 'sig_encrypted_react_token_xyz',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'call_act_1',
                name: 'default_api:activate_skill',
                response: { output: 'Skill loaded successfully.' },
              },
            },
          ],
        },
      ];

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of provider.streamChat({
        model: 'gemini-3.8-flash',
        messages: historyMessages,
      })) {
        chunks.push(chunk);
      }

      expect(capturedContents).toBeDefined();
      expect(capturedContents).toHaveLength(3);

      const modelTurn = capturedContents[1];
      expect(modelTurn.role).toBe('model');
      expect(modelTurn.parts).toHaveLength(2);

      const fcPart = modelTurn.parts[1];
      // Crucial requirement: part must contain thoughtSignature and thought_signature
      expect(fcPart.thoughtSignature).toBe('sig_encrypted_react_token_xyz');
      expect(fcPart.thought_signature).toBe('sig_encrypted_react_token_xyz');

      // Also functionCall must contain thoughtSignature and thought_signature
      expect(fcPart.functionCall.name).toBe('default_api:activate_skill');
      expect(fcPart.functionCall.thoughtSignature).toBe('sig_encrypted_react_token_xyz');
      expect(fcPart.functionCall.thought_signature).toBe('sig_encrypted_react_token_xyz');
    });

    it('preserves thoughtSignature in streaming mode via generateContentStream', async () => {
      const provider = new GeminiProvider({
        apiKey: 'test-api-key',
        useStreamingApi: true,
      });

      mockGenerateContentStream = vi.fn(async () => {
        return (async function* () {
          yield {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'call_stream_1',
                        name: 'read_file',
                        args: { path: 'README.md' },
                      },
                      thoughtSignature: 'sig_stream_part_abc',
                    },
                  ],
                },
              },
            ],
          };
          yield {
            usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 15 },
          };
        })();
      });

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of provider.streamChat({
        model: 'gemini-3.8-flash',
        messages: [{ role: 'user', parts: [{ text: 'Read README' }] }],
      })) {
        chunks.push(chunk);
      }

      const toolCallChunk = chunks.find((c) => c.type === 'tool_call');
      expect(toolCallChunk).toBeDefined();
      expect(toolCallChunk?.toolCall?.name).toBe('read_file');
      expect(toolCallChunk?.toolCall?.thoughtSignature).toBe('sig_stream_part_abc');
      expect(toolCallChunk?.toolCall?.thought_signature).toBe('sig_stream_part_abc');
    });

    it('preserves thought signature when signature arrives in thought chunk before tool call chunk in streaming', async () => {
      const provider = new GeminiProvider({
        apiKey: 'test-api-key',
        useStreamingApi: true,
      });

      mockGenerateContentStream = vi.fn(async () => {
        return (async function* () {
          // Chunk 1: Thought part with snake_case thought_signature
          yield {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'I will inspect the filesystem.',
                      thought: true,
                      thought_signature: 'sig_early_thought_chunk_999',
                    },
                  ],
                },
              },
            ],
          };
          // Chunk 2: Tool call part without thought signature
          yield {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'call_stream_early_sig',
                        name: 'default_api:activate_skill',
                        args: { name: 'git' },
                      },
                    },
                  ],
                },
              },
            ],
          };
          yield {
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
          };
        })();
      });

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of provider.streamChat({
        model: 'gemini-3.8-flash',
        messages: [{ role: 'user', parts: [{ text: 'Activate git' }] }],
      })) {
        chunks.push(chunk);
      }

      const toolCallChunk = chunks.find((c) => c.type === 'tool_call');
      expect(toolCallChunk).toBeDefined();
      expect(toolCallChunk?.toolCall?.name).toBe('default_api:activate_skill');
      expect(toolCallChunk?.toolCall?.thoughtSignature).toBe('sig_early_thought_chunk_999');
      expect(toolCallChunk?.toolCall?.thought_signature).toBe('sig_early_thought_chunk_999');
      expect(toolCallChunk?.thoughtSignature).toBe('sig_early_thought_chunk_999');
    });

    it('preserves thought signature when signature arrives in later chunk or candidate level', async () => {
      const provider = new GeminiProvider({
        apiKey: 'test-api-key',
        useStreamingApi: true,
      });

      mockGenerateContentStream = vi.fn(async () => {
        return (async function* () {
          // Chunk 1: Tool call without signature
          yield {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'call_stream_late',
                        name: 'run_command',
                        args: { command: 'ls' },
                      },
                    },
                  ],
                },
              },
            ],
          };
          // Chunk 2: Late chunk carrying candidate-level thought_signature
          yield {
            candidates: [
              {
                thought_signature: 'sig_late_candidate_777',
              },
            ],
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 },
          };
        })();
      });

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of provider.streamChat({
        model: 'gemini-3.8-flash',
        messages: [{ role: 'user', parts: [{ text: 'List files' }] }],
      })) {
        chunks.push(chunk);
      }

      const toolCallChunk = chunks.find((c) => c.type === 'tool_call');
      expect(toolCallChunk).toBeDefined();
      // Backfill should have attached the late signature to the tool call object
      expect(toolCallChunk?.toolCall?.thoughtSignature).toBe('sig_late_candidate_777');
      expect(toolCallChunk?.toolCall?.thought_signature).toBe('sig_late_candidate_777');
    });
  });

  describe('3. Multi-turn ReactAgent execution with GeminiProvider', () => {
    it('maintains thought_signature in model history turn when advancing to next turn in ReAct loop', async () => {
      let turn = 0;
      const capturedRequestsMessages: LLMMessage[][] = [];

      // A mock LLMProvider that simulates a 2-turn conversation:
      // Turn 1: Model issues a tool call (activate_skill) with thoughtSignature
      // Turn 2: Model completes the task
      const mockProvider = {
        id: 'gemini-test-provider',
        async *streamChat(request: any) {
          capturedRequestsMessages.push(JSON.parse(JSON.stringify(request.messages)));
          turn++;

          if (turn === 1) {
            yield { type: 'thought_delta', delta: 'I should activate code-review skill.' };
            yield {
              type: 'tool_call_delta',
              delta: '{"name":"code-review"}',
              toolCall: {
                id: 'call_act_turn1',
                name: 'activate_skill',
                args: { name: 'code-review' },
                thoughtSignature: 'enc_thought_sig_turn1_token',
                thought_signature: 'enc_thought_sig_turn1_token',
              },
            };
            yield {
              type: 'tool_call',
              toolCall: {
                id: 'call_act_turn1',
                name: 'activate_skill',
                args: { name: 'code-review' },
                thoughtSignature: 'enc_thought_sig_turn1_token',
                thought_signature: 'enc_thought_sig_turn1_token',
              },
            };
            yield { type: 'usage', usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 } };
            yield { type: 'done' };
          } else {
            yield { type: 'text_delta', delta: 'Task completed after skill activation.' };
            yield {
              type: 'tool_call',
              toolCall: {
                id: 'call_complete',
                name: 'complete_task',
                args: { summary: 'All done.' },
              },
            };
            yield { type: 'usage', usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 } };
            yield { type: 'done' };
          }
        },
      };

      const agent = new ReactAgent({
        provider: mockProvider,
        enableStreaming: true,
      });

      const sessionMessages: LLMMessage[] = [];
      const events = [];

      for await (const event of agent.execute('Review the repository', undefined, new VirtualFS(), {
        history: sessionMessages,
      })) {
        events.push(event);
      }

      // Check that 2 turns took place
      expect(turn).toBe(2);
      expect(capturedRequestsMessages).toHaveLength(2);

      // Verify Turn 2 request messages sent to the provider:
      const turn2Messages = capturedRequestsMessages[1]!;
      expect(turn2Messages.length).toBeGreaterThanOrEqual(3);

      // Message 1 is user prompt
      // Message 2 is model response containing the tool call
      const modelTurn = turn2Messages.find((m) => m.role === 'model');
      expect(modelTurn).toBeDefined();

      const functionCallPart = modelTurn?.parts.find((p) => p.functionCall);
      expect(functionCallPart).toBeDefined();

      // Crucial verification: both the part and the functionCall object have thoughtSignature!
      expect(functionCallPart?.thoughtSignature).toBe('enc_thought_sig_turn1_token');
      expect(functionCallPart?.thought_signature).toBe('enc_thought_sig_turn1_token');
      expect(functionCallPart?.functionCall?.thoughtSignature).toBe('enc_thought_sig_turn1_token');
      expect(functionCallPart?.functionCall?.thought_signature).toBe('enc_thought_sig_turn1_token');

      // Message 3 is tool result
      const toolTurn = turn2Messages.find((m) => m.role === 'user' && m.parts.some((p) => p.functionResponse));
      expect(toolTurn).toBeDefined();

      const completeEvent = events.find((e) => e.type === 'COMPLETE');
      expect(completeEvent).toBeDefined();
    });
  });

  describe('4. SubagentRunner thought signature preservation', () => {
    it('preserves thoughtSignature in subagent model history when executing tools', async () => {
      let capturedSubagentHistory: any[] = [];
      let turn = 0;

      const mockSubProvider = {
        id: 'subagent-test-provider',
        async *streamChat(request: any) {
          capturedSubagentHistory = JSON.parse(JSON.stringify(request.messages));
          turn++;
          if (turn === 1) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: 'sub_call_1',
                name: 'read_file',
                args: { path: 'src/main.ts' },
                thoughtSignature: 'subagent_signature_xyz',
                thought_signature: 'subagent_signature_xyz',
              },
            };
          } else {
            yield { type: 'text_delta', delta: 'Subagent completed inspection.' };
          }
        },
      };

      const runner = new SubagentRunner({
        provider: mockSubProvider,
        fs: new VirtualFS({ 'src/main.ts': 'export const app = 1;' }),
        toolRegistry: new ToolRegistry(),
      });

      const res = await runner.run('researcher', 'Inspect main.ts');
      expect(res).toContain('Subagent completed inspection');

      // On turn 2, captured history should contain model turn with signature
      const modelTurn = capturedSubagentHistory.find((m: any) => m.role === 'model');
      expect(modelTurn).toBeDefined();
      const fcPart = modelTurn.parts[0];
      expect(fcPart.thoughtSignature).toBe('subagent_signature_xyz');
      expect(fcPart.thought_signature).toBe('subagent_signature_xyz');
      expect(fcPart.functionCall.thoughtSignature).toBe('subagent_signature_xyz');
    });
  });

  describe('5. AgentSession persistence and Context Compaction', () => {
    it('preserves thought signatures when saving and restoring from session store', async () => {
      const session = new AgentSession();

      const originalMessages: LLMMessage[] = [
        {
          role: 'user',
          parts: [{ text: 'Hello' }],
        },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'call_save_1',
                name: 'activate_skill',
                args: { name: 'git' },
                thoughtSignature: 'persisted_sig_abc',
                thought_signature: 'persisted_sig_abc',
              },
              thoughtSignature: 'persisted_sig_abc',
              thought_signature: 'persisted_sig_abc',
            },
          ],
        },
      ];

      session.setMessages(originalMessages);
      await session.saveToStore();

      const newSession = new AgentSession({
        sessionId: session.sessionId,
        store: (session as any).store,
      });

      const restored = await newSession.restoreFromStore();
      expect(restored).toBe(true);

      const restoredMessages = newSession.getMessages();
      expect(restoredMessages).toHaveLength(2);
      const modelPart = restoredMessages[1]?.parts[0];
      expect(modelPart?.thoughtSignature).toBe('persisted_sig_abc');
      expect(modelPart?.thought_signature).toBe('persisted_sig_abc');
      expect(modelPart?.functionCall?.thoughtSignature).toBe('persisted_sig_abc');
    });

    it('LlmSummaryCompactionStrategy keeps functionCall and functionResponse pairs intact with signatures', async () => {
      const strategy = new LlmSummaryCompactionStrategy({
        keepRecentMessages: 2,
        triggerUtilization: 0.1,
      });

      const messages: LLMMessage[] = [
        { role: 'user', parts: [{ text: 'Step 1' }] },
        { role: 'model', parts: [{ text: 'Thinking step 1' }] },
        { role: 'user', parts: [{ text: 'Step 2' }] },
        { role: 'model', parts: [{ text: 'Thinking step 2' }] },
        // Model tool call with thought signature:
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'call_recent',
                name: 'activate_skill',
                args: { name: 'test' },
                thoughtSignature: 'compaction_preserved_sig',
              },
              thoughtSignature: 'compaction_preserved_sig',
            },
          ],
        },
        // Tool response:
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'call_recent',
                name: 'activate_skill',
                response: { output: 'ok' },
              },
            },
          ],
        },
      ];

      const res = await strategy.apply(messages, { force: true });
      expect(res.compacted).toBe(true);

      // Verify that the recent tool call + tool response pair was preserved together
      const recentModelCall = messages.find((m) => m.role === 'model' && m.parts.some((p) => p.functionCall));
      expect(recentModelCall).toBeDefined();
      expect(recentModelCall?.parts[0]?.thoughtSignature).toBe('compaction_preserved_sig');

      const recentToolResp = messages.find((m) => m.role === 'user' && m.parts.some((p) => p.functionResponse));
      expect(recentToolResp).toBeDefined();
    });

    it('normalizes snake_case and message-level fallback signature on AgentSession.setMessages', () => {
      const session = new AgentSession();
      session.setMessages([
        {
          role: 'model',
          parts: [
            {
              text: 'Thinking step',
              thought: true,
              thought_signature: 'sig_msg_level_456',
            },
            {
              functionCall: {
                name: 'activate_skill',
                args: { name: 'git' },
              },
            },
          ],
        },
      ]);

      const msgs = session.getMessages();
      expect(msgs).toHaveLength(1);
      const fcPart = msgs[0]?.parts[1];
      expect(fcPart?.thoughtSignature).toBe('sig_msg_level_456');
      expect(fcPart?.thought_signature).toBe('sig_msg_level_456');
      expect(fcPart?.functionCall?.thoughtSignature).toBe('sig_msg_level_456');
    });
  });

  describe('6. Direct ai.chats.create execution mode history normalization (Non-provider mode)', () => {
    it('normalizes chat.history in ReactAgent.execute so subsequent turns keep thoughtSignature', async () => {
      const mockHistory: any[] = [];
      const mockChatSendMessage = vi.fn(async ({ message }: any) => {
        if (typeof message === 'string') {
          // Turn 1 model response with snake_case thought_signature from API
          const modelTurn = {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'call_chat_1',
                  name: 'read_file',
                  args: { path: 'package.json' },
                },
                thought_signature: 'sig_chat_api_snake_123',
              },
            ],
          };
          mockHistory.push({ role: 'user', parts: [{ text: message }] });
          mockHistory.push(modelTurn);
          return {
            candidates: [
              {
                content: modelTurn,
                thought_signature: 'sig_chat_api_snake_123',
              },
            ],
            functionCalls: [
              {
                id: 'call_chat_1',
                name: 'read_file',
                args: { path: 'package.json' },
              },
            ],
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
          };
        } else {
          // Turn 2
          const finalTurn = {
            role: 'model',
            parts: [{ text: 'File read complete.' }],
          };
          mockHistory.push({ role: 'user', parts: message });
          mockHistory.push(finalTurn);
          return {
            candidates: [{ content: finalTurn }],
            text: 'File read complete.',
            usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 30 },
          };
        }
      });

      mockChatsCreate.mockReturnValue({
        history: mockHistory,
        sendMessage: mockChatSendMessage,
      });

      const fs = new VirtualFS({ 'package.json': '{"name":"test"}' });
      const registry = new ToolRegistry();
      const agent = new ReactAgent({
        apiKey: 'test-api-key',
        tools: registry,
      });

      const events: any[] = [];
      for await (const ev of agent.execute('Read package.json', undefined, fs)) {
        events.push(ev);
      }

      // Verify that chat.history model turn was normalized to have camelCase thoughtSignature
      const histModelTurn = mockHistory.find((m) => m.role === 'model' && m.parts[0]?.functionCall);
      expect(histModelTurn).toBeDefined();
      expect(histModelTurn.parts[0].thoughtSignature).toBe('sig_chat_api_snake_123');
      expect(histModelTurn.parts[0].thought_signature).toBe('sig_chat_api_snake_123');
      expect(histModelTurn.parts[0].functionCall.thoughtSignature).toBe('sig_chat_api_snake_123');
    });

    it('normalizes chat.history in SubagentRunner.run direct mode when API returns snake_case signatures', async () => {
      const mockSubHistory: any[] = [];
      const mockSubSendMessage = vi.fn(async ({ message }: any) => {
        if (typeof message === 'string') {
          const modelTurn = {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'call_sub_1',
                  name: 'read_file',
                  args: { path: 'index.ts' },
                },
                thought_signature: 'sig_sub_snake_888',
              },
            ],
          };
          mockSubHistory.push({ role: 'user', parts: [{ text: message }] });
          mockSubHistory.push(modelTurn);
          return {
            candidates: [
              {
                content: modelTurn,
                thought_signature: 'sig_sub_snake_888',
              },
            ],
            functionCalls: [
              {
                id: 'call_sub_1',
                name: 'read_file',
                args: { path: 'index.ts' },
              },
            ],
            usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 15 },
          };
        } else {
          const finalTurn = {
            role: 'model',
            parts: [{ text: 'Code inspection done.' }],
          };
          mockSubHistory.push({ role: 'user', parts: message });
          mockSubHistory.push(finalTurn);
          return {
            candidates: [{ content: finalTurn }],
            text: 'Code inspection done.',
            usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 },
          };
        }
      });

      mockChatsCreate.mockReturnValue({
        history: mockSubHistory,
        sendMessage: mockSubSendMessage,
      });

      const fs = new VirtualFS({ 'index.ts': 'export const x = 1;' });
      const registry = new ToolRegistry();
      const runner = new SubagentRunner({
        apiKey: 'test-api-key',
        fs,
        toolRegistry: registry,
      });

      const res = await runner.run('researcher', 'Inspect index.ts');
      expect(res).toContain('Code inspection done');

      const histModelTurn = mockSubHistory.find((m) => m.role === 'model' && m.parts[0]?.functionCall);
      expect(histModelTurn).toBeDefined();
      expect(histModelTurn.parts[0].thoughtSignature).toBe('sig_sub_snake_888');
      expect(histModelTurn.parts[0].thought_signature).toBe('sig_sub_snake_888');
      expect(histModelTurn.parts[0].functionCall.thoughtSignature).toBe('sig_sub_snake_888');
    });
  });
});
