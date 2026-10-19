import { OpenAI } from 'openai';
import {
  ModelProvider,
  ProviderMessageResponse,
  ProviderSession,
  ProviderSessionOptions,
  ProviderToolResult,
  PruneHistoryResult,
} from './provider-interface.js';

export const OPENCODE_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write content to a file in the virtual filesystem. Creates a new file or completely overwrites an existing file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The relative file path, e.g., "index.html".',
          },
          content: {
            type: 'string',
            description: 'The complete text content to write to the file.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Edit an existing file in the virtual filesystem by finding an exact snippet and replacing it with new code.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The relative file path to edit, e.g., "index.html".',
          },
          search: {
            type: 'string',
            description:
              'The exact continuous block of text in the existing file that needs to be replaced.',
          },
          replace: {
            type: 'string',
            description: 'The replacement code chunk.',
          },
        },
        required: ['path', 'search', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dispatch_subagent',
      description:
        '専門のサブエージェント（researcher または code-reviewer）に特定の調査またはコードレビューを委譲します。Clean-Room Isolation環境で実行されます。',
      parameters: {
        type: 'object',
        properties: {
          agent_type: {
            type: 'string',
            enum: ['researcher', 'code-reviewer'],
            description:
              'Type of specialized sub-agent: "researcher" for technical discovery or "code-reviewer" for multi-perspective code audit.',
          },
          task_prompt: {
            type: 'string',
            description:
              'The specific technical questions, game mechanics requirements, or review criteria to audit.',
          },
        },
        required: ['agent_type', 'task_prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description:
        'Declare that the goal/task has been fully completed and all files are tested and finalized in the virtual filesystem.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description:
              'A concise, professional summary of the generated artifact, game mechanics, and controls.',
          },
        },
        required: ['summary'],
      },
    },
  },
];

export class OpenCodeProviderSession implements ProviderSession {
  private client: OpenAI;
  private model: string;
  private messages: any[] = [];

  constructor(client: OpenAI, model: string, systemInstruction: string) {
    this.client = client;
    this.model = model.startsWith('opencode/') ? model.replace('opencode/', '') : model;
    this.messages = [
      {
        role: 'system',
        content: systemInstruction,
      },
    ];
  }

  getMessages(): any[] {
    return this.messages;
  }

  async sendMessage(
    input: string | ProviderToolResult[]
  ): Promise<ProviderMessageResponse> {
    if (typeof input === 'string') {
      this.messages.push({
        role: 'user',
        content: input,
      });
    } else if (Array.isArray(input)) {
      for (const res of input) {
        this.messages.push({
          role: 'tool',
          tool_call_id: res.callId,
          content: res.output,
        });
      }
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: this.messages,
      tools: OPENCODE_TOOLS,
    });

    const choice = response.choices[0];
    if (choice?.message) {
      this.messages.push(choice.message);
    }

    const text =
      choice?.message?.content?.trim() ||
      (choice?.message as any)?.reasoning_content?.trim() ||
      undefined;

    const toolCalls = choice?.message?.tool_calls?.map((tc: any) => {
      let args: any = {};
      try {
        args =
          typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments || {};
      } catch {
        args = {};
      }
      return {
        id: tc.id || `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: tc.function.name,
        args,
      };
    });

    const usage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined;

    return {
      text,
      toolCalls,
      usage,
    };
  }

  pruneHistory(thresholdChars: number = 200): PruneHistoryResult {
    let prunedCallsCount = 0;
    let savedCharsCount = 0;

    for (const msg of this.messages) {
      if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc.function?.name === 'write_file') {
            const isString = typeof tc.function.arguments === 'string';
            let args: any = null;
            try {
              args = isString ? JSON.parse(tc.function.arguments) : tc.function.arguments;
            } catch {
              continue;
            }

            if (
              args &&
              typeof args.content === 'string' &&
              args.content.length >= thresholdChars &&
              !args.content.startsWith('<Content preserved in VFS:')
            ) {
              const originalLen = args.content.length;
              const replacement = `<Content preserved in VFS: ${originalLen} chars>`;
              args.content = replacement;
              tc.function.arguments = isString ? JSON.stringify(args) : args;
              prunedCallsCount++;
              savedCharsCount += originalLen - replacement.length;
            }
          }
        }
      }
    }
    return { prunedCallsCount, savedCharsCount };
  }
}

export interface OpenCodeProviderOptions {
  apiKey?: string;
  baseURL?: string;
}

export class OpenCodeProvider implements ModelProvider {
  private client: OpenAI;

  constructor(options: OpenCodeProviderOptions = {}) {
    const envApiKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.OPENCODE_API_KEY
        : '';
    const apiKey = options.apiKey || envApiKey || 'free';
    const baseURL = options.baseURL || 'https://opencode.ai/inference/openai/v1';

    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
  }

  createSession(options: ProviderSessionOptions): ProviderSession {
    return new OpenCodeProviderSession(
      this.client,
      options.model,
      options.systemInstruction
    );
  }
}
