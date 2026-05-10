/**
 * Factory: create an LLMProvider from LLMConfig.
 * Uses dynamic imports so provider packages are only loaded when needed.
 */
import type { LLMConfig, LLMProvider } from './provider.js';

export async function createLLMProvider(config: LLMConfig = {}): Promise<LLMProvider> {
  const { provider = 'ollama', model, baseUrl, apiKey } = config;

  switch (provider) {
    case 'openai': {
      const { OpenAIProvider } = await import('./providers/openai.js');
      return new OpenAIProvider(model);
    }
    case 'anthropic': {
      const { AnthropicProvider } = await import('./providers/anthropic.js');
      return new AnthropicProvider(model);
    }
    case 'custom': {
      const { CustomProvider } = await import('./providers/custom.js');
      const url = baseUrl ?? 'http://localhost:1234/v1';
      const mdl = model ?? 'default';
      const key = apiKey ?? '';
      return new CustomProvider(url, mdl, key);
    }
    case 'ollama':
    default: {
      const { OllamaProvider } = await import('./providers/ollama.js');
      return new OllamaProvider(model);
    }
  }
}
