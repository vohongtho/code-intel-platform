/**
 * Anthropic provider — uses the `@anthropic-ai/sdk` package (optional peer dep).
 * Model defaults to claude-haiku-4-5; configurable via LLMConfig.model.
 * API key read from $ANTHROPIC_API_KEY.
 */
import type { LLMProvider } from '../provider.js';

export class AnthropicProvider implements LLMProvider {
  readonly modelName: string;

  constructor(model?: string) {
    this.modelName = model ?? 'claude-haiku-4-5';
  }

  async summarize(prompt: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — @anthropic-ai/sdk is an optional peer dependency; not in devDeps
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] }) as any;
    const res = await client.messages.create({
      model: this.modelName,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = res.content?.[0];
    return block && block.type === 'text' ? block.text.trim() : '';
  }
}
