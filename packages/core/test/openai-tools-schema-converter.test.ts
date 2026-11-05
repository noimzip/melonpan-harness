import { describe, it, expect, vi } from 'vitest';
import { Type } from '@google/genai';
import { execFileSync } from 'node:child_process';
import {
  OpenAICompatibleProvider,
  OpenRouterProvider,
  OrcaRouterProvider,
  GroqProvider,
  SurplusProvider,
  formatOpenAITools,
  formatToolParameters,
  normalizeJsonSchema,
  normalizeJsonSchemaType,
} from '../src/providers/index.js';
import {
  WriteFileTool,
  EditFileTool,
  ReadFileTool,
  ListFilesTool,
  GrepSearchTool,
  RunCommandTool,
  WebSearchTool,
  FetchUrlTool,
  ActivateSkillTool,
  DispatchSubagentTool,
  CompleteTaskTool,
  createBuiltinTools,
} from '../src/tools/builtin-tools.js';
import { MELONPAN_TOOLS } from '../src/tools/tool-definitions.js';
import { ToolRegistry } from '../src/tools/tool-registry.js';

/**
 * Python の jsonschema.Draft202012Validator を利用してスキーマが Draft 2020-12 メタスキーマに適合するか厳密に検証する
 * Python 環境がない場合は JS 実装の厳密チェックにフォールバック
 */
function validateWithPythonJsonSchema(schema: any): { valid: boolean; error?: string } {
  try {
    const jsonStr = JSON.stringify(schema);
    const pythonScript = [
      'import sys, json, jsonschema',
      'schema = json.loads(sys.argv[1])',
      'try:',
      '    jsonschema.Draft202012Validator.check_schema(schema)',
      '    print("VALID")',
      'except Exception as e:',
      '    print(f"ERROR: {e}")',
      '    sys.exit(1)',
    ].join('\n');

    const output = execFileSync('python3', ['-c', pythonScript, jsonStr], {
      encoding: 'utf-8',
    });
    return { valid: output.trim() === 'VALID' };
  } catch (err: any) {
    const stdout = err.stdout?.toString() || '';
    const stderr = err.stderr?.toString() || '';
    // Python または jsonschema がない場合のフォールバック検証
    if (stdout.includes('No module named jsonschema') || err.code === 'ENOENT') {
      return fallbackJsDraft202012Check(schema);
    }
    return { valid: false, error: stdout || stderr || err.message };
  }
}

/**
 * JS 実装による Draft 2020-12 構造規則チェック (フォールバック)
 */
function fallbackJsDraft202012Check(schema: any): { valid: boolean; error?: string } {
  const allowedTypes = new Set([
    'array',
    'boolean',
    'integer',
    'null',
    'number',
    'object',
    'string',
  ]);

  function check(s: any, path: string = ''): string | null {
    if (!s || typeof s !== 'object') return null;

    if ('type' in s) {
      if (typeof s.type === 'string') {
        if (!allowedTypes.has(s.type)) {
          return `at '${path}/type': value must be one of 'array', 'boolean', 'integer', 'null', 'number', 'object', 'string' (got '${s.type}')`;
        }
      } else if (Array.isArray(s.type)) {
        if (s.type.length === 0) {
          return `at '${path}/type': array must have at least 1 item`;
        }
        const seen = new Set<string>();
        for (const t of s.type) {
          if (!allowedTypes.has(t)) {
            return `at '${path}/type': array item '${t}' is invalid type`;
          }
          if (seen.has(t)) {
            return `at '${path}/type': duplicate type item '${t}' violates uniqueItems`;
          }
          seen.add(t);
        }
      } else {
        return `at '${path}/type': got ${typeof s.type}, want string or array`;
      }
    }

    if ('items' in s && Array.isArray(s.items)) {
      return `at '${path}/items': array form of items is invalid under Draft 2020-12 (must use prefixItems)`;
    }

    if ('required' in s) {
      if (!Array.isArray(s.required)) {
        return `at '${path}/required': must be an array of strings`;
      }
      const seenReq = new Set<string>();
      for (const r of s.required) {
        if (typeof r !== 'string') {
          return `at '${path}/required': item ${r} is not a string`;
        }
        if (seenReq.has(r)) {
          return `at '${path}/required': duplicate required item '${r}'`;
        }
        seenReq.add(r);
      }
    }

    if (s.properties && typeof s.properties === 'object') {
      for (const [k, v] of Object.entries(s.properties)) {
        const err = check(v, `${path}/properties/${k}`);
        if (err) return err;
      }
    }

    return null;
  }

  const err = check(schema);
  return err ? { valid: false, error: err } : { valid: true };
}

describe('OpenAI Tools & JSON Schema Draft 2020-12 / OpenAPI Specification Compatibility', () => {
  describe('1. Reproduction of Issue: Uppercase Type Enum fails Draft 2020-12 Metaschema', () => {
    it('demonstrates that raw @google/genai declarations with Type.OBJECT and Type.STRING fail Draft 2020-12 validation', () => {
      const rawWriteFileDeclaration = new WriteFileTool().declaration;

      // Raw parameters contain type: "OBJECT" and type: "STRING"
      expect(rawWriteFileDeclaration.parameters.type).toBe('OBJECT');
      expect((rawWriteFileDeclaration.parameters.properties as any).path.type).toBe('STRING');

      const validation = validateWithPythonJsonSchema(rawWriteFileDeclaration.parameters);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("'STRING' is not valid under any of the given schemas");
    });

    it('demonstrates that after formatToolParameters, write_file parameters strictly pass Draft 2020-12 metaschema', () => {
      const rawWriteFileDeclaration = new WriteFileTool().declaration;
      const formatted = formatToolParameters(rawWriteFileDeclaration.parameters);

      expect(formatted.type).toBe('object');
      expect(formatted.properties.path.type).toBe('string');
      expect(formatted.properties.content.type).toBe('string');
      expect(formatted.required).toEqual(['path', 'content']);

      const validation = validateWithPythonJsonSchema(formatted);
      expect(validation.valid).toBe(true);
      expect(validation.error).toBeUndefined();
    });
  });

  describe('2. normalizeJsonSchemaType & normalizeJsonSchema Unit Tests', () => {
    it('normalizes uppercase primitive types to lowercase JSON schema types', () => {
      expect(normalizeJsonSchemaType(Type.STRING)).toBe('string');
      expect(normalizeJsonSchemaType(Type.OBJECT)).toBe('object');
      expect(normalizeJsonSchemaType(Type.NUMBER)).toBe('number');
      expect(normalizeJsonSchemaType(Type.INTEGER)).toBe('integer');
      expect(normalizeJsonSchemaType(Type.BOOLEAN)).toBe('boolean');
      expect(normalizeJsonSchemaType(Type.ARRAY)).toBe('array');
      expect(normalizeJsonSchemaType(Type.NULL)).toBe('null');
      expect(normalizeJsonSchemaType('STRING')).toBe('string');
      expect(normalizeJsonSchemaType('string')).toBe('string');
      expect(normalizeJsonSchemaType(Type.TYPE_UNSPECIFIED)).toBeUndefined();
    });

    it('normalizes common type aliases (int, float, bool, str) to standard JSON Schema primitive types', () => {
      expect(normalizeJsonSchemaType('int')).toBe('integer');
      expect(normalizeJsonSchemaType('float')).toBe('number');
      expect(normalizeJsonSchemaType('double')).toBe('number');
      expect(normalizeJsonSchemaType('bool')).toBe('boolean');
      expect(normalizeJsonSchemaType('str')).toBe('string');
    });

    it('handles type arrays e.g. ["STRING", "NULL"] -> ["string", "null"] and deduplicates to avoid uniqueItems failure', () => {
      expect(normalizeJsonSchemaType(['STRING', 'NULL'])).toEqual(['string', 'null']);
      expect(normalizeJsonSchemaType(['STRING', 'TYPE_UNSPECIFIED'])).toBe('string');
      expect(normalizeJsonSchemaType(['TYPE_UNSPECIFIED'])).toBeUndefined();
      // Deduplication avoids Draft 2020-12 'uniqueItems: true' error
      expect(normalizeJsonSchemaType(['STRING', 'string'])).toBe('string');
      expect(normalizeJsonSchemaType(['STRING', 'NULL', 'string'])).toEqual(['string', 'null']);
    });

    it('recursively normalizes complex schemas with properties, items, enum, and anyOf/allOf/oneOf', () => {
      const complex = {
        type: Type.OBJECT,
        propertyOrdering: ['name', 'config', 'tags'],
        properties: {
          name: { type: Type.STRING, description: 'Tool name' },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            minItems: '1',
            maxItems: '5',
          },
          config: {
            type: Type.OBJECT,
            properties: {
              enabled: { type: Type.BOOLEAN, default: true },
              priority: { type: Type.INTEGER, minimum: '0', maximum: '10' },
            },
            required: ['enabled'],
          },
          choice: {
            anyOf: [
              { type: Type.STRING },
              { type: Type.NUMBER },
            ],
          },
        },
        required: ['name', 'config'],
      };

      const normalized = normalizeJsonSchema(complex);

      expect(normalized.type).toBe('object');
      expect(normalized.propertyOrdering).toBeUndefined(); // Stripped Gemini-specific field
      expect(normalized.properties.name.type).toBe('string');
      expect(normalized.properties.tags.type).toBe('array');
      expect(normalized.properties.tags.items.type).toBe('string');
      expect(normalized.properties.tags.minItems).toBe(1); // Converted string to number
      expect(normalized.properties.tags.maxItems).toBe(5);
      expect(normalized.properties.config.type).toBe('object');
      expect(normalized.properties.config.properties.enabled.type).toBe('boolean');
      expect(normalized.properties.config.properties.priority.type).toBe('integer');
      expect(normalized.properties.config.properties.priority.minimum).toBe(0);
      expect(normalized.properties.choice.anyOf[0].type).toBe('string');
      expect(normalized.properties.choice.anyOf[1].type).toBe('number');

      const validation = validateWithPythonJsonSchema(normalized);
      expect(validation.valid).toBe(true);
    });

    it('cleans up invalid or duplicate items in required arrays and promotes child required: true', () => {
      const schemaWithBadRequired = {
        type: Type.OBJECT,
        properties: {
          a: { type: Type.STRING, required: true },
          b: { type: Type.STRING },
        },
        required: ['b', 'b', '', null as any, 123 as any],
      };

      const normalized = normalizeJsonSchema(schemaWithBadRequired);
      expect(normalized.required).toContain('a');
      expect(normalized.required).toContain('b');
      expect(normalized.required.length).toBe(2);
      expect(normalized.properties.a.required).toBeUndefined(); // Removed boolean required from child property
    });

    it('normalizes single string required to array', () => {
      const schema = {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
        },
        required: 'path' as any,
      };

      const normalized = normalizeJsonSchema(schema);
      expect(normalized.required).toEqual(['path']);
      const validation = validateWithPythonJsonSchema(normalized);
      expect(validation.valid).toBe(true);
    });

    it('converts legacy items array to single items schema or prefixItems to comply with Draft 2020-12', () => {
      // Single item array in items: unwrap to items: schema
      const singleItemArray = {
        type: Type.ARRAY,
        items: [{ type: Type.STRING }],
      };
      const normalizedSingle = normalizeJsonSchema(singleItemArray);
      expect(normalizedSingle.items).toEqual({ type: 'string' });
      expect(Array.isArray(normalizedSingle.items)).toBe(false);
      const val1 = validateWithPythonJsonSchema(normalizedSingle);
      expect(val1.valid).toBe(true);

      // Multiple items array in items: convert to prefixItems
      const multiItemArray = {
        type: Type.ARRAY,
        items: [{ type: Type.STRING }, { type: Type.NUMBER }],
      };
      const normalizedMulti = normalizeJsonSchema(multiItemArray);
      expect(normalizedMulti.prefixItems).toBeDefined();
      expect(normalizedMulti.prefixItems.length).toBe(2);
      expect(normalizedMulti.items).toBeUndefined();
      const val2 = validateWithPythonJsonSchema(normalizedMulti);
      expect(val2.valid).toBe(true);
    });

    it('adds default items to array type when items is omitted (for OpenAI compliance)', () => {
      const arrayWithoutItems = {
        type: Type.ARRAY,
      };
      const normalized = normalizeJsonSchema(arrayWithoutItems);
      expect(normalized.type).toBe('array');
      expect(normalized.items).toBeDefined();
      expect(normalized.items.type).toBe('string');
      const val = validateWithPythonJsonSchema(normalized);
      expect(val.valid).toBe(true);
    });
  });

  describe('3. formatToolParameters Root Requirements', () => {
    it('creates default object schema if parameters is empty or undefined', () => {
      expect(formatToolParameters(undefined)).toEqual({ type: 'object', properties: {} });
      expect(formatToolParameters(null)).toEqual({ type: 'object', properties: {} });
      expect(formatToolParameters({})).toEqual({ type: 'object', properties: {} });
    });

    it('ensures root type is object and properties object exists', () => {
      const formatted = formatToolParameters({
        description: 'No explicit type',
      });
      expect(formatted.type).toBe('object');
      expect(formatted.properties).toEqual({});
    });
  });

  describe('4. All 11 Built-in Tools strictly validate against Draft 2020-12', () => {
    const builtinTools = createBuiltinTools();

    it('contains all 11 standard builtin tools', () => {
      expect(builtinTools.length).toBe(11);
      const names = builtinTools.map((t) => t.name);
      expect(names).toEqual([
        'write_file',
        'edit_file',
        'read_file',
        'list_files',
        'grep_search',
        'run_command',
        'web_search',
        'fetch_url',
        'activate_skill',
        'dispatch_subagent',
        'complete_task',
      ]);
    });

    it('transforms every builtin tool parameters into valid Draft 2020-12 JSON Schema', () => {
      for (const tool of builtinTools) {
        const formatted = formatToolParameters(tool.declaration.parameters);

        expect(formatted.type).toBe('object');
        expect(formatted.properties).toBeDefined();

        const validation = validateWithPythonJsonSchema(formatted);
        expect(
          validation.valid,
          `Tool "${tool.name}" parameters failed Draft 2020-12 validation: ${validation.error}`
        ).toBe(true);
      }
    }, 15000);

    it('specifically validates dispatch_subagent nested array items and enum', () => {
      const subagentTool = new DispatchSubagentTool();
      const formatted = formatToolParameters(subagentTool.declaration.parameters);

      expect(formatted.properties.agent_type.type).toBe('string');
      expect(formatted.properties.agent_type.enum).toEqual(['researcher', 'code-reviewer', 'coder']);
      expect(formatted.properties.files.type).toBe('array');
      expect(formatted.properties.files.items.type).toBe('string');
      expect(formatted.required).toEqual(['agent_type', 'task_prompt']);

      const validation = validateWithPythonJsonSchema(formatted);
      expect(validation.valid).toBe(true);
    });
  });

  describe('5. formatOpenAITools & ToolRegistry.toOpenAITools()', () => {
    it('converts FunctionDeclaration[] to OpenAI tool definitions format', () => {
      const declarations = [new WriteFileTool().declaration, new ListFilesTool().declaration];
      const tools = formatOpenAITools(declarations);

      expect(tools.length).toBe(2);
      expect(tools[0].type).toBe('function');
      expect(tools[0].function.name).toBe('write_file');
      expect(tools[0].function.description).toContain('Write content to a file');
      expect(tools[0].function.parameters.type).toBe('object');
      expect(tools[0].function.parameters.properties.path.type).toBe('string');

      expect(tools[1].type).toBe('function');
      expect(tools[1].function.name).toBe('list_files');
      expect(tools[1].function.parameters.type).toBe('object');
      expect(tools[1].function.parameters.properties.pattern.type).toBe('string');
    });

    it('correctly unwraps Gemini Tool[] object containing functionDeclarations (MELONPAN_TOOLS)', () => {
      const formatted = formatOpenAITools(MELONPAN_TOOLS);
      expect(formatted.length).toBe(11);
      const names = formatted.map((t) => t.function.name);
      expect(names).toContain('write_file');
      expect(names).toContain('edit_file');
      expect(names).toContain('complete_task');
      expect(names).not.toContain('unknown_tool');
    });

    it('correctly unwraps ToolRegistry.toGeminiTools() output', () => {
      const registry = new ToolRegistry([new WriteFileTool(), new ReadFileTool()]);
      const geminiTools = registry.toGeminiTools();
      const openaiTools = formatOpenAITools(geminiTools);

      expect(openaiTools.length).toBe(2);
      expect(openaiTools[0].function.name).toBe('write_file');
      expect(openaiTools[1].function.name).toBe('read_file');
    });

    it('handles already-wrapped OpenAI tool definitions gracefully', () => {
      const alreadyWrapped = [
        {
          type: 'function',
          function: {
            name: 'custom_query',
            description: 'Custom query function',
            parameters: {
              type: 'OBJECT',
              properties: {
                sql: { type: 'STRING' },
              },
            },
          },
        },
      ];

      const formatted = formatOpenAITools(alreadyWrapped);
      expect(formatted[0].type).toBe('function');
      expect(formatted[0].function.name).toBe('custom_query');
      expect(formatted[0].function.parameters.type).toBe('object');
      expect(formatted[0].function.parameters.properties.sql.type).toBe('string');
    });

    it('ToolRegistry.toOpenAITools() matches formatOpenAITools', () => {
      const registry = new ToolRegistry([new WriteFileTool(), new EditFileTool()]);
      const openaiTools = registry.toOpenAITools();

      expect(openaiTools.length).toBe(2);
      expect(openaiTools[0].function.name).toBe('write_file');
      expect(openaiTools[0].function.parameters.type).toBe('object');
      expect(openaiTools[0].function.parameters.properties.path.type).toBe('string');
      expect(openaiTools[1].function.name).toBe('edit_file');
      expect(openaiTools[1].function.parameters.type).toBe('object');
      expect(openaiTools[1].function.parameters.properties.search.type).toBe('string');
    });
  });

  describe('6. OpenAICompatibleProvider.streamChat payload verification', () => {
    it('transmits formatted lowercase JSON schema tools in POST body to chat/completions endpoint', async () => {
      let interceptedBody: any = null;

      const mockFetch = vi.fn(async (url: any, init: any) => {
        interceptedBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: 'File write request received and understood.',
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'write_file',
                        arguments: JSON.stringify({ path: 'test.txt', content: 'hello' }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 25 },
          }),
        };
      }) as any;

      const provider = new OpenAICompatibleProvider({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'test-key',
        fetchImpl: mockFetch,
      });

      const registry = new ToolRegistry(createBuiltinTools());

      const chunks = [];
      for await (const chunk of provider.streamChat({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', parts: [{ text: 'Please write test.txt' }] }],
        tools: registry.toFunctionDeclarations(),
      })) {
        chunks.push(chunk);
      }

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(interceptedBody).toBeDefined();
      expect(Array.isArray(interceptedBody.tools)).toBe(true);
      expect(interceptedBody.tools.length).toBe(11);

      // Verify write_file in the sent payload:
      const writeFileTool = interceptedBody.tools.find((t: any) => t.function.name === 'write_file');
      expect(writeFileTool).toBeDefined();
      expect(writeFileTool.function.parameters.type).toBe('object');
      expect(writeFileTool.function.parameters.properties.path.type).toBe('string');
      expect(writeFileTool.function.parameters.properties.content.type).toBe('string');
      expect(writeFileTool.function.parameters.required).toEqual(['path', 'content']);

      // Validate every single tool in interceptedBody against Python Draft 2020-12 Validator
      for (const t of interceptedBody.tools) {
        const val = validateWithPythonJsonSchema(t.function.parameters);
        expect(val.valid, `Payload tool ${t.function.name} failed Draft 2020-12 validator: ${val.error}`).toBe(true);
      }

      // Verify output chunk
      expect(chunks.some((c) => c.type === 'tool_call' && c.toolCall?.name === 'write_file')).toBe(true);
    });

    it('OpenRouterProvider, OrcaRouterProvider, GroqProvider, and SurplusProvider inherit identical tool formatting', () => {
      const tools = [new WriteFileTool().declaration];

      const openRouter = new OpenRouterProvider({ apiKey: 'sk-or' });
      const orcaRouter = new OrcaRouterProvider({ apiKey: 'sk-orca' });
      const groq = new GroqProvider({ apiKey: 'gsk' });
      const surplus = new SurplusProvider({ apiKey: 'inf_test' });

      const orFormatted = openRouter.formatTools(tools);
      const orcaFormatted = orcaRouter.formatTools(tools);
      const groqFormatted = groq.formatTools(tools);
      const surplusFormatted = surplus.formatTools(tools);

      expect(orFormatted).toEqual(orcaFormatted);
      expect(orcaFormatted).toEqual(groqFormatted);
      expect(groqFormatted).toEqual(surplusFormatted);
      expect(surplusFormatted[0].function.parameters.type).toBe('object');
      expect(surplusFormatted[0].function.parameters.properties.path.type).toBe('string');
    });
  });
});
