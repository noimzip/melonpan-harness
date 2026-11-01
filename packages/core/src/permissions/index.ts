import {
  IPermissionPolicy,
  PermissionDecision,
  PermissionEvaluation,
  PermissionRequest,
  PermissionRiskLevel,
  ToolCategory,
  ToolExecutionResult,
  ToolMiddleware,
} from '../types.js';

/**
 * 破壊的なシェルコマンドパターン一覧 (ハードブロック対象)
 */
const DESTRUCTIVE_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(?:^|[;&|]\s*)(?:sudo\s+)?rm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*\s+-[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*[rR]|-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*[rR][a-zA-Z]*)\s+(?:\/|\*|--no-preserve-root|~)(?:\s|$)/,
    reason: 'Destructive root or home recursive deletion (rm -rf / or ~)',
  },
  {
    pattern: /(?:^|[;&|]\s*)(?:sudo\s+)?mkfs(?:\.[a-z0-9]+)?\b/i,
    reason: 'Filesystem formatting command (mkfs)',
  },
  {
    pattern: /(?:^|[;&|]\s*)(?:sudo\s+)?dd\s+.*?\bof=\/dev\/(?:sd[a-z]|nvme\d+n\d+|disk\d+|hd[a-z]|vd[a-z])/i,
    reason: 'Direct block device overwrite via dd',
  },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: 'Fork bomb detected',
  },
  {
    pattern: /(?:^|[;&|]\s*)(?:sudo\s+)?(?:shutdown|reboot|poweroff|halt|init\s+[06])\b/i,
    reason: 'System power/shutdown command',
  },
  {
    pattern: />\s*\/dev\/(?:sd[a-z]|nvme\d+n\d+|disk\d+)/i,
    reason: 'Redirecting output directly to raw disk device',
  },
];

/**
 * シェルコマンド文字列に破壊的パターンが含まれるか検査する
 */
export function detectDestructiveCommand(command: string): {
  isDestructive: boolean;
  reason?: string;
} {
  const normalized = command.trim();
  for (const item of DESTRUCTIVE_COMMAND_PATTERNS) {
    if (item.pattern.test(normalized)) {
      return { isDestructive: true, reason: item.reason };
    }
  }
  return { isDestructive: false };
}

/**
 * ファイルパスに危険なシステム領域やワークスペース外脱出が含まれるか検査する
 */
export function detectUnsafePath(filePath: string): {
  isUnsafe: boolean;
  reason?: string;
} {
  const normalized = filePath.replace(/\\/g, '/').trim();
  if (
    normalized.startsWith('/etc/') ||
    normalized.startsWith('/boot/') ||
    normalized.startsWith('/proc/') ||
    normalized.startsWith('/sys/') ||
    normalized.startsWith('/dev/') ||
    normalized === '/etc/passwd' ||
    normalized === '/etc/shadow'
  ) {
    return {
      isUnsafe: true,
      reason: `Access to protected system path "${filePath}" is prohibited`,
    };
  }
  return { isUnsafe: false };
}

/**
 * 1. SafetyGuardMiddleware: ポリシーに関わらず破壊的コマンドやシステム領域破壊を即座にハードブロックする (#23)
 */
export function createSafetyGuardMiddleware(): ToolMiddleware {
  return async ({ tool, args }, next): Promise<ToolExecutionResult> => {
    if (tool.name === 'run_command' && typeof args?.command === 'string') {
      const check = detectDestructiveCommand(args.command);
      if (check.isDestructive) {
        return {
          output: `[SafetyGuard Blocked]: Execution of command "${args.command}" was hard-blocked (${check.reason}).`,
          isError: true,
          metadata: {
            blockedBy: 'SafetyGuardMiddleware',
            reason: check.reason,
          },
        };
      }
    }

    if (
      (tool.name === 'write_file' || tool.name === 'edit_file' || tool.name === 'read_file') &&
      typeof args?.path === 'string'
    ) {
      const pathCheck = detectUnsafePath(args.path);
      if (pathCheck.isUnsafe) {
        return {
          output: `[SafetyGuard Blocked]: File operation on "${args.path}" was hard-blocked (${pathCheck.reason}).`,
          isError: true,
          metadata: {
            blockedBy: 'SafetyGuardMiddleware',
            reason: pathCheck.reason,
          },
        };
      }
    }

    return next();
  };
}

/**
 * すべての操作を自動許可するデフォルトポリシー (後方互換 / Auto-Allow モード用)
 */
export class AutoAllowPermissionPolicy implements IPermissionPolicy {
  evaluate(_req: PermissionRequest): PermissionEvaluation {
    return 'allow';
  }

  recordUserDecision(_req: PermissionRequest, _decision: PermissionDecision): void {
    // no-op
  }
}

export interface RuleBasedPermissionPolicyOptions {
  /** カテゴリ別のデフォルト評価 ('allow' | 'ask' | 'deny') */
  categoryRules?: Partial<Record<ToolCategory, PermissionEvaluation>>;
  /** ツール名別の明示的評価ルール */
  toolRules?: Record<string, PermissionEvaluation>;
}

/**
 * カテゴリおよびツール名・ユーザー承認履歴 (`always_allow`) に基づくプラガブル権限ポリシー (#23)
 */
export class RuleBasedPermissionPolicy implements IPermissionPolicy {
  private categoryRules: Record<ToolCategory, PermissionEvaluation>;
  private toolRules: Map<string, PermissionEvaluation>;
  private alwaysAllowedTools: Set<string> = new Set();
  private deniedTools: Set<string> = new Set();

  constructor(options: RuleBasedPermissionPolicyOptions = {}) {
    this.categoryRules = {
      read: 'allow',
      skill: 'allow',
      control: 'allow',
      subagent: 'allow',
      write: 'ask',
      execute: 'ask',
      network: 'ask',
      ...(options.categoryRules || {}),
    };
    this.toolRules = new Map(Object.entries(options.toolRules || {}));
  }

  setCategoryRule(category: ToolCategory, rule: PermissionEvaluation): void {
    this.categoryRules[category] = rule;
  }

  setToolRule(toolName: string, rule: PermissionEvaluation): void {
    this.toolRules.set(toolName, rule);
  }

  evaluate(req: PermissionRequest): PermissionEvaluation {
    // 破壊的コマンドは常に deny
    if (req.toolName === 'run_command' && typeof req.args?.command === 'string') {
      if (detectDestructiveCommand(req.args.command).isDestructive) {
        return 'deny';
      }
    }

    if (this.deniedTools.has(req.toolName)) {
      return 'deny';
    }
    if (this.alwaysAllowedTools.has(req.toolName)) {
      return 'allow';
    }
    if (this.toolRules.has(req.toolName)) {
      return this.toolRules.get(req.toolName)!;
    }
    return this.categoryRules[req.category] ?? 'allow';
  }

  recordUserDecision(req: PermissionRequest, decision: PermissionDecision): void {
    if (decision === 'always_allow') {
      this.alwaysAllowedTools.add(req.toolName);
      this.deniedTools.delete(req.toolName);
    }
  }

  getAlwaysAllowedTools(): string[] {
    return Array.from(this.alwaysAllowedTools);
  }
}

/**
 * 非同期の Permission 要求・応答ハンドシェイクを管理するコーディネーター (#23)
 * クライアント (TUI / WebUI / MobileUI) から `resolvePermission(requestId, decision)` が呼ばれるまで待機します。
 */
export class PermissionCoordinator {
  private pendingRequests: Map<
    string,
    {
      request: PermissionRequest;
      resolve: (decision: PermissionDecision) => void;
    }
  > = new Map();

  /**
   * 進行中の承認待ちリクエストを取得
   */
  getPendingRequests(): PermissionRequest[] {
    return Array.from(this.pendingRequests.values()).map((p) => p.request);
  }

  /**
   * クライアントへ承認を要求し、応答が返るか AbortSignal が発火するまで待機する
   */
  waitForDecision(
    request: PermissionRequest,
    signal?: AbortSignal
  ): Promise<PermissionDecision> {
    if (signal?.aborted) {
      return Promise.resolve('deny');
    }

    return new Promise<PermissionDecision>((resolve) => {
      const cleanup = () => {
        this.pendingRequests.delete(request.requestId);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        cleanup();
        resolve('deny');
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pendingRequests.set(request.requestId, {
        request,
        resolve: (decision: PermissionDecision) => {
          cleanup();
          resolve(decision);
        },
      });
    });
  }

  /**
   * クライアントからの応答 (`allow` / `always_allow` / `deny`) を解決する
   */
  resolvePermission(requestId: string, decision: PermissionDecision): boolean {
    const entry = this.pendingRequests.get(requestId);
    if (!entry) {
      return false;
    }
    entry.resolve(decision);
    return true;
  }
}

/**
 * 2. PermissionMiddleware: `IPermissionPolicy` に従って `allow` / `ask` / `deny` を判定し、
 * `ask` の場合は `PERMISSION_REQUESTED` イベントを発火して双方向応答を待機する (#23)
 */
export function createPermissionMiddleware(
  policy: IPermissionPolicy,
  coordinator?: PermissionCoordinator
): ToolMiddleware {
  let reqSeq = 0;

  return async ({ tool, args, executionContext }, next): Promise<ToolExecutionResult> => {
    reqSeq++;
    const requestId = `perm-${Date.now().toString(36)}-${reqSeq}`;
    const riskLevel: PermissionRiskLevel =
      tool.riskLevel ??
      (tool.category === 'execute'
        ? 'high'
        : tool.category === 'write'
          ? 'medium'
          : 'low');

    const permReq: PermissionRequest = {
      requestId,
      toolName: tool.name,
      category: tool.category,
      args: args || {},
      riskLevel,
      reason: `Tool "${tool.name}" (${tool.category}) requested execution.`,
    };

    const evaluation = await policy.evaluate(permReq);

    if (evaluation === 'allow') {
      return next();
    }

    if (evaluation === 'deny') {
      return {
        output: `Permission denied by policy for tool "${tool.name}".`,
        isError: true,
        metadata: {
          permissionDenied: true,
          requestId,
          toolName: tool.name,
        },
      };
    }

    // evaluation === 'ask'
    executionContext.emit({
      type: 'PERMISSION_REQUESTED',
      payload: {
        requestId: permReq.requestId,
        toolName: permReq.toolName,
        category: permReq.category,
        args: permReq.args,
        riskLevel: permReq.riskLevel,
        reason: permReq.reason,
      },
      timestamp: Date.now(),
    });

    let decision: PermissionDecision = 'deny';
    if (executionContext.requestPermission) {
      decision = await executionContext.requestPermission({
        toolName: permReq.toolName,
        category: permReq.category,
        args: permReq.args,
        riskLevel: permReq.riskLevel,
        reason: permReq.reason,
      });
    } else if (coordinator) {
      decision = await coordinator.waitForDecision(permReq, executionContext.signal);
    }

    policy.recordUserDecision(permReq, decision);

    executionContext.emit({
      type: 'PERMISSION_RESOLVED',
      payload: {
        requestId: permReq.requestId,
        toolName: permReq.toolName,
        decision,
      },
      timestamp: Date.now(),
    });

    if (decision === 'deny') {
      return {
        output: `User denied permission to execute tool "${tool.name}".`,
        isError: true,
        metadata: {
          permissionDenied: true,
          requestId,
          decision,
        },
      };
    }

    return next();
  };
}
