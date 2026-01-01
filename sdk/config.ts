/**
 * DevMind Multi-Provider LLM SDK - Configuration Management
 */

import { 
  ClientConfig, 
  ProviderConfig, 
  ProviderName, 
  RetryConfig,
  RateLimitConfig 
} from './types';

// ============================================
// DEFAULT CONFIGURATIONS
// ============================================

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['RATE_LIMIT', 'NETWORK_ERROR', 'TIMEOUT'],
};

export const DEFAULT_RATE_LIMITS: Record<ProviderName, RateLimitConfig> = {
  gemini: {
    requestsPerMinute: 60,
    tokensPerMinute: 1000000,
  },
  openai: {
    requestsPerMinute: 60,
    tokensPerMinute: 150000,
  },
  anthropic: {
    requestsPerMinute: 60,
    tokensPerMinute: 100000,
  },
  ollama: {
    requestsPerMinute: 1000, // Local, no real limit
  },
};

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  gemini: 'gemini-2.5-pro',
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  ollama: 'llama3.2',
};

export const DEFAULT_TIMEOUTS: Record<ProviderName, number> = {
  gemini: 120000,
  openai: 60000,
  anthropic: 60000,
  ollama: 300000, // Local models can be slow
};

// ============================================
// PROVIDER BASE URLS
// ============================================

export const PROVIDER_BASE_URLS: Record<ProviderName, string> = {
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://localhost:11434',
};

// ============================================
// ENVIRONMENT VARIABLE KEYS
// ============================================

export const API_KEY_ENV_VARS: Record<ProviderName, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  ollama: '', // No API key needed
};

// ============================================
// CONFIGURATION BUILDER
// ============================================

export class ConfigBuilder {
  private config: Partial<ClientConfig> = {
    providers: [],
  };

  setDefaultProvider(provider: ProviderName): this {
    this.config.defaultProvider = provider;
    return this;
  }

  setDefaultModel(model: string): this {
    this.config.defaultModel = model;
    return this;
  }

  setRetryConfig(config: Partial<RetryConfig>): this {
    this.config.retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...config,
    };
    return this;
  }

  setDebug(debug: boolean): this {
    this.config.debug = debug;
    return this;
  }

  addProvider(config: ProviderConfig): this {
    this.config.providers = this.config.providers || [];
    this.config.providers.push({
      ...config,
      rateLimit: config.rateLimit || DEFAULT_RATE_LIMITS[config.name],
      timeout: config.timeout || DEFAULT_TIMEOUTS[config.name],
      defaultModel: config.defaultModel || DEFAULT_MODELS[config.name],
    });
    return this;
  }

  addGemini(apiKey?: string): this {
    return this.addProvider({
      name: 'gemini',
      apiKey: apiKey || this.getEnvKey('gemini'),
    });
  }

  addOpenAI(apiKey?: string): this {
    return this.addProvider({
      name: 'openai',
      apiKey: apiKey || this.getEnvKey('openai'),
    });
  }

  addAnthropic(apiKey?: string): this {
    return this.addProvider({
      name: 'anthropic',
      apiKey: apiKey || this.getEnvKey('anthropic'),
    });
  }

  addOllama(baseUrl?: string): this {
    return this.addProvider({
      name: 'ollama',
      baseUrl: baseUrl || PROVIDER_BASE_URLS.ollama,
    });
  }

  private getEnvKey(provider: ProviderName): string | undefined {
    const envVar = API_KEY_ENV_VARS[provider];
    if (!envVar) return undefined;
    
    // Browser environment
    if (typeof window !== 'undefined') {
      return (window as unknown as Record<string, unknown>)[envVar] as string | undefined;
    }
    
    // Node environment
    if (typeof process !== 'undefined' && process.env) {
      return process.env[envVar];
    }
    
    return undefined;
  }

  build(): ClientConfig {
    if (!this.config.providers?.length) {
      throw new Error('At least one provider must be configured');
    }

    if (!this.config.defaultProvider) {
      this.config.defaultProvider = this.config.providers[0].name;
    }

    return {
      providers: this.config.providers,
      defaultProvider: this.config.defaultProvider,
      defaultModel: this.config.defaultModel,
      retryConfig: this.config.retryConfig || DEFAULT_RETRY_CONFIG,
      debug: this.config.debug || false,
    };
  }
}

// ============================================
// QUICK CONFIG HELPERS
// ============================================

export function createConfig(options: {
  geminiKey?: string;
  openaiKey?: string;
  anthropicKey?: string;
  ollamaUrl?: string;
  defaultProvider?: ProviderName;
}): ClientConfig {
  const builder = new ConfigBuilder();

  if (options.geminiKey) {
    builder.addGemini(options.geminiKey);
  }

  if (options.openaiKey) {
    builder.addOpenAI(options.openaiKey);
  }

  if (options.anthropicKey) {
    builder.addAnthropic(options.anthropicKey);
  }

  if (options.ollamaUrl !== undefined) {
    builder.addOllama(options.ollamaUrl || undefined);
  }

  if (options.defaultProvider) {
    builder.setDefaultProvider(options.defaultProvider);
  }

  return builder.build();
}

export function createGeminiOnlyConfig(apiKey: string): ClientConfig {
  return new ConfigBuilder()
    .addGemini(apiKey)
    .setDefaultProvider('gemini')
    .build();
}

export function createMultiProviderConfig(keys: {
  gemini?: string;
  openai?: string;
  anthropic?: string;
}): ClientConfig {
  const builder = new ConfigBuilder();

  if (keys.gemini) builder.addGemini(keys.gemini);
  if (keys.openai) builder.addOpenAI(keys.openai);
  if (keys.anthropic) builder.addAnthropic(keys.anthropic);

  return builder.build();
}

// ============================================
// VALIDATION
// ============================================

export function validateConfig(config: ClientConfig): string[] {
  const errors: string[] = [];

  if (!config.providers || config.providers.length === 0) {
    errors.push('At least one provider must be configured');
  }

  const providerNames = config.providers.map(p => p.name);
  
  if (!providerNames.includes(config.defaultProvider)) {
    errors.push(`Default provider '${config.defaultProvider}' is not in the providers list`);
  }

  for (const provider of config.providers) {
    if (provider.name !== 'ollama' && !provider.apiKey) {
      errors.push(`API key required for provider '${provider.name}'`);
    }
  }

  return errors;
}
