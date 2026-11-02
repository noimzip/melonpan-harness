import { ToolExecutionResult, ToolMiddleware } from '../types.js';

export interface QualityGateIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  line?: number;
}

export interface QualityGateReport {
  filePath: string;
  passed: boolean;
  score: number;
  issues: QualityGateIssue[];
  summary: string;
}

/**
 * 行番号算出ヘルパー (1-indexed)
 */
function findLineNumber(content: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Issue #59: Zero-Token Deterministic Quality Gate for HTML5 Canvas games and web artifacts
 *
 * LLM トークンを一切消費せず、数百マイクロ秒の決定論的静的解析によって HTML5 Canvas 2D ゲームや
 * Web 成果物の構文エラー・60fps 描画ボトルネック・モバイル入力欠落・デザイン規約違反を自動検証します。
 */
export function inspectHtmlGameQuality(
  content: string,
  filePath: string = 'index.html'
): QualityGateReport {
  const issues: QualityGateIssue[] = [];
  const lower = content.toLowerCase();
  const isCanvasGame = lower.includes('<canvas') || lower.includes('getcontext(');

  // 1. HTML 基本構造チェック
  if (!lower.includes('<!doctype html>')) {
    issues.push({
      code: 'MISSING_DOCTYPE',
      severity: 'warning',
      message: 'Missing <!DOCTYPE html> declaration.',
      line: 1,
    });
  }

  // 2. インライン <script> ブロックの JS 構文検証 (0 トークン構文チェック)
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  let hasInlineScript = false;

  while ((scriptMatch = scriptRegex.exec(content)) !== null) {
    const scriptBody = scriptMatch[1] ?? '';
    if (!scriptBody.trim()) continue;
    hasInlineScript = true;

    const scriptStartLine = findLineNumber(content, scriptMatch.index);
    try {
      // Top-level ES module syntax (import/export) を簡易正規化して new Function で構文検査
      const sanitizedForCheck = scriptBody
        .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
        .replace(/^\s*export\s+(default\s+)?/gm, '');
      new Function(sanitizedForCheck);
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      issues.push({
        code: 'JS_SYNTAX_ERROR',
        severity: 'error',
        message: `JavaScript syntax error in <script> starting near L${scriptStartLine}: ${errMsg}`,
        line: scriptStartLine,
      });
    }
  }

  // 3. Canvas ゲーム固有の品質・パフォーマンス・UX チェック
  if (isCanvasGame && hasInlineScript) {
    // 3a. requestAnimationFrame ゲームループ存在確認
    if (!content.includes('requestAnimationFrame')) {
      issues.push({
        code: 'MISSING_RAF_LOOP',
        severity: 'warning',
        message: 'Canvas game is missing requestAnimationFrame loop for smooth 60fps rendering.',
      });
    }

    // 3b. ctx.save() / ctx.restore() バランスチェック
    const saveMatches = content.match(/\.\s*save\s*\(\s*\)/g) ?? [];
    const restoreMatches = content.match(/\.\s*restore\s*\(\s*\)/g) ?? [];
    if (saveMatches.length !== restoreMatches.length) {
      issues.push({
        code: 'UNBALANCED_CTX_SAVE_RESTORE',
        severity: 'warning',
        message: `Unbalanced Canvas context state: ${saveMatches.length} ctx.save() vs ${restoreMatches.length} ctx.restore() calls.`,
      });
    }

    // 3c. ctx.shadowBlur リセット漏れチェック (60fps 維持に直結)
    const shadowNonZero = content.match(/shadowBlur\s*=\s*[1-9]\d*/g) ?? [];
    const shadowReset = content.match(/shadowBlur\s*=\s*0\b/g) ?? [];
    if (shadowNonZero.length > 0 && shadowReset.length === 0 && restoreMatches.length === 0) {
      const firstShadowIdx = content.search(/shadowBlur\s*=\s*[1-9]\d*/);
      issues.push({
        code: 'SHADOW_BLUR_NOT_RESET',
        severity: 'warning',
        message:
          'shadowBlur is set to >0 without resetting shadowBlur = 0 or using ctx.restore(), causing severe 60fps frame drops.',
        line: findLineNumber(content, firstShadowIdx),
      });
    }

    // 3d. レスポンシブ & マルチ入力（キーボード + マウス/タッチ）チェック
    const hasKeyboard =
      content.includes('keydown') || content.includes('keyup') || content.includes('onkeydown');
    const hasPointerOrTouch =
      content.includes('pointerdown') ||
      content.includes('touchstart') ||
      content.includes('mousedown') ||
      content.includes('mousemove') ||
      content.includes('click');
    if (!hasKeyboard && !hasPointerOrTouch) {
      issues.push({
        code: 'MISSING_INPUT_HANDLERS',
        severity: 'warning',
        message: 'No keyboard, pointer, or touch input event listeners detected.',
      });
    }

    // 3e. Orbitron / Glassmorphism (backdrop-filter) チェック
    const hasOrbitron = lower.includes('orbitron');
    const hasBackdropFilter = lower.includes('backdrop-filter');
    if (!hasOrbitron || !hasBackdropFilter) {
      issues.push({
        code: 'CYBER_NEON_STYLE_MISSING',
        severity: 'warning',
        message: `Missing Cyber-Neon HUD styling (${!hasOrbitron ? 'Orbitron font' : ''}${!hasOrbitron && !hasBackdropFilter ? ', ' : ''}${!hasBackdropFilter ? 'backdrop-filter glassmorphism' : ''}).`,
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const passed = errorCount === 0;
  const score = Math.max(0, 100 - errorCount * 35 - warningCount * 10);

  let summary = '';
  if (issues.length === 0) {
    summary = `[QUALITY_GATE: PASS (100/100)] "${filePath}" verified (JS syntax OK, 60fps Canvas & Cyber-Neon checks passed).`;
  } else {
    const compactItems = issues
      .slice(0, 4)
      .map((i) => `${i.severity.toUpperCase()}[${i.code}]${i.line ? `@L${i.line}` : ''}: ${i.message}`)
      .join(' | ');
    summary = `[QUALITY_GATE: ${passed ? 'PASS_WITH_WARNINGS' : 'FAIL'} (${score}/100)] ${compactItems}`;
  }

  return {
    filePath,
    passed,
    score,
    issues,
    summary,
  };
}

export interface QualityGateMiddlewareOptions {
  /** 検査対象のファイル拡張子 (デフォルト: ['.html', '.htm']) */
  extensions?: string[];
  /** ツール出力末尾に 1 行の Quality Gate サマリーを自動付与するか (デフォルト: true) */
  appendSummaryToOutput?: boolean;
}

/**
 * Issue #59: `write_file` / `edit_file` 実行直後に 0 トークン静的品質検査を自動実行するミドルウェア
 */
export function createQualityGateMiddleware(
  options: QualityGateMiddlewareOptions = {}
): ToolMiddleware {
  const extensions = options.extensions ?? ['.html', '.htm'];
  const appendSummary = options.appendSummaryToOutput ?? true;

  return async (ctx, next): Promise<ToolExecutionResult> => {
    const res = await next();
    const toolName = ctx.tool.name;

    if ((toolName !== 'write_file' && toolName !== 'edit_file') || res.isError) {
      return res;
    }

    const filePath = String(ctx.args?.path || 'index.html');
    const lowerPath = filePath.toLowerCase();
    if (!extensions.some((ext) => lowerPath.endsWith(ext))) {
      return res;
    }

    const content = await ctx.executionContext.fs.readFile(filePath);
    if (typeof content !== 'string' || content.length === 0) {
      return res;
    }

    const report = inspectHtmlGameQuality(content, filePath);
    const updatedMetadata = {
      ...(res.metadata || {}),
      qualityGate: report,
    };

    // 構文エラーまたは重大警告がある場合、または appendSummary 有効時に 1 行サマリーを付与
    const updatedOutput =
      appendSummary && (!report.passed || report.issues.length > 0)
        ? `${res.output}\n${report.summary}`
        : res.output;

    return {
      ...res,
      output: updatedOutput,
      metadata: updatedMetadata,
    };
  };
}
