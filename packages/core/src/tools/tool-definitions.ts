import { Tool } from '@google/genai';
import { createBuiltinTools } from './builtin-tools.js';

/**
 * Gemini API用のツール宣言 (Function Declarations)
 * ToolRegistry の標準組み込みツール群から自動生成しつつ後方互換性を維持
 */
export const MELONPAN_TOOLS: Tool[] = [
  {
    functionDeclarations: createBuiltinTools().map((t) => t.declaration),
  },
];
