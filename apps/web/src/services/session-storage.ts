import { Session, Message } from '../types';
import { estimateMessagesTokens, resolveModelContextWindow } from '@melonpan/core';

const STORAGE_KEY = 'melonpan_web_sessions_v1';
const ACTIVE_SESSION_ID_KEY = 'melonpan_active_session_id_v1';

export function createInitialSession(
  name = '新しいゲーム開発',
  initialModel = 'gemini-3.8-flash'
): Session {
  const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  return {
    id,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: 'auto',
    messages: [
      {
        id: 'msg_welcome',
        role: 'assistant',
        content:
          '今日はどんな一日だった？ うれしいことも、ちょっと疲れたことも、ゆっくり聞かせてね。\n\n melonpan-harness へようこそ！作りたいHTML5 Canvasゲームや追加したい機能、ボス戦、サウンド演出など何でも教えてください。',
        timestamp: Date.now(),
      },
    ],
    files: {},
    activeFile: '',
    subagents: [],
    events: [],
    metrics: {
      billedInputTokens: 0,
      billedOutputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      contextWindowLimit: resolveModelContextWindow(initialModel),
      currentContextTokens: estimateMessagesTokens([
        {
          role: 'assistant',
          content:
            '今日はどんな一日だった？ うれしいことも、ちょっと疲れたことも、ゆっくり聞かせてね。\n\n melonpan-harness へようこそ！作りたいHTML5 Canvasゲームや追加したい機能、ボス戦、サウンド演出など何でも教えてください。',
        },
      ]),
      prunedChars: 0,
      compactionCount: 0,
      compactionLogs: [],
      estimatedCostUsd: 0,
      estimatedCostJpy: 0,
      savedCostUsd: 0,
      savedCostJpy: 0,
      activeModel: initialModel,
    },
  };
}

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = createInitialSession('はじめてのメロンパンゲーム');
      saveSessions([initial]);
      setActiveSessionId(initial.id);
      return [initial];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const initial = createInitialSession('はじめてのメロンパンゲーム');
      saveSessions([initial]);
      return [initial];
    }
    return parsed.map((s: Session) => {
      const activeModel = s.metrics?.activeModel || 'gemini-3.8-flash';
      const resolvedLimit = resolveModelContextWindow(activeModel);
      return {
        ...s,
        metrics: {
          ...s.metrics,
          activeModel,
          contextWindowLimit:
            s.metrics?.contextWindowLimit && s.metrics.contextWindowLimit !== 128000
              ? s.metrics.contextWindowLimit
              : resolvedLimit,
        },
      };
    });
  } catch {
    const initial = createInitialSession('はじめてのメロンパンゲーム');
    return [initial];
  }
}

export function saveSessions(sessions: Session[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.error('Failed to save sessions to localStorage:', err);
  }
}

export function getActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_ID_KEY);
}

export function setActiveSessionId(id: string): void {
  localStorage.setItem(ACTIVE_SESSION_ID_KEY, id);
}
