/**
 * OpenAI provider — uses the `openai` npm package (optional peer dep).
 * Model defaults to gpt-4o-mini; configurable via LLMConfig.model.
 * API key read from $OPENAI_API_KEY.
 */
import type { LLMProvider } from '../provider.js';

export class OpenAIProvider implements LLMProvider {
  readonly modelName: string;

  constructor(model?: string) {
    this.modelName = model ?? 'gpt-4o-mini';
  }

  async summarize(prompt: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — openai is an optional peer dependency; not in devDeps
    const { default: OpenAI } = await import('openai');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] }) as any;
    const res = await client.chat.completions.create({
      model: this.modelName,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    });
    return res.choices?.[0]?.message?.content?.trim() ?? '';
  }
}
