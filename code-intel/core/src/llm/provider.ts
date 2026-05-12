/**
 * LLM provider abstraction for AI-generated symbol summaries.
 *
 * Implementations live in ./providers/. The factory (./factory.ts) selects
 * the right one based on LLMConfig / env vars.
 */

export interface LLMProvider {
  /** Unique identifier for the model in use (stored in metadata.summaryModel). */
  readonly modelName: string;

  /** Human-readable endpoint URL for logging (e.g. "http://localhost:11434", "https://api.openai.com"). */
  readonly endpoint: string;

  /**
   * Return the model's context window size in tokens, by querying the API.
   * Returns undefined if not available (caller uses fallback default).
   */
  getContextWindow?(): Promise<number | undefined>;

  /**
   * Send a single prompt to the LLM and return the text response with token usage.
   * Implementations are responsible for basic error handling.
   * Rate-limiting, backoff, and circuit-breaking are added in v0.4 Epic 1.2.
   */
  summarize(prompt: string): Promise<SummarizeResult>;
}

export interface SummarizeResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
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

  /**
   * Request mode for the summarize phase.
   * - 'per-node' (default): one API request per symbol — works with all providers.
   * - 'batch': bundle all symbols in a batch into ONE API request and parse the
   *   JSON array response. Use this with premium-per-request providers (e.g.
   *   copilot-api) to minimise the number of API calls.
   */
  requestMode?: 'per-node' | 'batch';

  /** Max concurrent LLM calls per batch (only used in 'per-node' mode). Default: 5. */
  batchSize?: number;

  /**
   * Context window size (tokens) of the model.
   * Used to calculate how many symbols can be packed into a single batch request.
   * Default: 8192 (conservative for local models).
   */
  contextWindow?: number;

  /**
   * Cost guard: stop after summarising this many nodes per run.
   * Undefined = no limit.
   */
  maxNodesPerRun?: number;
}
