/**
 * Custom OpenAI-compatible provider.
 * Works with any API that implements the OpenAI chat completions endpoint:
 *   - LM Studio (http://localhost:1234/v1)
 *   - vLLM (http://localhost:8000/v1)
 *   - Groq (https://api.groq.com/openai/v1)
 *   - Together AI (https://api.together.xyz/v1)
 *   - Azure OpenAI (https://<resource>.openai.azure.com/openai/deployments/<model>)
 *   - Any other OpenAI-compatible REST API
 */
import type { LLMProvider } from '../provider.js';

export class CustomProvider implements LLMProvider {
  readonly modelName: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, model: string, apiKey = '') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // strip trailing slash
    this.modelName = model;
    this.apiKey = apiKey;
  }

  async summarize(prompt: string): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body = JSON.stringify({
      model: this.modelName,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.3,
    });

    const res = await fetch(url, { method: 'POST', headers, body });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Custom LLM API error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content?.trim() ?? '';
  }
}
