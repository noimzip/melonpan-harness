import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../src/providers/gemini.js';

describe('GeminiProvider', () => {
  it('throws an error if no API key is provided', async () => {
    const provider = new GeminiProvider({ apiKey: '' });
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.generateStream({
        systemInstruction: 'test',
        prompt: 'test',
      })) {
        // no-op
      }
    }).rejects.toThrow('Gemini API key is required');
  });

  it('uses gemini-3.8-flash as default model and calls stream endpoint with SSE format', async () => {
    let calledUrl = '';
    let calledBody = '';

    const sseResponse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"<!DOCTYPE html>"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"<html></html>"}]}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calledUrl = url.toString();
      calledBody = init?.body as string;

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseResponse));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    const provider = new GeminiProvider({
      apiKey: 'test-api-key',
      fetch: mockFetch as any,
    });

    const chunks: string[] = [];
    for await (const chunk of provider.generateStream({
      systemInstruction: 'system rule',
      prompt: 'make game',
    })) {
      chunks.push(chunk);
    }

    expect(calledUrl).toContain('models/gemini-3.8-flash:streamGenerateContent');
    expect(calledUrl).toContain('alt=sse');
    expect(calledUrl).toContain('key=test-api-key');

    const parsedBody = JSON.parse(calledBody);
    expect(parsedBody.contents[0].parts[0].text).toBe('make game');
    expect(parsedBody.systemInstruction.parts[0].text).toBe('system rule');

    expect(chunks.join('')).toBe('<!DOCTYPE html><html></html>');
  });

  it('handles API errors properly', async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify({ error: 'Quota exceeded' }), {
        status: 429,
        statusText: 'Too Many Requests',
      });
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      fetch: mockFetch as any,
    });

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.generateStream({
        systemInstruction: 'test',
        prompt: 'test',
      })) {
        // no-op
      }
    }).rejects.toThrow('Gemini API request failed [429 Too Many Requests]');
  });
});
