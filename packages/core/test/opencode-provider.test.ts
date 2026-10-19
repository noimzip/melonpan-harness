import { describe, it, expect, vi } from 'vitest';
import {
  OpenCodeProvider,
  OpenCodeProviderSession,
  OPENCODE_TOOLS,
  ReactAgent,
  MelonpanCore,
} from '../src/index.js';

describe('OpenCode Inference API Provider', () => {
  describe('1. OpenAI Function Calling Tools Specification', () => {
    it('defines all 4 required ReAct tools in OpenAI format', () => {
      const toolNames = OPENCODE_TOOLS.map((t) => t.function.name);
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('edit_file');
      expect(toolNames).toContain('dispatch_subagent');
      expect(toolNames).toContain('complete_task');

      const writeFileTool = OPENCODE_TOOLS.find((t) => t.function.name === 'write_file');
      expect(writeFileTool?.type).toBe('function');
      expect(writeFileTool?.function.parameters?.type).toBe('object');
      expect(writeFileTool?.function.parameters?.required).toEqual(['path', 'content']);
    });
  });

  describe('2. OpenCodeProviderSession & Model Prefix Normalization', () => {
    it('strips "opencode/" prefix when instantiating session', () => {
      const provider = new OpenCodeProvider({ apiKey: 'test-key' });
      const session = provider.createSession({
        model: 'opencode/beam-free',
        systemInstruction: 'You are an arcade engineer.',
      }) as OpenCodeProviderSession;

      expect((session as any).model).toBe('beam-free');
      expect(session.getMessages()).toEqual([
        { role: 'system', content: 'You are an arcade engineer.' },
      ]);
    });

    it('retains non-prefixed model names as-is', () => {
      const provider = new OpenCodeProvider({ apiKey: 'test-key' });
      const session = provider.createSession({
        model: 'deepseek-v4.1-flash-free',
        systemInstruction: 'System message',
      }) as OpenCodeProviderSession;

      expect((session as any).model).toBe('deepseek-v4.1-flash-free');
    });
  });

  describe('3. Context Pruning for OpenCode Messages', () => {
    it('masks large write_file content in tool_calls to prevent token inflation', () => {
      const provider = new OpenCodeProvider({ apiKey: 'test-key' });
      const session = provider.createSession({
        model: 'opencode/beam-free',
        systemInstruction: 'System message',
      }) as OpenCodeProviderSession;

      const largeContent = 'console.log("arcade code");\n'.repeat(25);
      expect(largeContent.length).toBeGreaterThan(400);

      const messages = session.getMessages();
      messages.push({
        role: 'assistant',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'index.html',
                content: largeContent,
              }),
            },
          },
        ],
      });

      const pruneResult = session.pruneHistory(200);
      expect(pruneResult.prunedCallsCount).toBe(1);
      expect(pruneResult.savedCharsCount).toBeGreaterThan(0);

      const updatedArgs = JSON.parse(messages[1].tool_calls[0].function.arguments);
      expect(updatedArgs.content).toBe(`<Content preserved in VFS: ${largeContent.length} chars>`);
    });

    it('does not mask small write_file contents (< threshold)', () => {
      const provider = new OpenCodeProvider({ apiKey: 'test-key' });
      const session = provider.createSession({
        model: 'opencode/beam-free',
        systemInstruction: 'System message',
      }) as OpenCodeProviderSession;

      const shortContent = 'let a = 1;';
      const messages = session.getMessages();
      messages.push({
        role: 'assistant',
        tool_calls: [
          {
            id: 'call-2',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: 'test.js',
                content: shortContent,
              }),
            },
          },
        ],
      });

      const pruneResult = session.pruneHistory(200);
      expect(pruneResult.prunedCallsCount).toBe(0);

      const parsedArgs = JSON.parse(messages[1].tool_calls[0].function.arguments);
      expect(parsedArgs.content).toBe(shortContent);
    });
  });

  describe('4. Multi-Provider Integration in ReactAgent & MelonpanCore', () => {
    it('runs simulation with OpenCode model and yields proper events', async () => {
      const agent = new ReactAgent({
        model: 'opencode/beam-free',
        simulate: true,
      });

      expect((agent as any).model).toBe('opencode/beam-free');
      expect((agent as any).simulate).toBe(true);

      const core = new MelonpanCore({
        model: 'opencode/deepseek-v4.1-flash-free',
        simulate: true,
      });

      let completeEvent: any = null;
      for await (const event of core.run('Build space shooter with OpenCode')) {
        if (event.type === 'COMPLETE') {
          completeEvent = event;
        }
      }

      expect(completeEvent).toBeDefined();
      expect(completeEvent.payload.files['index.html']).toBeDefined();
      expect(completeEvent.payload.usage.totalTokens).toBeGreaterThan(0);
    });
  });
});
