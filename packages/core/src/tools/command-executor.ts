import {
  CommandExecuteOptions,
  CommandExecutionResult,
  ICommandExecutor,
} from '../types.js';

export interface NodeCommandExecutorOptions {
  defaultCwd?: string;
  defaultTimeoutMs?: number;
  maxOutputChars?: number;
}

/**
 * 長大な出力テキストのヘッドとテールを保持して中央をトランケートするヘルパー
 */
export function truncateHeadTail(
  text: string,
  maxChars: number = 12000
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  const half = Math.floor(maxChars / 2);
  const head = text.slice(0, half);
  const tail = text.slice(text.length - half);
  const omitted = text.length - maxChars;
  return {
    text: `${head}\n... [${omitted} chars truncated] ...\n${tail}`,
    truncated: true,
  };
}

/**
 * Node.js child_process.spawn ベースのコマンド実行アダプター (Issue #22)
 * - `AbortSignal` による即時プロセス終了 (SIGTERM -> SIGKILL)
 * - タイムアウト制御
 * - 長大ログのヘッド・テール保持トランケート
 */
export class NodeCommandExecutor implements ICommandExecutor {
  private defaultCwd: string;
  private defaultTimeoutMs: number;
  private maxOutputChars: number;

  constructor(options: NodeCommandExecutorOptions = {}) {
    const proc = (globalThis as any).process;
    this.defaultCwd = options.defaultCwd || (proc?.cwd ? proc.cwd() : '.');
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;
    this.maxOutputChars = options.maxOutputChars ?? 12000;
  }

  async execute(
    command: string,
    options: CommandExecuteOptions = {}
  ): Promise<CommandExecutionResult> {
    const startTime = Date.now();
    const { spawn } = await import('node:child_process');
    const proc = (globalThis as any).process;

    const cwd = options.cwd || this.defaultCwd;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const signal = options.signal;

    if (signal?.aborted) {
      return {
        command,
        stdout: '',
        stderr: 'Command execution aborted before start.',
        exitCode: null,
        durationMs: 0,
        aborted: true,
      };
    }

    return new Promise<CommandExecutionResult>((resolve) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        env: { ...(proc?.env || {}), ...(options.env || {}) },
      });

      let stdoutRaw = '';
      let stderrRaw = '';
      let timedOut = false;
      let aborted = false;
      let settled = false;

      const terminateChild = () => {
        try {
          child.kill('SIGTERM');
          setTimeout(() => {
            try {
              if (!child.killed) {
                child.kill('SIGKILL');
              }
            } catch {
              // ignore
            }
          }, 250);
        } catch {
          // ignore
        }
      };

      const onAbort = () => {
        aborted = true;
        terminateChild();
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              terminateChild();
            }, timeoutMs)
          : undefined;

      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdoutRaw += chunk.toString();
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderrRaw += chunk.toString();
      });

      const finish = (exitCode: number | null, errMessage?: string) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);

        if (errMessage) {
          stderrRaw = stderrRaw ? `${stderrRaw}\n${errMessage}` : errMessage;
        }

        const outTrunc = truncateHeadTail(stdoutRaw, this.maxOutputChars);
        const errTrunc = truncateHeadTail(stderrRaw, this.maxOutputChars);

        resolve({
          command,
          stdout: outTrunc.text,
          stderr: errTrunc.text,
          exitCode,
          durationMs: Date.now() - startTime,
          timedOut: timedOut || undefined,
          aborted: aborted || undefined,
          truncated: outTrunc.truncated || errTrunc.truncated || undefined,
        });
      };

      child.on('error', (err: Error) => {
        finish(1, err.message);
      });

      child.on('close', (code: number | null) => {
        finish(code);
      });
    });
  }
}

export type MockCommandHandler = (
  command: string,
  options?: CommandExecuteOptions
) => Partial<CommandExecutionResult> | Promise<Partial<CommandExecutionResult>>;

/**
 * テストおよびブラウザサンドボックス用のモックコマンド実行アダプター (Issue #22)
 */
export class MockCommandExecutor implements ICommandExecutor {
  private handler?: MockCommandHandler;
  private cannedResponses: Map<string, Partial<CommandExecutionResult>> = new Map();

  constructor(handler?: MockCommandHandler) {
    this.handler = handler;
  }

  registerResponse(commandPattern: string, response: Partial<CommandExecutionResult>): void {
    this.cannedResponses.set(commandPattern, response);
  }

  async execute(
    command: string,
    options?: CommandExecuteOptions
  ): Promise<CommandExecutionResult> {
    if (options?.signal?.aborted) {
      return {
        command,
        stdout: '',
        stderr: 'Aborted',
        exitCode: null,
        durationMs: 0,
        aborted: true,
      };
    }

    if (this.handler) {
      const res = await this.handler(command, options);
      return {
        command,
        stdout: res.stdout ?? '',
        stderr: res.stderr ?? '',
        exitCode: res.exitCode ?? 0,
        durationMs: res.durationMs ?? 5,
        timedOut: res.timedOut,
        aborted: res.aborted,
        truncated: res.truncated,
      };
    }

    for (const [pattern, res] of this.cannedResponses.entries()) {
      if (command === pattern || command.includes(pattern)) {
        return {
          command,
          stdout: res.stdout ?? '',
          stderr: res.stderr ?? '',
          exitCode: res.exitCode ?? 0,
          durationMs: res.durationMs ?? 5,
          timedOut: res.timedOut,
          aborted: res.aborted,
          truncated: res.truncated,
        };
      }
    }

    return {
      command,
      stdout: `[Simulated Command Output]: ${command}`,
      stderr: '',
      exitCode: 0,
      durationMs: 5,
    };
  }
}
