import chalk from 'chalk';
import figures from 'figures';

/**
 * Lightweight, zero-dependency Markdown formatter for terminal CLI (Ink / Chalk)
 * Formats headings, bullet points, inline code, code blocks, bold, and italic.
 */
export function formatTerminalMarkdown(md: string): string[] {
  if (!md) return [];
  const rawLines = md.split('\n');
  const formatted: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Code block toggle (```lang)
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
        formatted.push(chalk.gray(`┌─── Code${codeBlockLang ? ` (${codeBlockLang})` : ''} ` + '─'.repeat(Math.max(10, 40 - codeBlockLang.length))));
      } else {
        inCodeBlock = false;
        formatted.push(chalk.gray('└───' + '─'.repeat(40)));
      }
      continue;
    }

    if (inCodeBlock) {
      formatted.push(chalk.cyan(`│ `) + chalk.white(line));
      continue;
    }

    // Headings
    if (trimmed.startsWith('# ')) {
      formatted.push(chalk.bold.underline.cyan(trimmed.slice(2).trim()));
      continue;
    }
    if (trimmed.startsWith('## ')) {
      formatted.push(chalk.bold.magenta(trimmed.slice(3).trim()));
      continue;
    }
    if (trimmed.startsWith('### ')) {
      formatted.push(chalk.bold.yellow(trimmed.slice(4).trim()));
      continue;
    }
    if (trimmed.startsWith('#### ')) {
      formatted.push(chalk.bold.white(trimmed.slice(5).trim()));
      continue;
    }

    // Checkbox items (- [ ] / - [x])
    const checkMatch = trimmed.match(/^[-*]\s*\[([ xX])\]\s*(.*)$/);
    if (checkMatch) {
      const isChecked = checkMatch[1].toLowerCase() === 'x';
      const mark = isChecked ? chalk.green.bold(figures.tick) : chalk.gray(figures.squareSmall);
      const text = isChecked ? chalk.green(checkMatch[2]) : chalk.white(checkMatch[2]);
      formatted.push(`  ${mark} ${formatInlineStyles(text)}`);
      continue;
    }

    // Bullet points (- or *)
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      formatted.push(`  ${chalk.cyan(figures.pointerSmall)} ${formatInlineStyles(trimmed.slice(2).trim())}`);
      continue;
    }

    // Numbered lists (1. , 2. )
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      formatted.push(`  ${chalk.yellow(numMatch[1] + '.')} ${formatInlineStyles(numMatch[2])}`);
      continue;
    }

    // Horizontal rule (--- or ***)
    if (trimmed.match(/^[-*_]{3,}$/)) {
      formatted.push(chalk.gray('─'.repeat(50)));
      continue;
    }

    // Normal text line
    if (trimmed.length > 0) {
      formatted.push(formatInlineStyles(line));
    } else {
      formatted.push('');
    }
  }

  return formatted;
}

/**
 * Format inline markdown styles: `code`, **bold**, *italic*
 */
export function formatInlineStyles(text: string): string {
  // `code`
  let res = text.replace(/`([^`]+)`/g, (_m, code) => chalk.bgGray.white(` ${code} `));
  // **bold**
  res = res.replace(/\*\*([^*]+)\*\*/g, (_m, b) => chalk.bold(b));
  // *italic*
  res = res.replace(/\*([^*]+)\*/g, (_m, it) => chalk.italic(it));
  return res;
}
