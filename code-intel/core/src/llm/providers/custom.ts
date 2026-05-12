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
import type { LLMProvider, SummarizeResult } from '../provider.js';

/** Known context windows for popular models that don't report via API */
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  // DeepSeek
  'deepseek-v4-flash':          64000,
  'deepseek-v4-pro':            64000,
  'deepseek-chat':              64000,
  'deepseek-coder':             16384,
  'deepseek-v2':                128000,
  'deepseek-v3':                64000,
  // Groq
  'llama3-8b-8192':             8192,
  'llama3-70b-8192':            8192,
  'mixtral-8x7b-32768':         32768,
  'gemma-7b-it':                8192,
  // Together AI
  'mistralai/Mistral-7B-v0.1':  8192,
  'meta-llama/Llama-3-8b-chat': 8192,
  // LM Studio / vLLM defaults
  'default':                    4096,
};

export class CustomProvider implements LLMProvider {
  readonly modelName: string;
  readonly endpoint: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, model: string, apiKey = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.modelName = model;
    this.apiKey = apiKey;
    this.endpoint = this.baseUrl;
  }

  async getContextWindow(): Promise<number | undefined> {
    // Try API first — use /v1/models if baseUrl doesn't already end with /v1
    const modelsUrl = this.baseUrl.endsWith('/v1')
      ? `${this.baseUrl}/models`
      : `${this.baseUrl}/v1/models`;
    try {
      const res = await fetch(modelsUrl, {
        headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const json = await res.json() as { data?: Array<{ id: string; context_window?: number }> };
        const model = json.data?.find((m) => m.id === this.modelName);
        if (model?.context_window) return model.context_window;
      }
    } catch { /* ignore */ }
    // Fall back to static lookup
    return KNOWN_CONTEXT_WINDOWS[this.modelName];
  }

  async summarize(prompt: string): Promise<SummarizeResult> {
    // Support both "https://api.deepseek.com" and "https://api.deepseek.com/v1"
    const base = this.baseUrl.endsWith('/v1') ? this.baseUrl : `${this.baseUrl}/v1`;
    const url  = `${base}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body = JSON.stringify({
      model: this.modelName,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3,
    });

    const res = await fetch(url, { method: 'POST', headers, body });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Custom LLM API error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      choices?: Array<{
        message?: {
          content?: string;
          reasoning_content?: string; // DeepSeek reasoning models
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    // Reasoning models (e.g. deepseek-v4-flash) put the answer in content,
    // but with low max_tokens the content may be empty — fall back to reasoning_content.
    const msg  = data.choices?.[0]?.message;
    const text = (msg?.content?.trim() || msg?.reasoning_content?.trim()) ?? '';

    return {
      text,
      promptTokens:     data.usage?.prompt_tokens     ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}
