import { Tool, Type } from '@google/genai';

/**
 * Gemini API用のツール宣言 (Function Declarations)
 * ReActループで使用する3つの基本ツールを厳格な型定義で提供
 */
export const MELONPAN_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'write_file',
        description:
          'Write content to a file in the virtual filesystem. Creates a new file or completely overwrites an existing file.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            path: {
              type: Type.STRING,
              description: 'The relative file path, e.g., "index.html".',
            },
            content: {
              type: Type.STRING,
              description: 'The complete text content to write to the file.',
            },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'edit_file',
        description:
          'Edit an existing file in the virtual filesystem by finding an exact snippet and replacing it with new code.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            path: {
              type: Type.STRING,
              description: 'The relative file path to edit, e.g., "index.html".',
            },
            search: {
              type: Type.STRING,
              description:
                'The exact continuous block of text in the existing file that needs to be replaced.',
            },
            replace: {
              type: Type.STRING,
              description: 'The replacement code chunk.',
            },
          },
          required: ['path', 'search', 'replace'],
        },
      },
      {
        name: 'complete_task',
        description:
          'Declare that the goal/task has been fully completed and all files are tested and finalized in the virtual filesystem.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description:
                'A concise, professional summary of the generated artifact, game mechanics, and controls.',
            },
          },
          required: ['summary'],
        },
      },
    ],
  },
];
