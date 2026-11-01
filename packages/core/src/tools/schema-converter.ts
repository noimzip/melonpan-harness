/**
 * JSON Schema / OpenAPI 互換ツールスキーマ変換モジュール
 *
 * Gemini SDK (@google/genai) の Schema 定義 (Type.OBJECT, Type.STRING 等の大文字型、propertyOrdering 等) を
 * OpenAI / OpenRouter / Groq / OrcaRouter 互換の標準 JSON Schema (draft 2020-12 / draft-07) 形式へ再帰的に正規化します。
 */

const VALID_PRIMITIVE_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
]);

const TYPE_ALIAS_MAP: Record<string, string> = {
  int: 'integer',
  integer: 'integer',
  float: 'number',
  double: 'number',
  number: 'number',
  num: 'number',
  bool: 'boolean',
  boolean: 'boolean',
  str: 'string',
  string: 'string',
  obj: 'object',
  object: 'object',
  arr: 'array',
  array: 'array',
  null: 'null',
};

function normalizeSingleType(val: any): string | undefined {
  if (typeof val !== 'string') return undefined;
  const lower = val.trim().toLowerCase();
  if (lower === 'type_unspecified' || lower === 'any' || lower === '') {
    return undefined;
  }
  return TYPE_ALIAS_MAP[lower] ?? (VALID_PRIMITIVE_TYPES.has(lower) ? lower : undefined);
}

/**
 * JSON Schema の型名を JSON Schema / OpenAPI 互換の小文字プリミティブ型に正規化する
 * - 大文字 ("STRING", "OBJECT") を小文字 ("string", "object") に変換
 * - "TYPE_UNSPECIFIED" や "any" を安全に除去
 * - 配列型の場合、重複を除去 (Draft 2020-12: uniqueItems: true) し、要素が1件なら単一文字列へ縮退
 */
export function normalizeJsonSchemaType(type: any): string | string[] | undefined {
  if (typeof type === 'string') {
    return normalizeSingleType(type);
  }
  if (Array.isArray(type)) {
    const mapped = type
      .map(normalizeSingleType)
      .filter((t): t is string => typeof t === 'string');
    const unique = Array.from(new Set(mapped));
    if (unique.length === 0) return undefined;
    if (unique.length === 1) return unique[0];
    return unique;
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
  const requiredFields = new Set<string>();

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
        if (propVal && typeof propVal === 'object') {
          // 子プロパティが required: true または required: "true" を指定している場合は親の required に昇格
          if ((propVal as any).required === true || (propVal as any).required === 'true') {
            requiredFields.add(propKey);
          }
        }
        props[propKey] = normalizeJsonSchema(propVal);
      }
      result.properties = props;
    } else if (key === 'items') {
      if (Array.isArray(value)) {
        if (value.length === 1) {
          // 単一要素の items 配列は items: schema にアンラップ
          result.items = normalizeJsonSchema(value[0]);
        } else if (value.length > 1) {
          // 複数要素のタプル配列 (Draft-04/07) は Draft 2020-12 準拠の prefixItems へ変換
          result.prefixItems = value.map(normalizeJsonSchema);
        }
      } else if (typeof value === 'object' && value !== null) {
        result.items = normalizeJsonSchema(value);
      } else if (typeof value === 'boolean') {
        result.items = value;
      }
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
      const reqList = Array.isArray(value)
        ? value
        : typeof value === 'string'
        ? [value]
        : [];
      for (const item of reqList) {
        if (typeof item === 'string' && item.trim().length > 0) {
          requiredFields.add(item.trim());
        }
      }
    } else if (key === 'enum') {
      if (Array.isArray(value)) {
        result.enum = [...value];
      } else if (value && typeof (value as any)[Symbol.iterator] === 'function') {
        result.enum = Array.from(value as any);
      }
    } else if (key === 'anyOf' && Array.isArray(value)) {
      result.anyOf = value.map(normalizeJsonSchema);
    } else if (key === 'allOf' && Array.isArray(value)) {
      result.allOf = value.map(normalizeJsonSchema);
    } else if (key === 'oneOf' && Array.isArray(value)) {
      result.oneOf = value.map(normalizeJsonSchema);
    } else if (key === 'not' && value && typeof value === 'object') {
      result.not = normalizeJsonSchema(value);
    } else if (key === 'additionalProperties' && value !== undefined) {
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

  // 必須フィールド配列 (Draft 2020-12 / OpenAPI 3.0: 1件以上の場合のみ設定)
  if (requiredFields.size > 0) {
    result.required = Array.from(requiredFields);
  }

  // OpenAI / LLM 要求: type: 'array' の場合は items または prefixItems が必須
  if (result.type === 'array' && !result.items && !result.prefixItems) {
    result.items = { type: 'string' };
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
 * FunctionDeclaration 配列、Tool[] (Gemini), またはツールオブジェクト配列を OpenAI 互換の tools 配列に変換する
 */
export function formatOpenAITools(tools: any[]): any[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  // 1. 配列の平坦化および Gemini Tool オブジェクト ({ functionDeclarations: [...] }) の展開
  const flattened: any[] = [];
  for (const item of tools) {
    if (!item) continue;
    if (Array.isArray(item)) {
      flattened.push(...formatOpenAITools(item));
    } else if (Array.isArray(item.functionDeclarations)) {
      flattened.push(...item.functionDeclarations);
    } else {
      flattened.push(item);
    }
  }

  return flattened
    .filter(Boolean)
    .map((tool) => {
      // 1) すでに { type: 'function', function: { ... } } 形式の場合
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

      // 2) { declaration: { name, description, parameters } } 形式 (ITool プラグイン) の場合
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

      // 3) 標準 FunctionDeclaration { name, description, parameters } 形式の場合
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
