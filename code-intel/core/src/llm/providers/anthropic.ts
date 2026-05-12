/**
 * Anthropic provider — uses the `@anthropic-ai/sdk` package (optional peer dep).
 * Model defaults to claude-haiku-4-5; configurable via LLMConfig.model.
 * API key: constructor arg → $ANTHROPIC_API_KEY env var.
 */
import type { LLMProvider, SummarizeResult } from '../provider.js';

/** Known Anthropic model context windows (tokens). */
const ANTHROPIC_CONTEXT: Record<string, number> = {
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-haiku-20241022':  200000,
  'claude-3-opus-20240229':     200000,
  'claude-3-sonnet-20240229':   200000,
  'claude-3-haiku-20240307':    200000,
  'claude-haiku-4-5':           200000,
  'claude-sonnet-4-5':          200000,
  'claude-opus-4-5':            200000,
};

export class AnthropicProvider implements LLMProvider {
  readonly modelName: string;
  readonly endpoint: string;
  private readonly apiKey: string;

  constructor(model?: string, baseUrl?: string, apiKey?: string) {
    this.modelName = model ?? 'claude-haiku-4-5';
    this.endpoint  = (baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, '');
    this.apiKey    = apiKey ?? '';
  }

  private resolvedKey(): string {
    return this.apiKey || process.env['ANTHROPIC_API_KEY'] || '';
  }

  async getContextWindow(): Promise<number | undefined> {
    // Use static lookup; Anthropic API doesn't expose context_window in a simple GET
    return ANTHROPIC_CONTEXT[this.modelName] ?? 200000;
  }

  async summarize(prompt: string): Promise<SummarizeResult> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — @anthropic-ai/sdk is an optional peer dependency; not in devDeps
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new Anthropic({
      apiKey:  this.resolvedKey(),
      baseURL: this.endpoint,
    }) as any;
    const res = await client.messages.create({
      model:      this.modelName,
      max_tokens: 500,
      messages:   [{ role: 'user', content: prompt }],
    });
    const block = res.content?.[0];
    return {
      text:             block && block.type === 'text' ? block.text.trim() : '',
      promptTokens:     res.usage?.input_tokens  ?? 0,
      completionTokens: res.usage?.output_tokens ?? 0,
    };
  }
}
