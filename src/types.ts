// Account credentials stored locally
export interface AccountCredentials {
  alias: string
  accessToken: string
  refreshToken: string
  expiresAt: number // Unix timestamp
  email?: string
  lastUsed?: number
  usageCount: number
  rateLimitedUntil?: number // If hit rate limit, when it resets
}

// Local store for all accounts
export interface AccountStore {
  accounts: Record<string, AccountCredentials>
  activeAlias: string | null
  rotationIndex: number
  lastRotation: number
}

// OpenAI model info
export interface OpenAIModel {
  id: string
  object: string
  created: number
  owned_by: string
}

// Plugin config
export interface PluginConfig {
  rotationStrategy: 'round-robin' | 'least-used' | 'random'
  autoRefreshTokens: boolean
  rateLimitCooldownMs: number // How long to skip rate-limited accounts
  modelFilter: RegExp // Which models to expose
}

// OpenCode provider model definition
export interface ProviderModel {
  name: string
  limit: {
    context: number
    output: number
  }
  modalities: {
    input: string[]
    output: string[]
  }
  options: {
    reasoningEffort: string
    reasoningSummary: string
    textVerbosity: string
    include: string[]
    store: boolean
  }
}

export const DEFAULT_CONFIG: PluginConfig = {
  rotationStrategy: 'round-robin',
  autoRefreshTokens: true,
  rateLimitCooldownMs: 5 * 60 * 1000, // 5 minutes
  modelFilter: /^gpt-5/
}
