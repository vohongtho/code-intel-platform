/**
 * Ollama provider — calls the local HTTP API at http://localhost:11434.
 * Model defaults to 'llama3'; configurable via LLMConfig.model.
 * No external package needed — uses native fetch.
 */
import type { LLMProvider, SummarizeResult } from '../provider.js';

export class OllamaProvider implements LLMProvider {
  readonly modelName: string;
  readonly endpoint: string;
  private readonly baseUrl: string;

  constructor(model?: string, baseUrl?: string) {
    this.modelName = model ?? 'llama3';
    this.baseUrl    = baseUrl ?? 'http://localhost:11434';
    this.endpoint   = this.baseUrl;
  }

  async getContextWindow(): Promise<number | undefined> {
    try {
      const res = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.modelName }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return undefined;
      const json = await res.json() as { model_info?: Record<string, unknown> };
      const info = json.model_info ?? {};
      // Key varies: llama.context_length, qwen2.context_length, etc.
      for (const [k, v] of Object.entries(info)) {
        if (k.endsWith('.context_length') && typeof v === 'number') return v;
      }
      return undefined;
    } catch { return undefined; }
  }

  async summarize(prompt: string): Promise<SummarizeResult> {
    const url = `${this.baseUrl}/api/generate`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        prompt,
        stream: false,
        options: { num_predict: 200 },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
    }

    const json = await res.json() as {
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      text:             (json.response ?? '').trim(),
      promptTokens:     json.prompt_eval_count ?? 0,
      completionTokens: json.eval_count        ?? 0,
    };
  }
}
