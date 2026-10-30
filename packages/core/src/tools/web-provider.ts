import {
  IWebProvider,
  WebFetchResult,
  WebSearchResultItem,
} from '../types.js';

/**
 * HTML文字列からスクリプト・スタイル・タグを除去し、クリーンなテキスト/簡易Markdownへ変換する
 */
export function htmlToCleanText(html: string): { title?: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1]!.replace(/\s+/g, ' ').trim() : undefined;

  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // 見出しや段落・リストを改行に変換
  cleaned = cleaned
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<(?:p|div|section|article|br|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  // HTML エンティティのデコード
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 連続改行・空白の正規化
  cleaned = cleaned
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1]!.length > 0))
    .join('\n')
    .trim();

  return { title, text: cleaned };
}

export interface FetchWebProviderOptions {
  defaultMaxChars?: number;
  searchAdapter?: (
    query: string,
    options?: { maxResults?: number; signal?: AbortSignal }
  ) => Promise<WebSearchResultItem[]>;
}

/**
 * 標準 fetch ベースの Web プロバイダー (Issue #22)
 * - URL取得と HTML -> クリーンテキスト抽出
 * - 検索アダプター注入またはフォールバック検索
 */
export class FetchWebProvider implements IWebProvider {
  private defaultMaxChars: number;
  private searchAdapter?: FetchWebProviderOptions['searchAdapter'];

  constructor(options: FetchWebProviderOptions = {}) {
    this.defaultMaxChars = options.defaultMaxChars ?? 15000;
    this.searchAdapter = options.searchAdapter;
  }

  async search(
    query: string,
    options?: { maxResults?: number; signal?: AbortSignal }
  ): Promise<WebSearchResultItem[]> {
    if (options?.signal?.aborted) {
      throw new Error('Web search aborted.');
    }

    if (this.searchAdapter) {
      return this.searchAdapter(query, options);
    }

    const maxResults = options?.maxResults ?? 5;
    // DuckDuckGo Lite HTML エンドポイント等を利用した軽量検索試行、失敗時はフォールバック結果を返却
    try {
      const encoded = encodeURIComponent(query);
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
        headers: { 'User-Agent': 'MelonpanAgent/1.0' },
        signal: options?.signal,
      });
      if (res.ok) {
        const html = await res.text();
        const items: WebSearchResultItem[] = [];
        const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        const links = Array.from(html.matchAll(linkRegex));
        const snippets = Array.from(html.matchAll(snippetRegex));

        for (let i = 0; i < Math.min(maxResults, links.length); i++) {
          const rawUrl = links[i]![1] || '';
          const rawTitle = links[i]![2] || '';
          const rawSnippet = snippets[i]?.[1] || '';
          items.push({
            title: htmlToCleanText(rawTitle).text || query,
            url: rawUrl,
            snippet: htmlToCleanText(rawSnippet).text,
          });
        }
        if (items.length > 0) {
          return items;
        }
      }
    } catch (err: any) {
      if (options?.signal?.aborted) {
        throw err;
      }
    }

    return [
      {
        title: `Search Reference: ${query}`,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        snippet: `No live search adapter configured or network unavailable for query "${query}".`,
      },
    ];
  }

  async fetchUrl(
    url: string,
    options?: { maxChars?: number; signal?: AbortSignal }
  ): Promise<WebFetchResult> {
    if (options?.signal?.aborted) {
      throw new Error('URL fetch aborted.');
    }

    const maxChars = options?.maxChars ?? this.defaultMaxChars;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MelonpanAgent/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json,*/*;q=0.8',
      },
      signal: options?.signal,
    });

    const contentType = response.headers.get('content-type') || 'text/plain';
    const rawBody = await response.text();

    let title: string | undefined;
    let processedText = rawBody;

    if (contentType.includes('text/html') || rawBody.trimStart().startsWith('<')) {
      const parsed = htmlToCleanText(rawBody);
      title = parsed.title;
      processedText = parsed.text;
    }

    let truncated = false;
    if (processedText.length > maxChars) {
      processedText = `${processedText.slice(0, maxChars)}\n... [Truncated ${processedText.length - maxChars} chars]`;
      truncated = true;
    }

    return {
      url,
      title,
      content: processedText,
      contentType,
      status: response.status,
      truncated: truncated || undefined,
    };
  }
}

/**
 * テスト・オフライン環境用モック Web プロバイダー
 */
export class MockWebProvider implements IWebProvider {
  private searchResults: Map<string, WebSearchResultItem[]> = new Map();
  private pages: Map<string, string> = new Map();

  registerSearchResults(query: string, items: WebSearchResultItem[]): void {
    this.searchResults.set(query, items);
  }

  registerPage(url: string, content: string): void {
    this.pages.set(url, content);
  }

  async search(
    query: string,
    options?: { maxResults?: number; signal?: AbortSignal }
  ): Promise<WebSearchResultItem[]> {
    if (options?.signal?.aborted) {
      throw new Error('Search aborted');
    }
    const maxResults = options?.maxResults ?? 5;
    const custom = this.searchResults.get(query);
    if (custom) {
      return custom.slice(0, maxResults);
    }
    return [
      {
        title: `Documentation for ${query}`,
        url: `https://example.com/docs/${encodeURIComponent(query)}`,
        snippet: `Simulated search result snippet explaining ${query}.`,
      },
    ];
  }

  async fetchUrl(
    url: string,
    options?: { maxChars?: number; signal?: AbortSignal }
  ): Promise<WebFetchResult> {
    if (options?.signal?.aborted) {
      throw new Error('Fetch aborted');
    }
    const maxChars = options?.maxChars ?? 10000;
    const raw = this.pages.get(url) ?? `<html><head><title>Mock Page</title></head><body><h1>Content for ${url}</h1><p>Details here.</p></body></html>`;
    const isHtml = raw.trimStart().startsWith('<');
    const parsed = isHtml ? htmlToCleanText(raw) : { title: undefined, text: raw };
    const truncated = parsed.text.length > maxChars;
    const content = truncated ? parsed.text.slice(0, maxChars) : parsed.text;

    return {
      url,
      title: parsed.title,
      content,
      contentType: isHtml ? 'text/html' : 'text/plain',
      status: 200,
      truncated: truncated || undefined,
    };
  }
}
