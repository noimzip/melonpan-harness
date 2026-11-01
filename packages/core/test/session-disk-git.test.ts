import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  GitService,
  AgentSession,
  LocalDiskFS,
  ReactAgent,
  createBuiltinTools,
  ToolRegistry,
  MelonpanCore,
} from '../src/index.js';

describe('Session Dedicated Disk Directory, Git Tracking, & Goal Mode Subagent Gate', () => {
  const testWorkspaceBase = path.resolve(process.cwd(), '.tmp-test-sessions');

  beforeEach(async () => {
    await fs.mkdir(testWorkspaceBase, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testWorkspaceBase, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('1. GitService Unit Tests', () => {
    it('initializes a git repository with .gitignore and initial commit', async () => {
      const repoDir = path.join(testWorkspaceBase, 'test-repo-1');
      await GitService.initSessionRepo(repoDir);

      const gitDirExists = await fs
        .access(path.join(repoDir, '.git'))
        .then(() => true)
        .catch(() => false);
      expect(gitDirExists).toBe(true);

      const gitignoreContent = await fs.readFile(
        path.join(repoDir, '.gitignore'),
        'utf-8'
      );
      expect(gitignoreContent).toContain('node_modules/');

      const history = await GitService.getCommitHistory(repoDir);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].message).toContain('chore: session initialized');
    });

    it('commits modifications and captures working tree diffs', async () => {
      const repoDir = path.join(testWorkspaceBase, 'test-repo-2');
      await GitService.initSessionRepo(repoDir);

      // Create a file
      await fs.writeFile(path.join(repoDir, 'index.html'), '<h1>Melonpan</h1>', 'utf-8');

      const commitHash = await GitService.commitChange(repoDir, 'feat: create index.html');
      expect(commitHash).toBeTruthy();

      const history = await GitService.getCommitHistory(repoDir);
      expect(history[0].hash).toBe(commitHash);
      expect(history[0].message).toBe('feat: create index.html');

      // Update file
      await fs.writeFile(path.join(repoDir, 'index.html'), '<h1>Melonpan Cyber</h1>', 'utf-8');
      const diff = await GitService.getDiff(repoDir);
      expect(diff).toContain('-<h1>Melonpan</h1>');
      expect(diff).toContain('+<h1>Melonpan Cyber</h1>');

      const secondCommit = await GitService.commitChange(repoDir, 'feat: update title');
      expect(secondCommit).toBeTruthy();
      expect(secondCommit).not.toBe(commitHash);
    });

    it('returns null when committing with clean working tree', async () => {
      const repoDir = path.join(testWorkspaceBase, 'test-repo-3');
      await GitService.initSessionRepo(repoDir);

      const noChangeCommit = await GitService.commitChange(repoDir, 'nothing');
      expect(noChangeCommit).toBeNull();
    });
  });

  describe('2. AgentSession Disk Directory & Git Repository Integration', () => {
    it('creates dedicated session directory and initializes git tracking on session creation', async () => {
      const sessionDir = path.join(testWorkspaceBase, 'agent-session-test');
      const session = new AgentSession({
        workspaceDir: sessionDir,
        enableGit: true,
      });

      expect(session.workspaceDir).toBe(sessionDir);
      const snapshot = session.getStateSnapshot();
      expect(snapshot.workspaceDir).toBe(sessionDir);

      // Give GitService a moment to finish async init
      await new Promise((r) => setTimeout(r, 100));

      const gitDirExists = await fs
        .access(path.join(sessionDir, '.git'))
        .then(() => true)
        .catch(() => false);
      expect(gitDirExists).toBe(true);
    });
  });

  describe('3. Subagent Availability Control (Standard Act & Audit vs Goal Mode)', () => {
    it('disables dispatch_subagent in standard mode (mode: act) and instructs primary execution', async () => {
      const agent = new ReactAgent({
        mode: 'act',
      });

      // Verify that function declarations exclude dispatch_subagent
      const functionDecls = (agent as any).getAvailableFunctionDeclarations();
      expect(functionDecls.some((d: any) => d.name === 'dispatch_subagent')).toBe(false);

      // If called directly via registry, verify standard mode block message
      const tools = createBuiltinTools();
      const dispatchTool = tools.find((t) => t.name === 'dispatch_subagent')!;
      const result = await dispatchTool.execute(
        { agent_type: 'researcher', task_prompt: 'Investigate physics' },
        { fs: new LocalDiskFS({ rootDir: testWorkspaceBase }), mode: 'act', emit: () => {} } as any
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain('Notice: Subagents are disabled in standard mode');
      expect(result.output).toContain('/goal');
    });

    it('enables dispatch_subagent in goal mode (mode: goal)', async () => {
      const agent = new ReactAgent({
        mode: 'goal',
      });

      // Verify that function declarations include dispatch_subagent
      const functionDecls = (agent as any).getAvailableFunctionDeclarations();
      expect(functionDecls.some((d: any) => d.name === 'dispatch_subagent')).toBe(true);
    });
  });

  describe('4. Browser Environment Compatibility (process.cwd undefined)', () => {
    it('initializes AgentSession and MelonpanCore without throwing when process.cwd is undefined', () => {
      const originalCwd = process.cwd;
      try {
        // Simulate browser environment where process.cwd is not a function
        (process as any).cwd = undefined;

        expect(() => {
          const session = new AgentSession();
          expect(session).toBeDefined();
          expect(session.sessionId).toBeTruthy();
        }).not.toThrow();

        expect(() => {
          const core = new MelonpanCore({
            simulate: true,
          });
          expect(core).toBeDefined();
        }).not.toThrow();
      } finally {
        process.cwd = originalCwd;
      }
    });
  });
});
