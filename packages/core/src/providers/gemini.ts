import { GenerateStreamParams, LLMProvider } from '../types.js';

export interface GeminiProviderOptions {
  apiKey?: string;
  /** デフォルトモデル: 最新の gemini-3.8-flash */
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * Gemini API プロバイダー実装 (Web標準 fetch + SSEストリーミング)
 * 外部SDKやNode固有モジュールに依存せず、ブラウザ/Node/モバイル共通で動作します。
 */
export class GeminiProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(options: GeminiProviderOptions = {}) {
    const envApiKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.GEMINI_API_KEY
        : '';
    this.apiKey = options.apiKey || envApiKey || '';
    this.model = options.model || 'gemini-3.8-flash';
    this.baseUrl =
      options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    this.fetchFn = options.fetch || globalThis.fetch;

    if (!this.fetchFn) {
      throw new Error(
        'Fetch API is not available in the current environment. Please provide a custom fetch implementation.'
      );
    }
  }

  async *generateStream(params: GenerateStreamParams): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new Error(
        'Gemini API key is required. Pass apiKey to options or set the GEMINI_API_KEY environment variable.'
      );
    }

    const url = `${this.baseUrl}/models/${encodeURIComponent(
      this.model
    )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

    const body: Record<string, any> = {
      contents: [
        {
          role: 'user',
          parts: [{ text: params.prompt }],
        },
      ],
      generationConfig: {
        temperature: params.temperature ?? 0.7,
      },
    };

    if (params.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: params.systemInstruction }],
      };
    }

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorDetails = '';
      try {
        errorDetails = await response.text();
      } catch {
        errorDetails = response.statusText;
      }
      throw new Error(
        `Gemini API request failed [${response.status} ${response.statusText}]: ${errorDetails}`
      );
    }

    if (!response.body) {
      throw new Error('Gemini API returned an empty response body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 最後の不完全な行をバッファに残す
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;

            try {
              const data = JSON.parse(jsonStr);
              const candidates = data.candidates;
              if (Array.isArray(candidates)) {
                for (const candidate of candidates) {
                  const parts = candidate.content?.parts;
                  if (Array.isArray(parts)) {
                    for (const part of parts) {
                      if (typeof part.text === 'string' && part.text.length > 0) {
                        yield part.text;
                      }
                    }
                  }
                }
              }
            } catch (jsonErr) {
              // 不完全なJSONチャンクは無視して次の行へ
            }
          }
        }
      }

      // バッファ末尾に残った行を処理
      if (buffer.trim().startsWith('data:')) {
        const jsonStr = buffer.trim().slice(5).trim();
        if (jsonStr && jsonStr !== '[DONE]') {
          try {
            const data = JSON.parse(jsonStr);
            const candidates = data.candidates;
            if (Array.isArray(candidates)) {
              for (const candidate of candidates) {
                const parts = candidate.content?.parts;
                if (Array.isArray(parts)) {
                  for (const part of parts) {
                    if (typeof part.text === 'string') {
                      yield part.text;
                    }
                  }
                }
              }
            }
          } catch {
            // ignore
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
