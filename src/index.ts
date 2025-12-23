import type { Plugin, PluginInput } from '@opencode-ai/plugin'
import type { Auth } from '@opencode-ai/sdk'
import { loginAccount } from './auth.js'
import { getNextAccount, markRateLimited } from './rotation.js'
import { listAccounts, loadStore } from './store.js'
import { DEFAULT_CONFIG, type PluginConfig } from './types.js'

const PROVIDER_ID = 'openai'
const CODEX_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const REDIRECT_PORT = 1455
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`

let pluginConfig: PluginConfig = { ...DEFAULT_CONFIG }

export function configure(config: Partial<PluginConfig>): void {
  pluginConfig = { ...pluginConfig, ...config }
}

/**
 * Multi-account OAuth plugin for OpenCode
 *
 * Rotates between multiple ChatGPT Plus/Pro accounts for rate limit resilience.
 */
export const MultiAuthPlugin: Plugin = async ({ client }: PluginInput) => {
  return {
    auth: {
      provider: PROVIDER_ID,

      /**
       * Loader configures the SDK with multi-account rotation
       */
      async loader(getAuth: () => Promise<Auth>, provider: unknown) {
        const accounts = listAccounts()

        if (accounts.length === 0) {
          console.log('[multi-auth] No accounts configured. Run: opencode-multi-auth add <alias>')
          return {}
        }

        // Custom fetch with multi-account rotation
        const customFetch = async (
          input: Request | string | URL,
          init?: RequestInit
        ): Promise<Response> => {
          const rotation = await getNextAccount(pluginConfig)

          if (!rotation) {
            return new Response(
              JSON.stringify({ error: { message: 'No available accounts' } }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const { account, token } = rotation
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

          // Parse and transform request body
          const body = init?.body ? JSON.parse(init.body as string) : {}
          const baseModel = body.model?.replace(/-(?:none|low|medium|high|xhigh)$/, '') || body.model
          const reasoningMatch = body.model?.match(/-(none|low|medium|high|xhigh)$/)
          const reasoningEffort = reasoningMatch?.[1] || body.reasoningEffort || 'medium'

          const payload = {
            ...body,
            model: baseModel,
            reasoning_effort: reasoningEffort,
            store: false
          }

          try {
            const res = await fetch(url, {
              method: init?.method || 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...(init?.headers as Record<string, string>)
              },
              body: JSON.stringify(payload)
            })

            // Handle rate limiting with automatic rotation
            if (res.status === 429) {
              markRateLimited(account.alias, pluginConfig.rateLimitCooldownMs)

              // Try another account
              const retryRotation = await getNextAccount(pluginConfig)
              if (retryRotation && retryRotation.account.alias !== account.alias) {
                return customFetch(input, init)
              }

              // All accounts exhausted
              const errorData = await res.json().catch(() => ({})) as { error?: { message?: string } }
              return new Response(
                JSON.stringify({
                  error: {
                    message: `[multi-auth] Rate limited on all accounts. ${errorData.error?.message || ''}`
                  }
                }),
                { status: 429, headers: { 'Content-Type': 'application/json' } }
              )
            }

            return res
          } catch (err) {
            return new Response(
              JSON.stringify({ error: { message: `[multi-auth] Request failed: ${err}` } }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            )
          }
        }

        // Return SDK configuration with custom fetch for rotation
        return {
          apiKey: 'multi-auth', // Placeholder, we use our own tokens
          baseURL: 'https://api.openai.com/v1',
          fetch: customFetch
        }
      },

      methods: [
        {
          label: 'ChatGPT OAuth (Multi-Account)',
          type: 'oauth' as const,

          prompts: [
            {
              type: 'text' as const,
              key: 'alias',
              message: 'Account alias (e.g., personal, work)',
              placeholder: 'personal'
            }
          ],

          /**
           * OAuth flow - opens browser for ChatGPT login
           */
          authorize: async (inputs?: Record<string, string>) => {
            const alias = inputs?.alias || `account-${Date.now()}`

            // Start OAuth server and get URL
            const authUrl = new URL('https://auth.openai.com/authorize')
            authUrl.searchParams.set('client_id', 'pdlLIX2Y72MIl2rhLhTE9VV9bN905kBh')
            authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
            authUrl.searchParams.set('response_type', 'code')
            authUrl.searchParams.set('scope', 'openid profile email offline_access')
            authUrl.searchParams.set('audience', 'https://api.openai.com/v1')

            return {
              url: authUrl.toString(),
              method: 'auto' as const,
              instructions: `Login with your ChatGPT Plus/Pro account for "${alias}"`,

              callback: async () => {
                try {
                  const account = await loginAccount(alias)
                  return {
                    type: 'success' as const,
                    provider: PROVIDER_ID,
                    refresh: account.refreshToken,
                    access: account.accessToken,
                    expires: account.expiresAt
                  }
                } catch {
                  return { type: 'failed' as const }
                }
              }
            }
          }
        },
        {
          label: 'Skip (use existing accounts)',
          type: 'api' as const
        }
      ]
    }
  }
}

// CLI helpers (unchanged)
export function status(): void {
  const store = loadStore()
  const accounts = Object.values(store.accounts)

  console.log('\n[multi-auth] Account Status\n')
  console.log(`Strategy: ${pluginConfig.rotationStrategy}`)
  console.log(`Accounts: ${accounts.length}`)
  console.log(`Active: ${store.activeAlias || 'none'}\n`)

  if (accounts.length === 0) {
    console.log('No accounts configured. Run: opencode-multi-auth add <alias>\n')
    return
  }

  for (const acc of accounts) {
    const isActive = acc.alias === store.activeAlias ? ' (active)' : ''
    const isRateLimited = acc.rateLimitedUntil && acc.rateLimitedUntil > Date.now()
      ? ` [RATE LIMITED until ${new Date(acc.rateLimitedUntil).toLocaleTimeString()}]`
      : ''
    const expiry = new Date(acc.expiresAt).toLocaleString()

    console.log(`  ${acc.alias}${isActive}${isRateLimited}`)
    console.log(`    Email: ${acc.email || 'unknown'}`)
    console.log(`    Uses: ${acc.usageCount}`)
    console.log(`    Token expires: ${expiry}`)
    console.log()
  }
}

export { loginAccount } from './auth.js'
export { addAccount, removeAccount, listAccounts } from './store.js'
export { DEFAULT_CONFIG } from './types.js'
export default MultiAuthPlugin
