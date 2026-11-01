/**
 * JSON Schema / OpenAPI 互換ツールスキーマ変換モジュール
 *
 * Gemini SDK (@google/genai) の Schema 定義 (Type.OBJECT, Type.STRING 等の大文字型、propertyOrdering 等) を
 * OpenAI / OpenRouter / Groq / OrcaRouter 互換の標準 JSON Schema (draft 2020-12 / draft-07) 形式へ再帰的に正規化します。
 */

/**
 * JSON Schema の型名を JSON Schema / OpenAPI 互換の小文字プリミティブ型に正規化する
 */
export function normalizeJsonSchemaType(type: any): string | string[] | undefined {
  if (typeof type === 'string') {
    const lower = type.toLowerCase();
    if (lower === 'type_unspecified') {
      return undefined;
    }
    return lower;
  }
  if (Array.isArray(type)) {
    const mapped = type
      .map((t) => (typeof t === 'string' ? t.toLowerCase() : t))
      .filter((t) => t !== 'type_unspecified');
    return mapped.length > 0 ? mapped : undefined;
  }
  return undefined;
}

/**
 * Gemini @google/genai Schema 形式のパラメータ定義を
 * JSON Schema (draft 2020-12 / draft-07) および OpenAI / OpenRouter / Groq / OrcaRouter 互換スキーマへ再帰的に変換・正規化する
 */
export function normalizeJsonSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(normalizeJsonSchema);
  }

  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(schema)) {
    // Gemini 固有の非標準キーワードを除去
    if (key === 'propertyOrdering') {
      continue;
    }

    if (key === 'type') {
      const normalized = normalizeJsonSchemaType(value);
      if (normalized !== undefined) {
        result.type = normalized;
      }
    } else if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const props: Record<string, any> = {};
      for (const [propKey, propVal] of Object.entries(value)) {
        props[propKey] = normalizeJsonSchema(propVal);
      }
      result.properties = props;
    } else if (key === 'items') {
      result.items = Array.isArray(value)
        ? value.map(normalizeJsonSchema)
        : normalizeJsonSchema(value);
    } else if (key === 'prefixItems' && Array.isArray(value)) {
      result.prefixItems = value.map(normalizeJsonSchema);
    } else if (key === 'contains' && value && typeof value === 'object') {
      result.contains = normalizeJsonSchema(value);
    } else if (key === 'patternProperties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const patProps: Record<string, any> = {};
      for (const [pk, pv] of Object.entries(value)) {
        patProps[pk] = normalizeJsonSchema(pv);
      }
      result.patternProperties = patProps;
    } else if (key === 'propertyNames' && value && typeof value === 'object') {
      result.propertyNames = normalizeJsonSchema(value);
    } else if (key === 'dependentSchemas' && value && typeof value === 'object' && !Array.isArray(value)) {
      const depSchemas: Record<string, any> = {};
      for (const [dk, dv] of Object.entries(value)) {
        depSchemas[dk] = normalizeJsonSchema(dv);
      }
      result.dependentSchemas = depSchemas;
    } else if (key === 'required') {
      if (Array.isArray(value)) {
        const uniqueStrings = Array.from(
          new Set(
            value
              .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
              .map((item) => item.trim())
          )
        );
        if (uniqueStrings.length > 0) {
          result.required = uniqueStrings;
        }
      }
    } else if (key === 'enum') {
      if (Array.isArray(value)) {
        result.enum = [...value];
      }
    } else if (key === 'anyOf' && Array.isArray(value)) {
      result.anyOf = value.map(normalizeJsonSchema);
    } else if (key === 'allOf' && Array.isArray(value)) {
      result.allOf = value.map(normalizeJsonSchema);
    } else if (key === 'oneOf' && Array.isArray(value)) {
      result.oneOf = value.map(normalizeJsonSchema);
    } else if (key === 'not' && value && typeof value === 'object') {
      result.not = normalizeJsonSchema(value);
    } else if (key === 'additionalProperties') {
      result.additionalProperties =
        typeof value === 'object' && value !== null
          ? normalizeJsonSchema(value)
          : Boolean(value);
    } else if (key === '$defs' && value && typeof value === 'object') {
      const defs: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        defs[k] = normalizeJsonSchema(v);
      }
      result.$defs = defs;
    } else if (key === 'definitions' && value && typeof value === 'object') {
      const defs: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        defs[k] = normalizeJsonSchema(v);
      }
      result.definitions = defs;
    } else if (
      key === 'minItems' ||
      key === 'maxItems' ||
      key === 'minLength' ||
      key === 'maxLength' ||
      key === 'minProperties' ||
      key === 'maxProperties' ||
      key === 'minimum' ||
      key === 'maximum'
    ) {
      const num = Number(value);
      result[key] = !isNaN(num) ? num : value;
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * ツール呼び出しの `parameters` を OpenAI 互換のルートオブジェクトスキーマに整形する
 */
export function formatToolParameters(parameters: any): Record<string, any> {
  if (!parameters || typeof parameters !== 'object') {
    return {
      type: 'object',
      properties: {},
    };
  }

  const normalized = normalizeJsonSchema(parameters);

  if (!normalized.type) {
    normalized.type = 'object';
  }

  if (normalized.type === 'object' && !normalized.properties) {
    normalized.properties = {};
  }

  return normalized;
}

/**
 * FunctionDeclaration 配列またはツールオブジェクト配列を OpenAI 互換の tools 配列に変換する
 */
export function formatOpenAITools(tools: any[]): any[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools.map((tool) => {
    // すでに { type: 'function', function: { ... } } 形式の場合
    if (tool && tool.type === 'function' && tool.function) {
      return {
        type: 'function',
        function: {
          name: tool.function.name,
          ...(tool.function.description ? { description: tool.function.description } : {}),
          parameters: formatToolParameters(tool.function.parameters),
        },
      };
    }

    // { declaration: { name, description, parameters } } 形式の場合
    if (tool && tool.declaration) {
      return {
        type: 'function',
        function: {
          name: tool.declaration.name,
          ...(tool.declaration.description ? { description: tool.declaration.description } : {}),
          parameters: formatToolParameters(tool.declaration.parameters),
        },
      };
    }

    // 標準 FunctionDeclaration { name, description, parameters } 形式の場合
    return {
      type: 'function',
      function: {
        name: tool?.name || 'unknown_tool',
        ...(tool?.description ? { description: tool.description } : {}),
        parameters: formatToolParameters(tool?.parameters),
      },
    };
  });
}
