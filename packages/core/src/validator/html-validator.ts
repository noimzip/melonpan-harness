import { HtmlValidatorInterface, ValidationResult } from '../types.js';

/**
 * 生成されたHTML/JSの簡易構文検証・抽出・サニタイザー
 * DOM環境に依存せず、Pure TypeScript + Web標準で動作します。
 */
export class HtmlValidator implements HtmlValidatorInterface {
  /**
   * マークダウンのコードブロックや余分な解説文から純粋なHTMLコードを抽出する
   */
  extractHtml(raw: string): string {
    if (!raw) return '';

    let text = raw.trim();

    // ```html ... ``` のコードブロックを検出
    const codeBlockMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      text = codeBlockMatch[1].trim();
    }

    // <!DOCTYPE html または <html から </html> までの範囲を抽出
    const htmlStart = text.search(/<!doctype\s+html|<html/i);
    if (htmlStart !== -1) {
      const htmlEnd = text.toLowerCase().lastIndexOf('</html>');
      if (htmlEnd !== -1) {
        text = text.slice(htmlStart, htmlEnd + 7);
      } else {
        text = text.slice(htmlStart);
      }
    }

    return text.trim();
  }

  /**
   * 生成されたHTML/JSコードの構文・構造・ゲームループ要件を検証する
   */
  validate(rawOrHtml: string): ValidationResult {
    const errors: string[] = [];
    const html = this.extractHtml(rawOrHtml);

    if (!html) {
      return {
        valid: false,
        errors: ['Output does not contain any valid HTML content.'],
        sanitizedHtml: '',
      };
    }

    // 1. 基本HTML構造の検査
    const lower = html.toLowerCase();
    if (!lower.includes('<html') && !lower.includes('<!doctype html')) {
      errors.push('Missing <html> or <!DOCTYPE html> root declaration.');
    }
    if (!lower.includes('</html>')) {
      errors.push('Missing closing </html> tag.');
    }
    if (!lower.includes('<body')) {
      errors.push('Missing <body> tag.');
    }
    if (!lower.includes('</body>')) {
      errors.push('Missing closing </body> tag.');
    }

    // 2. Canvas要素の検査
    const hasCanvasTag = /<canvas[\s>]/i.test(html);
    const hasDynamicCanvas =
      html.includes("createElement('canvas')") ||
      html.includes('createElement("canvas")') ||
      html.includes("getContext('2d')") ||
      html.includes('getContext("2d")');

    if (!hasCanvasTag && !hasDynamicCanvas) {
      errors.push('No <canvas> element or 2D context creation detected.');
    }

    // 3. ゲームループの検査
    const hasLoop =
      html.includes('requestAnimationFrame') ||
      html.includes('setInterval') ||
      html.includes('setTimeout');
    if (!hasLoop) {
      errors.push('No animation or game loop (requestAnimationFrame/setInterval) detected.');
    }

    // 4. 操作・イベントリスナーの検査
    const hasInputListener =
      html.includes('addEventListener') ||
      html.includes('onkeydown') ||
      html.includes('onkeyup') ||
      html.includes('onclick') ||
      html.includes('onpointerdown') ||
      html.includes('ontouchstart');
    if (!hasInputListener) {
      errors.push('No user input or event listeners (keydown/pointerdown/touchstart) detected.');
    }

    // 5. JavaScript構文の非実行コンパイル検査
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    let scriptCount = 0;

    while ((match = scriptRegex.exec(html)) !== null) {
      scriptCount++;
      const scriptCode = match[1];
      if (scriptCode.trim()) {
        try {
          // new Function() による構文コンパイル（コードは実行されない）
          new Function(scriptCode);
        } catch (err: any) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`JavaScript syntax error in <script> tag: ${msg}`);
        }
      }
    }

    if (scriptCount === 0) {
      errors.push('No <script> tag containing game logic detected.');
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitizedHtml: html,
    };
  }
}
