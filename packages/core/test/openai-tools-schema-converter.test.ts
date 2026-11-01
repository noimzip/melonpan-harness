import { describe, it, expect, vi } from 'vitest';
import { Type } from '@google/genai';
import { execFileSync } from 'node:child_process';
import {
  OpenAICompatibleProvider,
  OpenRouterProvider,
  OrcaRouterProvider,
  GroqProvider,
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
import { ToolRegistry } from '../src/tools/tool-registry.js';

/**
 * Python の jsonschema.Draft202012Validator を利用してスキーマが Draft 2020-12 メタスキーマに適合するか厳密に検証する
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
    return { valid: false, error: stdout || stderr || err.message };
  }
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

    it('handles type arrays e.g. ["STRING", "NULL"] -> ["string", "null"]', () => {
      expect(normalizeJsonSchemaType(['STRING', 'NULL'])).toEqual(['string', 'null']);
      expect(normalizeJsonSchemaType(['STRING', 'TYPE_UNSPECIFIED'])).toEqual(['string']);
      expect(normalizeJsonSchemaType(['TYPE_UNSPECIFIED'])).toBeUndefined();
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

    it('cleans up invalid or duplicate items in required arrays', () => {
      const schemaWithBadRequired = {
        type: Type.OBJECT,
        properties: {
          a: { type: Type.STRING },
          b: { type: Type.STRING },
        },
        required: ['a', 'a', '', null as any, 123 as any, 'b'],
      };

      const normalized = normalizeJsonSchema(schemaWithBadRequired);
      expect(normalized.required).toEqual(['a', 'b']);
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
    });

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

    it('OpenRouterProvider, OrcaRouterProvider, and GroqProvider inherit identical tool formatting', () => {
      const tools = [new WriteFileTool().declaration];

      const openRouter = new OpenRouterProvider({ apiKey: 'sk-or' });
      const orcaRouter = new OrcaRouterProvider({ apiKey: 'sk-orca' });
      const groq = new GroqProvider({ apiKey: 'gsk' });

      const orFormatted = openRouter.formatTools(tools);
      const orcaFormatted = orcaRouter.formatTools(tools);
      const groqFormatted = groq.formatTools(tools);

      expect(orFormatted).toEqual(orcaFormatted);
      expect(orcaFormatted).toEqual(groqFormatted);
      expect(orFormatted[0].function.parameters.type).toBe('object');
      expect(orFormatted[0].function.parameters.properties.path.type).toBe('string');
    });
  });
});
