/**
 * Ollama provider — calls the local HTTP API at http://localhost:11434.
 * Model defaults to 'llama3'; configurable via LLMConfig.model.
 * No external package needed — uses native fetch.
 */
import type { LLMProvider } from '../provider.js';

export class OllamaProvider implements LLMProvider {
  readonly modelName: string;
  private readonly baseUrl: string;

  constructor(model?: string, baseUrl?: string) {
    this.modelName = model ?? 'llama3';
    this.baseUrl    = baseUrl ?? 'http://localhost:11434';
  }

  async summarize(prompt: string): Promise<string> {
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

    const json = await res.json() as { response?: string };
    return (json.response ?? '').trim();
  }
}
