import { describe, it, expect } from 'vitest';
import { Type } from '@google/genai';
import {
  ToolRegistry,
  createBuiltinTools,
  MockCommandExecutor,
  NodeCommandExecutor,
  MockWebProvider,
  htmlToCleanText,
  PromptComposer,
  RoleSection,
  AgentEventBus,
  serializeError,
  VirtualFS,
  SkillManager,
  SubagentRunner,
  ITool,
  AgentEvent,
} from '../src/index.js';

describe('Core-M1: ToolRegistry, Exploration/Shell/Web Tools, PromptComposer & AgentEventBus', () => {
  describe('1. ToolRegistry & Pluggable ITool (#50)', () => {
    it('registers builtin tools, supports custom plugins, and creates scoped registries', async () => {
      const registry = new ToolRegistry(createBuiltinTools());
      const names = registry.getToolNames();

      expect(names).toContain('write_file');
      expect(names).toContain('edit_file');
      expect(names).toContain('read_file');
      expect(names).toContain('list_files');
      expect(names).toContain('grep_search');
      expect(names).toContain('run_command');
      expect(names).toContain('web_search');
      expect(names).toContain('fetch_url');
      expect(names).toContain('activate_skill');
      expect(names).toContain('dispatch_subagent');
      expect(names).toContain('complete_task');

      // Custom plugin registration
      const customTool: ITool<{ msg: string }> = {
        name: 'custom_echo',
        category: 'read',
        declaration: {
          name: 'custom_echo',
          description: 'Echoes a message',
          parameters: {
            type: Type.OBJECT,
            properties: { msg: { type: Type.STRING } },
            required: ['msg'],
          },
        },
        async execute(args) {
          return { output: `ECHO: ${args.msg}`, metadata: { echoed: args.msg } };
        },
      };

      registry.register(customTool);
      expect(registry.has('custom_echo')).toBe(true);

      const vfs = new VirtualFS();
      const res = await registry.execute(
        'custom_echo',
        { msg: 'hello modular world' },
        { fs: vfs, emit: () => {} }
      );
      expect(res.output).toBe('ECHO: hello modular world');
      expect(res.metadata?.echoed).toBe('hello modular world');

      // Scoped registry (readonly excludes write/execute)
      const readonlyScope = registry.createScopedRegistry({ readonly: true });
      expect(readonlyScope.has('read_file')).toBe(true);
      expect(readonlyScope.has('grep_search')).toBe(true);
      expect(readonlyScope.has('write_file')).toBe(false);
      expect(readonlyScope.has('edit_file')).toBe(false);
      expect(readonlyScope.has('run_command')).toBe(false);

      // Scoped registry with explicit allowedTools
      const explicitScope = registry.createScopedRegistry({
        allowedTools: ['read_file', 'web_search'],
      });
      expect(explicitScope.getToolNames()).toEqual(['read_file', 'web_search']);
    });
  });

  describe('2. File Exploration Tools: read_file, list_files, grep_search (#21)', () => {
    it('executes read_file with line ranges, list_files with globs, and grep_search with regex', async () => {
      const registry = new ToolRegistry(createBuiltinTools());
      const vfs = new VirtualFS();
      const emitted: AgentEvent[] = [];

      await registry.execute(
        'write_file',
        {
          path: 'src/engine.ts',
          content: [
            'export class PhysicsEngine {',
            '  private gravity = 9.81;',
            '  update(dt: number) {',
            '    return this.gravity * dt;',
            '  }',
            '}',
          ].join('\n'),
        },
        { fs: vfs, emit: (e) => emitted.push(e) }
      );

      expect(emitted.some((e) => e.type === 'FILE_CHANGED')).toBe(true);

      // read_file with range
      const readRes = await registry.execute(
        'read_file',
        { path: 'src/engine.ts', start_line: 2, end_line: 4 },
        { fs: vfs, emit: () => {} }
      );
      expect(readRes.isError).toBeFalsy();
      expect(readRes.output).toContain('2:   private gravity = 9.81;');
      expect(readRes.output).toContain('4:     return this.gravity * dt;');
      expect(readRes.metadata).toMatchObject({
        path: 'src/engine.ts',
        startLine: 2,
        endLine: 4,
        totalLines: 6,
      });

      // list_files
      await vfs.writeFile('README.md', '# Readme');
      const listRes = await registry.execute(
        'list_files',
        { pattern: '*.ts' },
        { fs: vfs, emit: () => {} }
      );
      expect(listRes.output).toBe('src/engine.ts');
      expect(listRes.metadata?.count).toBe(1);

      // grep_search
      const grepRes = await registry.execute(
        'grep_search',
        { query: 'gravity.*dt', is_regex: true },
        { fs: vfs, emit: () => {} }
      );
      expect(grepRes.output).toContain('src/engine.ts:4:     return this.gravity * dt;');
      expect(grepRes.metadata?.matchCount).toBe(1);
    });
  });

  describe('3. Command Executor & Web Provider Tools (#22)', () => {
    it('executes run_command with MockCommandExecutor and NodeCommandExecutor (including AbortSignal)', async () => {
      const registry = new ToolRegistry(createBuiltinTools());
      const vfs = new VirtualFS();
      const mockExec = new MockCommandExecutor();
      mockExec.registerResponse('pnpm test', {
        stdout: 'All 42 tests passed',
        stderr: '',
        exitCode: 0,
        durationMs: 12,
      });

      const cmdRes = await registry.execute(
        'run_command',
        { command: 'pnpm test' },
        { fs: vfs, commandExecutor: mockExec, emit: () => {} }
      );
      expect(cmdRes.isError).toBe(false);
      expect(cmdRes.output).toContain('All 42 tests passed');
      expect(cmdRes.metadata?.exitCode).toBe(0);

      // Real NodeCommandExecutor echo & abort test
      const nodeExec = new NodeCommandExecutor();
      const realRes = await nodeExec.execute('echo "melonpan-shell-ok"');
      expect(realRes.exitCode).toBe(0);
      expect(realRes.stdout.trim()).toBe('melonpan-shell-ok');

      const abortController = new AbortController();
      abortController.abort();
      const abortedRes = await nodeExec.execute('sleep 5', {
        signal: abortController.signal,
      });
      expect(abortedRes.aborted).toBe(true);
    });

    it('executes web_search and fetch_url via IWebProvider and cleans HTML', async () => {
      const registry = new ToolRegistry(createBuiltinTools());
      const vfs = new VirtualFS();
      const mockWeb = new MockWebProvider();
      mockWeb.registerSearchResults('canvas 2d glow', [
        {
          title: 'MDN Canvas shadowBlur',
          url: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/shadowBlur',
          snippet: 'The shadowBlur property specifies the amount of blur applied to shadows.',
        },
      ]);
      mockWeb.registerPage(
        'https://example.com/guide',
        '<html><head><title>Guide Title</title><script>alert(1)</script></head><body><h1>Main Heading</h1><p>Clean paragraph.</p></body></html>'
      );

      const searchRes = await registry.execute(
        'web_search',
        { query: 'canvas 2d glow' },
        { fs: vfs, webProvider: mockWeb, emit: () => {} }
      );
      expect(searchRes.output).toContain('MDN Canvas shadowBlur');
      expect(searchRes.metadata?.count).toBe(1);

      const fetchRes = await registry.execute(
        'fetch_url',
        { url: 'https://example.com/guide' },
        { fs: vfs, webProvider: mockWeb, emit: () => {} }
      );
      expect(fetchRes.output).toContain('# Guide Title');
      expect(fetchRes.output).toContain('# Main Heading');
      expect(fetchRes.output).toContain('Clean paragraph.');
      expect(fetchRes.output).not.toContain('alert(1)');
    });
  });

  describe('4. Modular PromptComposer (#51, #14)', () => {
    it('composes domain-agnostic system prompt with priority-ordered sections and reconciled subagent rules', () => {
      const composer = new PromptComposer();
      const prompt = composer.compose({
        mode: 'auto',
        availableTools: createBuiltinTools(),
        availableSkills: [
          {
            name: 'game-generator',
            description: 'Generates HTML5 Canvas games',
            skillDir: 'skills/game-generator',
            filePath: 'skills/game-generator/SKILL.md',
            frontmatter: { name: 'game-generator', description: 'Generates HTML5 Canvas games' },
          },
        ],
        workspaceRoot: '/workspace/demo',
      });

      expect(prompt).toContain('autonomous software engineer');
      expect(prompt).toContain('YOUR WORKSPACE TOOLS:');
      expect(prompt).toContain('NEVER paste full code files into task_prompt');
      expect(prompt).toContain('OPERATIONAL MODE: [AUTO MODE');
      expect(prompt).toContain('AVAILABLE AGENT SKILLS CATALOG');
      expect(prompt).toContain('/workspace/demo');

      // Custom section override
      composer.addSection(new RoleSection('You are a specialized security auditor.'));
      const customPrompt = composer.compose({ mode: 'plan' });
      expect(customPrompt).toContain('You are a specialized security auditor.');
      expect(customPrompt).toContain('OPERATIONAL MODE: [PLAN MODE]');
    });
  });

  describe('5. AgentEventBus & Serializable Protocol (#52, #53)', () => {
    it('assigns monotonic seq numbers, normalizes Error objects for JSON serialization, and replays events since lastSeq', () => {
      const bus = new AgentEventBus({ sessionId: 'sess-test-1' });
      const received: AgentEvent[] = [];
      const unsubscribe = bus.subscribe((e) => received.push(e));

      bus.emit({
        type: 'THOUGHT',
        payload: { thought: 'Step 1' },
        timestamp: Date.now(),
      });
      bus.emit({
        type: 'ERROR',
        payload: {
          error: new Error('Network failure'),
          phase: 'react_loop',
        },
        timestamp: Date.now(),
      });
      bus.emit({
        type: 'THOUGHT',
        payload: { thought: 'Step 3' },
        timestamp: Date.now(),
      });

      unsubscribe();

      expect(received).toHaveLength(3);
      expect(received[0]!.seq).toBe(1);
      expect(received[1]!.seq).toBe(2);
      expect(received[2]!.seq).toBe(3);
      expect(received[0]!.sessionId).toBe('sess-test-1');

      // Replay since seq 1
      const replayed = bus.getSerializableEventsSince(1);
      expect(replayed).toHaveLength(2);
      expect(replayed[0]!.seq).toBe(2);
      expect(replayed[0]!.type).toBe('ERROR');

      // Verify JSON.stringify roundtrip preserves error message
      const jsonStr = JSON.stringify(replayed[0]);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.payload.serializedError.message).toBe('Network failure');
    });
  });
});
