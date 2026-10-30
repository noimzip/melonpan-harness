import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  ToolRegistry,
  createBuiltinTools,
  MockCommandExecutor,
  createSafetyGuardMiddleware,
  createPermissionMiddleware,
  RuleBasedPermissionPolicy,
  PermissionCoordinator,
  SkillManager,
  InMemorySkillLoader,
  FileSystemSkillLoader,
  SubagentRunner,
  inferCodeFenceLanguage,
  VirtualFS,
  AgentEvent,
  ILLMProvider,
} from '../src/index.js';

describe('Core-M2: ToolMiddleware, IPermissionPolicy, ISkillLoader & Clean-Room SubagentSpawner', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const coreDir = path.resolve(path.dirname(currentFile), '..');
  const skillsDir = path.resolve(coreDir, 'skills');
  const agentsDir = path.resolve(coreDir, 'agents');

  describe('1. ToolMiddleware & IPermissionPolicy Engine (#23)', () => {
    it('hard-blocks destructive commands and protected system paths via SafetyGuardMiddleware', async () => {
      const registry = new ToolRegistry(createBuiltinTools(), [
        createSafetyGuardMiddleware(),
      ]);
      const vfs = new VirtualFS();
      const mockExec = new MockCommandExecutor();

      const rmRes = await registry.execute(
        'run_command',
        { command: 'rm -rf /' },
        { fs: vfs, commandExecutor: mockExec, emit: () => {} }
      );
      expect(rmRes.isError).toBe(true);
      expect(rmRes.output).toContain('[SafetyGuard Blocked]');

      const sysRes = await registry.execute(
        'write_file',
        { path: '/etc/passwd', content: 'hacked' },
        { fs: vfs, emit: () => {} }
      );
      expect(sysRes.isError).toBe(true);
      expect(sysRes.output).toContain('[SafetyGuard Blocked]');
    });

    it('handles interactive ask/allow/always_allow/deny permission handshake via PermissionCoordinator', async () => {
      const policy = new RuleBasedPermissionPolicy({
        categoryRules: {
          read: 'allow',
          write: 'ask',
          execute: 'ask',
        },
      });
      const coordinator = new PermissionCoordinator();
      const registry = new ToolRegistry(createBuiltinTools(), [
        createSafetyGuardMiddleware(),
        createPermissionMiddleware(policy, coordinator),
      ]);
      const vfs = new VirtualFS();
      const events: AgentEvent[] = [];

      // 1. Read tool is auto-allowed without prompting
      await vfs.writeFile('readme.txt', 'hello');
      const readRes = await registry.execute(
        'read_file',
        { path: 'readme.txt' },
        { fs: vfs, emit: (e) => events.push(e) }
      );
      expect(readRes.isError).toBeFalsy();
      expect(events.filter((e) => e.type === 'PERMISSION_REQUESTED')).toHaveLength(0);

      // 2. Write tool triggers PERMISSION_REQUESTED -> user responds with 'always_allow'
      const writePromise = registry.execute(
        'write_file',
        { path: 'out.txt', content: 'approved content' },
        {
          fs: vfs,
          emit: (e) => {
            events.push(e);
            if (e.type === 'PERMISSION_REQUESTED') {
              setTimeout(() => {
                coordinator.resolvePermission(e.payload.requestId, 'always_allow');
              }, 5);
            }
          },
        }
      );

      const writeRes = await writePromise;
      expect(writeRes.isError).toBeFalsy();
      expect(vfs.readFile('out.txt')).toBe('approved content');
      expect(events.some((e) => e.type === 'PERMISSION_REQUESTED')).toBe(true);
      expect(events.some((e) => e.type === 'PERMISSION_RESOLVED')).toBe(true);

      // 3. Subsequent write_file call is auto-allowed because 'always_allow' was recorded
      const eventsBeforeSecondWrite = events.length;
      const writeRes2 = await registry.execute(
        'write_file',
        { path: 'out2.txt', content: 'second write' },
        { fs: vfs, emit: (e) => events.push(e) }
      );
      expect(writeRes2.isError).toBeFalsy();
      const newPermRequests = events
        .slice(eventsBeforeSecondWrite)
        .filter((e) => e.type === 'PERMISSION_REQUESTED');
      expect(newPermRequests).toHaveLength(0);

      // 4. Execute tool denied by user
      const execPromise = registry.execute(
        'run_command',
        { command: 'echo hi' },
        {
          fs: vfs,
          commandExecutor: new MockCommandExecutor(),
          emit: (e) => {
            if (e.type === 'PERMISSION_REQUESTED') {
              setTimeout(() => {
                coordinator.resolvePermission(e.payload.requestId, 'deny');
              }, 5);
            }
          },
        }
      );
      const execRes = await execPromise;
      expect(execRes.isError).toBe(true);
      expect(execRes.output).toContain('User denied permission');
    });

    it('streams PERMISSION_REQUESTED live during MelonpanCore.run without deadlocking and resumes on core.resolvePermission (#23)', async () => {
      const { MelonpanCore, SimulatedProvider } = await import('../src/index.js');
      const policy = new RuleBasedPermissionPolicy({
        categoryRules: { write: 'ask' },
      });

      const simProvider = new SimulatedProvider([
        () => [
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-perm-1',
              name: 'write_file',
              args: { path: 'approved.txt', content: 'live-approved' },
            },
          },
          { type: 'done' },
        ],
        () => [
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-perm-2',
              name: 'complete_task',
              args: { summary: 'Done after live permission' },
            },
          },
          { type: 'done' },
        ],
      ]);

      const core = new MelonpanCore({
        provider: simProvider,
        permissionPolicy: policy,
      });

      const collected: AgentEvent[] = [];
      for await (const ev of core.run('Write approved.txt')) {
        collected.push(ev);
        if (ev.type === 'PERMISSION_REQUESTED') {
          // Resolve immediately while iterating core.run()
          core.resolvePermission(ev.payload.requestId, 'allow');
        }
      }

      expect(collected.some((e) => e.type === 'PERMISSION_REQUESTED')).toBe(true);
      expect(collected.some((e) => e.type === 'PERMISSION_RESOLVED')).toBe(true);
      expect(core.getVirtualFiles()['approved.txt']).toBe('live-approved');
    });
  });

  describe('2. ISkillLoader, Generalized Skill Matching & activate_skill Tool (#24, #15)', () => {
    it('does NOT force-fallback to game-generator for unrelated general coding prompts (#15)', async () => {
      const sm = new SkillManager({ skillsDir });
      await sm.loadAllMetadata();

      // Unrelated prompt should return undefined so General Autonomous Agent mode activates
      const unrelated = await sm.resolveAndLoad('Write a Python script to sort a CSV file');
      expect(unrelated).toBeUndefined();

      // Game-related prompt should still resolve game-generator
      const gameRelated = await sm.resolveAndLoad('Create an HTML5 Canvas breakout game');
      expect(gameRelated?.name).toBe('game-generator');
    });

    it('supports InMemorySkillLoader, FileSystemSkillLoader, and dynamic activate_skill tool execution (#24)', async () => {
      const inMemLoader = new InMemorySkillLoader();
      inMemLoader.registerSkill(
        'api-architect',
        `---
name: api-architect
description: Designs REST and GraphQL schemas with OpenAPI specifications.
allowed-tools: read_file, write_file
---
# API Architect Instructions
Always include OpenAPI 3.1 schemas.`
      );

      const sm = new SkillManager({ loader: inMemLoader });
      const registry = new ToolRegistry(createBuiltinTools());
      const vfs = new VirtualFS();
      const events: AgentEvent[] = [];

      const actRes = await registry.execute(
        'activate_skill',
        { name: 'api-architect' },
        { fs: vfs, skillManager: sm, emit: (e) => events.push(e) }
      );

      expect(actRes.isError).toBeFalsy();
      expect(actRes.output).toContain('# API Architect Instructions');
      expect(actRes.metadata?.allowedTools).toEqual(['read_file', 'write_file']);

      const loadedEvent = events.find((e) => e.type === 'SKILL_LOADED');
      expect(loadedEvent).toBeDefined();
      expect(loadedEvent?.payload.name).toBe('api-architect');
    });
  });

  describe('3. SubagentRunner / ISubagentSpawner Upgrades (#12, #13, #25)', () => {
    it('dynamically infers code fence language tags from file extension and content (#12)', async () => {
      expect(inferCodeFenceLanguage('plan.md', '# Plan')).toBe('markdown');
      expect(inferCodeFenceLanguage('src/index.ts', 'export const x = 1;')).toBe('typescript');
      expect(inferCodeFenceLanguage('index.html', '<!DOCTYPE html>')).toBe('html');
      expect(inferCodeFenceLanguage('package.json', '{}')).toBe('json');

      const vfs = new VirtualFS();
      vfs.writeFile('plan.md', '# Architecture Plan\n- Step 1');
      vfs.writeFile('index.html', '<html></html>');

      const runner = new SubagentRunner({ agentsDir, fs: vfs, simulate: true });
      const formatted = await runner.buildPromptWithFileContext('Review the plan', {
        filePath: 'plan.md',
      });

      expect(formatted).toContain('[Target File Content (plan.md)]:');
      expect(formatted).toContain('```markdown\n# Architecture Plan\n- Step 1\n```');
      expect(formatted).not.toContain('```html');
    });

    it('passes explicit file_path or files in dispatch_subagent even when index.html exists (#13)', async () => {
      const vfs = new VirtualFS();
      vfs.writeFile('index.html', '<!DOCTYPE html><html>Game</html>');
      vfs.writeFile('plan.md', '# Detailed Technical Plan');

      let capturedFilePath: string | undefined;
      const runner = new SubagentRunner({ agentsDir, fs: vfs, simulate: true });
      const origSpawn = runner.spawn.bind(runner);
      runner.spawn = async (opts) => {
        capturedFilePath = opts.filePath;
        return origSpawn(opts);
      };

      const registry = new ToolRegistry(createBuiltinTools());
      const events: AgentEvent[] = [];

      await registry.execute(
        'dispatch_subagent',
        {
          agent_type: 'code-reviewer',
          task_prompt: 'Review plan.md completeness',
          file_path: 'plan.md',
        },
        {
          fs: vfs,
          subagentSpawner: runner,
          callId: 'call-parent-1',
          emit: (e) => events.push(e),
        }
      );

      expect(capturedFilePath).toBe('plan.md');
      // Hierarchical event forwarding check (#25)
      const childThought = events.find(
        (e) => e.type === 'THOUGHT' && e.parentCallId === 'call-parent-1'
      );
      expect(childThought).toBeDefined();
      expect(childThought?.subagentId).toContain('sub-code-reviewer');
    });

    it('scopes tools per agent definition (researcher, code-reviewer, coder) and executes multi-turn Clean-Room ReAct loop (#25)', async () => {
      const vfs = new VirtualFS();
      vfs.writeFile('src/math.ts', 'export const add = (a: number, b: number) => a + b;');

      // Custom mock LLM provider driving a 2-turn subagent tool call loop
      let turn = 0;
      const mockProvider: ILLMProvider = {
        id: 'mock-subagent-llm',
        async *streamChat() {
          turn++;
          if (turn === 1) {
            yield {
              type: 'thought_delta',
              delta: 'Reading src/math.ts first...',
            };
            yield {
              type: 'tool_call',
              toolCall: {
                id: 'sub-tc-1',
                name: 'read_file',
                args: { path: 'src/math.ts' },
              },
            };
            yield {
              type: 'usage',
              usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
            };
          } else {
            yield {
              type: 'text_delta',
              delta: 'Verified add function in src/math.ts.',
            };
            yield {
              type: 'usage',
              usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
            };
          }
        },
      };

      const runner = new SubagentRunner({
        agentsDir,
        fs: vfs,
        provider: mockProvider,
      });

      const researcherScope = await runner.getScopedToolRegistry('researcher');
      expect(researcherScope.has('read_file')).toBe(true);
      expect(researcherScope.has('write_file')).toBe(false);

      const coderScope = await runner.getScopedToolRegistry('coder');
      expect(coderScope.has('write_file')).toBe(true);
      expect(coderScope.has('edit_file')).toBe(true);

      const forwardedEvents: AgentEvent[] = [];
      const spawnRes = await runner.spawn({
        agentType: 'researcher',
        taskPrompt: 'Inspect src/math.ts',
        parentCallId: 'parent-call-99',
        onEvent: (ev) => forwardedEvents.push(ev),
      });

      expect(spawnRes.turns).toBe(2);
      expect(spawnRes.output).toBe('Verified add function in src/math.ts.');
      expect(spawnRes.usage?.totalTokens).toBe(180);

      expect(forwardedEvents.some((e) => e.type === 'TOOL_CALL' && e.payload.name === 'read_file')).toBe(true);
      expect(forwardedEvents.every((e) => e.parentCallId === 'parent-call-99')).toBe(true);
    });
  });
});
