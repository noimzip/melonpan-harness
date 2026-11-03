import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  formatEventAsText,
  formatTranscriptMarkdown,
  formatTranscriptJsonl,
  FileSessionLogger,
} from '../src/logging/index.js';
import { AgentEvent } from '../src/types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

describe('TranscriptFormatter & FileSessionLogger', () => {
  const sampleEvents: AgentEvent[] = [
    {
      type: 'THOUGHT',
      payload: { thought: 'アーキテクチャ設計中...' },
      timestamp: 1730600000000,
    },
    {
      type: 'TOOL_CALL',
      payload: {
        name: 'read_file',
        args: { path: 'index.html' },
        callId: 'call_1',
      },
      timestamp: 1730600001000,
    },
    {
      type: 'TOOL_RESULT',
      payload: {
        name: 'read_file',
        output: '<html><body>Game</body></html>',
        isError: false,
      },
      timestamp: 1730600001500,
    },
    {
      type: 'USAGE',
      payload: {
        promptTokens: 1000,
        billedPromptTokens: 800,
        cachedPromptTokens: 200,
        completionTokens: 150,
        totalTokens: 950,
        turn: 1,
        cost: {
          inputCostUsd: 0.00008,
          outputCostUsd: 0.00006,
          cachedCostUsd: 0.000005,
          totalCostUsd: 0.00014,
          totalCostJpy: 0.022,
          savedCostUsd: 0.000015,
          savedCostJpy: 0.002,
        },
      },
      timestamp: 1730600002000,
    },
    {
      type: 'COMPLETE',
      payload: {
        summary: 'タスク完了しました',
        turns: 1,
        durationMs: 2000,
        aborted: false,
      },
      timestamp: 1730600002500,
    },
  ];

  it('formatEventAsText formats various AgentEvent types accurately', () => {
    const thoughtText = formatEventAsText(sampleEvents[0]!);
    expect(thoughtText).toContain('[THOUGHT]');
    expect(thoughtText).toContain('アーキテクチャ設計中...');

    const toolCallText = formatEventAsText(sampleEvents[1]!);
    expect(toolCallText).toContain('[TOOL_CALL] read_file');
    expect(toolCallText).toContain('index.html');

    const usageText = formatEventAsText(sampleEvents[3]!);
    expect(usageText).toContain('[USAGE]');
    expect(usageText).toContain('Cost: $0.0001');
    expect(usageText).toContain('約 ¥0.0');
  });

  it('formatTranscriptMarkdown outputs complete structured session markdown', () => {
    const md = formatTranscriptMarkdown({
      sessionId: 'sess_12345',
      model: 'gemini-3.8-flash',
      mode: 'auto',
      prompt: 'インベーダーゲームを作って',
      events: sampleEvents,
    });

    expect(md).toContain('# Melonpan Agent Execution Transcript');
    expect(md).toContain('`sess_12345`');
    expect(md).toContain('インベーダーゲームを作って');
    expect(md).toContain('## Execution Timeline');
    expect(md).toContain('## Session Summary');
    expect(md).toContain('$0.0001 USD');
    expect(md).toContain('タスク完了');
  });

  it('formatTranscriptJsonl outputs valid newline-delimited JSON', () => {
    const jsonl = formatTranscriptJsonl(sampleEvents);
    const lines = jsonl.trim().split('\n');
    expect(lines.length).toBe(sampleEvents.length);
    const parsed0 = JSON.parse(lines[0]!);
    expect(parsed0.type).toBe('THOUGHT');
    expect(parsed0.payload.thought).toBe('アーキテクチャ設計中...');
  });

  describe('FileSessionLogger', () => {
    const testDir = path.resolve('.tmp-test-logging-' + Date.now());

    afterEach(async () => {
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch {}
    });

    it('creates .log and .jsonl files and updates latest.log upon finish', async () => {
      const logger = new FileSessionLogger({
        sessionId: 'test_session_xyz',
        model: 'gemini-3.8-flash',
        mode: 'act',
        prompt: 'テトリス作成',
        storageDir: testDir,
      });

      await logger.init();
      for (const ev of sampleEvents) {
        await logger.appendEvent(ev);
      }
      const { logFilePath, jsonlFilePath } = await logger.finish();

      expect(logFilePath).toBeDefined();
      expect(jsonlFilePath).toBeDefined();

      const logContent = await fs.readFile(logFilePath!, 'utf-8');
      expect(logContent).toContain('Melonpan Agent Execution Transcript');
      expect(logContent).toContain('テトリス作成');
      expect(logContent).toContain('read_file');

      const jsonlContent = await fs.readFile(jsonlFilePath!, 'utf-8');
      const lines = jsonlContent.trim().split('\n');
      expect(lines.length).toBe(sampleEvents.length);

      // Verify latest.log exists
      const latestLog = path.resolve(testDir, 'latest.log');
      const latestContent = await fs.readFile(latestLog, 'utf-8');
      expect(latestContent).toBe(logContent);
    });
  });
});
