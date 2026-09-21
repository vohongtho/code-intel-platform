import type { FrameworkAdapterRegistration, FrameworkAdapter } from './contracts.js';

const FRAMEWORK_ADAPTER_REGISTRATIONS: readonly FrameworkAdapterRegistration[] = [
  {
    id: 'express',
    order: 10,
    load: async () => (await import('./adapters/express.js')).expressFrameworkAdapter,
  },
  {
    id: 'nest',
    order: 20,
    load: async () => (await import('./adapters/nest.js')).nestFrameworkAdapter,
  },
  {
    id: 'fastify',
    order: 30,
    load: async () => (await import('./adapters/fastify.js')).fastifyFrameworkAdapter,
  },
  {
    id: 'aspnet-core',
    order: 40,
    load: async () => (await import('./adapters/aspnet-core.js')).aspnetCoreFrameworkAdapter,
  },
  {
    id: 'spring',
    order: 50,
    load: async () => (await import('./adapters/spring.js')).springFrameworkAdapter,
  },
  {
    id: 'python-web',
    order: 60,
    load: async () => (await import('./adapters/python-web.js')).pythonWebFrameworkAdapter,
  },
  {
    id: 'go-http',
    order: 70,
    load: async () => (await import('./adapters/go-http.js')).goHttpFrameworkAdapter,
  },
  {
    id: 'php-ruby-web',
    order: 80,
    load: async () => (await import('./adapters/php-ruby-web.js')).phpRubyWebFrameworkAdapter,
  },
  {
    id: 'mcp-sdk',
    order: 90,
    load: async () => (await import('./adapters/mcp-sdk.js')).mcpSdkFrameworkAdapter,
  },
  {
    id: 'html-web',
    order: 100,
    load: async () => (await import('./adapters/html-web.js')).htmlWebFrameworkAdapter,
  },
  {
    id: 'fetch-client',
    order: 110,
    load: async () => (await import('../semantic/api-contracts/consumers/fetch.js')).fetchConsumerAdapter,
  },
  {
    id: 'axios-client',
    order: 120,
    load: async () => (await import('../semantic/api-contracts/consumers/axios.js')).axiosConsumerAdapter,
  },
  {
    id: 'angular-http-client',
    order: 130,
    load: async () => (await import('../semantic/api-contracts/consumers/angular-http.js')).angularHttpConsumerAdapter,
  },
] as const;

export function listFrameworkAdapterRegistrations(): readonly FrameworkAdapterRegistration[] {
  return [...FRAMEWORK_ADAPTER_REGISTRATIONS].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export async function loadFrameworkAdapters(): Promise<FrameworkAdapter[]> {
  return Promise.all(listFrameworkAdapterRegistrations().map(async (entry) => entry.load()));
}
