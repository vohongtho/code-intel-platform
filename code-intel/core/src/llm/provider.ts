/**
 * LLM provider abstraction for AI-generated symbol summaries.
 *
 * Implementations live in ./providers/. The factory (./factory.ts) selects
 * the right one based on LLMConfig / env vars.
 */

export interface LLMProvider {
  /** Unique identifier for the model in use (stored in metadata.summaryModel). */
  readonly modelName: string;

  /**
   * Send a single prompt to the LLM and return the text response.
   * Implementations are responsible for basic error handling.
   * Rate-limiting, backoff, and circuit-breaking are added in v0.4 Epic 1.2.
   */
  summarize(prompt: string): Promise<string>;
}

export interface LLMConfig {
  /** Which provider to use. Default: 'ollama'. */
  provider?: 'openai' | 'anthropic' | 'ollama' | 'custom';

  /** Model name / ID passed to the provider. Each provider has its own default. */
  model?: string;

  /**
   * For 'custom' provider: the base URL of the OpenAI-compatible API.
   * e.g. 'http://localhost:1234/v1' (LM Studio), 'https://api.groq.com/openai/v1', etc.
   */
  baseUrl?: string;

  /**
   * API key / token for the provider.
   * For 'custom': passed as Bearer token. For 'openai': falls back to $OPENAI_API_KEY.
   * For 'ollama': not needed.
   */
  apiKey?: string;

  /** Max concurrent LLM calls per batch. Default: 20. */
  batchSize?: number;

  /**
   * Cost guard: stop after summarising this many nodes per run.
   * Undefined = no limit.
   */
  maxNodesPerRun?: number;
}
