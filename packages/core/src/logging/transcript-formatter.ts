import { AgentEvent } from '../types.js';

/**
 * タイムスタンプ（ミリ秒）を ISO 形式およびローカル時刻文字列にフォーマット
 */
export function formatTimestamp(timestamp?: number): string {
  const date = timestamp ? new Date(timestamp) : new Date();
  return date.toISOString();
}

export function formatTimeShort(timestamp?: number): string {
  const date = timestamp ? new Date(timestamp) : new Date();
  return date.toTimeString().split(' ')[0] + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

/**
 * イベントを単一の人間可読なテキストブロックにフォーマット
 */
export function formatEventAsText(event: AgentEvent): string {
  const timeStr = formatTimeShort(event.timestamp);
  const type = event.type;
  const payload = event.payload;

  switch (type) {
    case 'SKILL_INDEXED':
      return `[${timeStr}] [SKILL_INDEXED] Indexed ${payload?.count ?? 0} skills`;

    case 'SKILL_LOADED':
      return `[${timeStr}] [SKILL_LOADED] Loaded skill: ${payload?.name ?? 'unknown'}`;

    case 'PLAN_STARTED':
      return `[${timeStr}] [PLAN_STARTED] Planning phase started`;

    case 'PLAN_CREATED':
      return `[${timeStr}] [PLAN_CREATED] Plan generated:\n${payload?.plan ? payload.plan.split('\n').map((l: string) => '  ' + l).join('\n') : ''}`;

    case 'THOUGHT':
      return `[${timeStr}] [THOUGHT]\n  ${String(payload?.thought || '').replace(/\n/g, '\n  ')}`;

    case 'TOOL_CALL': {
      const argsStr = payload?.args ? JSON.stringify(payload.args, null, 2) : '{}';
      return `[${timeStr}] [TOOL_CALL] ${payload?.name ?? 'unknown'} (callId: ${payload?.callId ?? 'none'})\n  Arguments: ${argsStr.replace(/\n/g, '\n  ')}`;
    }

    case 'TOOL_RESULT': {
      const status = payload?.isError ? 'ERROR' : 'SUCCESS';
      const output = String(payload?.output || '');
      const preview = output.length > 500 ? output.slice(0, 500) + `... [Truncated total ${output.length} chars]` : output;
      return `[${timeStr}] [TOOL_RESULT] ${payload?.name ?? 'unknown'} (${status} - ${output.length} chars)\n  Output: ${preview.replace(/\n/g, '\n  ')}`;
    }

    case 'FILE_CHANGED':
      return `[${timeStr}] [FILE_CHANGED] ${payload?.action ?? 'write'} -> ${payload?.path ?? ''} (${payload?.content?.length ?? 0} chars)`;

    case 'PERMISSION_REQUESTED':
      return `[${timeStr}] [PERMISSION_REQUESTED] Tool: ${payload?.toolName} (category: ${payload?.category})\n  Reason: ${payload?.reason ?? ''}`;

    case 'PERMISSION_RESOLVED':
      return `[${timeStr}] [PERMISSION_RESOLVED] Tool: ${payload?.toolName} -> Decision: ${payload?.decision}`;

    case 'SUBAGENT_DISPATCHED':
      return `[${timeStr}] [SUBAGENT_DISPATCHED] ${payload?.agentType} (SubagentId: ${payload?.subagentId})\n  Task: ${payload?.taskPrompt ?? ''}`;

    case 'SUBAGENT_COMPLETED':
      return `[${timeStr}] [SUBAGENT_COMPLETED] ${payload?.agentType} (Verdict: ${payload?.verdict ?? 'PASS'})\n  Report: ${String(payload?.result || '').slice(0, 300)}...`;

    case 'CONTEXT_COMPACTED':
      return `[${timeStr}] [CONTEXT_COMPACTED] Strategy: ${payload?.strategyId} | Saved: ${payload?.savedTokens ?? 0} tokens (${payload?.savedCharsCount ?? 0} chars)\n  Summary: ${payload?.summary ?? ''}`;

    case 'USAGE': {
      const billedIn = payload?.billedPromptTokens ?? payload?.promptTokens ?? 0;
      const cached = payload?.cachedPromptTokens ?? 0;
      const out = payload?.completionTokens ?? 0;
      const total = payload?.totalTokens ?? (billedIn + out);
      const cost = payload?.cost;
      const costStr = cost
        ? ` | Cost: $${cost.totalCostUsd.toFixed(4)} (約 ¥${cost.totalCostJpy.toFixed(1)})`
        : '';
      const savedStr = cost && cost.savedCostUsd > 0
        ? ` | Saved: -$${cost.savedCostUsd.toFixed(4)}`
        : '';
      return `[${timeStr}] [USAGE] Turn ${payload?.turn ?? 1} | In: ${billedIn.toLocaleString()} (Cached: ${cached.toLocaleString()}) | Out: ${out.toLocaleString()} | Total: ${total.toLocaleString()}${costStr}${savedStr}`;
    }

    case 'COMPLETE': {
      const cost = payload?.usage?.cost;
      const costStr = cost ? ` | Total Cost: $${cost.totalCostUsd.toFixed(4)} (約 ¥${cost.totalCostJpy.toFixed(1)})` : '';
      return `[${timeStr}] [COMPLETE] Finished in ${payload?.turns ?? 0} turns (${payload?.durationMs ?? 0}ms)${costStr}\n  Summary: ${payload?.summary ?? 'Task completed'}`;
    }

    case 'ERROR':
      return `[${timeStr}] [ERROR] ${payload?.message ?? 'Unknown error'}\n  Details: ${payload?.details ? JSON.stringify(payload.details) : ''}`;

    default:
      // Delta events (THOUGHT_DELTA, TEXT_DELTA, TOOL_CALL_DELTA) are skipped in summarized text log
      return '';
  }
}

/**
 * 複数イベントから人間が読みやすい Markdown トランスクリプトを生成
 */
export function formatTranscriptMarkdown(params: {
  sessionId: string;
  model: string;
  mode?: string;
  prompt?: string;
  events: AgentEvent[];
}): string {
  const { sessionId, model, mode = 'auto', prompt = '', events } = params;
  const startTime = events.length > 0 ? formatTimestamp(events[0]?.timestamp) : formatTimestamp();
  const endTime = events.length > 0 ? formatTimestamp(events[events.length - 1]?.timestamp) : formatTimestamp();

  const lines: string[] = [
    `# Melonpan Agent Execution Transcript`,
    ``,
    `- **Session ID**: \`${sessionId}\``,
    `- **Model**: \`${model}\``,
    `- **Mode**: \`${mode}\``,
    `- **Start Time**: \`${startTime}\``,
    `- **End Time**: \`${endTime}\``,
    `- **User Prompt**: ${prompt ? `\n> ${prompt.replace(/\n/g, '\n> ')}` : '*(none)*'}`,
    ``,
    `---`,
    `## Execution Timeline`,
    ``,
  ];

  for (const ev of events) {
    const formatted = formatEventAsText(ev);
    if (formatted) {
      lines.push(formatted);
      lines.push('');
    }
  }

  // 最終サマリー・課金情報の抽出
  const usageEvents = events.filter((e) => e.type === 'USAGE');
  const lastUsage = usageEvents[usageEvents.length - 1]?.payload;
  const completeEvent = events.find((e) => e.type === 'COMPLETE')?.payload;

  lines.push('---');
  lines.push('## Session Summary');
  if (lastUsage) {
    lines.push(`- **Billed Input Tokens**: ${(lastUsage.billedPromptTokens ?? lastUsage.promptTokens ?? 0).toLocaleString()}`);
    lines.push(`- **Cached Input Tokens**: ${(lastUsage.cachedPromptTokens ?? 0).toLocaleString()}`);
    lines.push(`- **Output Tokens**: ${(lastUsage.completionTokens ?? 0).toLocaleString()}`);
    lines.push(`- **Total Tokens**: ${(lastUsage.totalTokens ?? 0).toLocaleString()}`);
    if (lastUsage.cost) {
      lines.push(`- **Estimated Cost**: **$${lastUsage.cost.totalCostUsd.toFixed(4)} USD** (約 **¥${lastUsage.cost.totalCostJpy.toFixed(1)} JPY**)`);
      if (lastUsage.cost.savedCostUsd > 0) {
        lines.push(`- **Cache Savings**: -$${lastUsage.cost.savedCostUsd.toFixed(4)} USD (約 ¥${lastUsage.cost.savedCostJpy.toFixed(1)} JPY)`);
      }
    }
  }
  if (completeEvent) {
    lines.push(`- **Total Turns**: ${completeEvent.turns ?? 0}`);
    lines.push(`- **Duration**: ${completeEvent.durationMs ?? 0} ms`);
    lines.push(`- **Final Status**: ${completeEvent.aborted ? 'Aborted' : 'Success'}`);
  }

  return lines.join('\n');
}

/**
 * 複数イベントから 1行1JSON の JSONL 文字列を生成
 */
export function formatTranscriptJsonl(events: AgentEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}
