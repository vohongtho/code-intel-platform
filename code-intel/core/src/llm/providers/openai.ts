/**
 * OpenAI provider — uses the `openai` npm package (optional peer dep).
 * Model defaults to gpt-4o-mini; configurable via LLMConfig.model.
 * API key: constructor arg → $OPENAI_API_KEY env var.
 */
import type { LLMProvider, SummarizeResult } from '../provider.js';

export class OpenAIProvider implements LLMProvider {
  readonly modelName: string;
  readonly endpoint: string;
  private readonly apiKey: string;

  constructor(model?: string, baseUrl?: string, apiKey?: string) {
    this.modelName = model ?? 'gpt-4o-mini';
    this.endpoint  = (baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.apiKey    = apiKey ?? '';
  }

  private resolvedKey(): string {
    return this.apiKey || process.env['OPENAI_API_KEY'] || '';
  }

  async getContextWindow(): Promise<number | undefined> {
    try {
      const res = await fetch(`${this.endpoint}/models/${encodeURIComponent(this.modelName)}`, {
        headers: { 'Authorization': `Bearer ${this.resolvedKey()}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return undefined;
      const json = await res.json() as { context_window?: number };
      return json.context_window;
    } catch { return undefined; }
  }

  async summarize(prompt: string): Promise<SummarizeResult> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — openai is an optional peer dependency; not in devDeps
    const { default: OpenAI } = await import('openai');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new OpenAI({ apiKey: this.resolvedKey(), baseURL: this.endpoint }) as any;
    const res = await client.chat.completions.create({
      model: this.modelName,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    });
    return {
      text:             res.choices?.[0]?.message?.content?.trim() ?? '',
      promptTokens:     res.usage?.prompt_tokens     ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    };
  }
}
