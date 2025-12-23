import { getNextAccount, markRateLimited } from './rotation.js'
import { getModels } from './models.js'
import { listAccounts, loadStore } from './store.js'
import { DEFAULT_CONFIG, type PluginConfig } from './types.js'

interface OpenCodePlugin {
  name: string
  version: string
  provider: {
    name: string
    options?: Record<string, unknown>
    models: () => Promise<Record<string, unknown>>
    call: (model: string, messages: unknown[], options?: unknown) => Promise<unknown>
  }
}

const CODEX_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

let pluginConfig: PluginConfig = { ...DEFAULT_CONFIG }

export function configure(config: Partial<PluginConfig>): void {
  pluginConfig = { ...pluginConfig, ...config }
}

interface ErrorResponse {
  error?: { message?: string }
}

async function callOpenAI(
  model: string,
  messages: unknown[],
  options: unknown = {}
): Promise<unknown> {
  const opts = (options ?? {}) as Record<string, unknown>
  const rotation = await getNextAccount(pluginConfig)

  if (!rotation) {
    throw new Error('[multi-auth] No available accounts. Add accounts first.')
  }

  const { account, token } = rotation
  const baseModel = model.replace(/-(?:none|low|medium|high|xhigh)$/, '')

  const reasoningMatch = model.match(/-(none|low|medium|high|xhigh)$/)
  const reasoningEffort = reasoningMatch?.[1] || opts.reasoningEffort || 'medium'

  const payload = {
    model: baseModel,
    messages,
    ...opts,
    reasoning_effort: reasoningEffort,
    store: false
  }

  try {
    const res = await fetch(CODEX_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })

    if (res.status === 429) {
      markRateLimited(account.alias, pluginConfig.rateLimitCooldownMs)

      const retryRotation = await getNextAccount(pluginConfig)
      if (retryRotation && retryRotation.account.alias !== account.alias) {
        return callOpenAI(model, messages, opts)
      }

      const errorData = (await res.json().catch(() => ({}))) as ErrorResponse
      throw new Error(
        `[multi-auth] Rate limited on all accounts. ` +
        `Reset: ${errorData.error?.message || 'unknown'}`
      )
    }

    if (!res.ok) {
      const errorData = (await res.json().catch(() => ({}))) as ErrorResponse
      throw new Error(
        `[multi-auth] API error ${res.status}: ${errorData.error?.message || res.statusText}`
      )
    }

    return await res.json()
  } catch (err) {
    if (err instanceof Error && err.message.includes('[multi-auth]')) {
      throw err
    }
    throw new Error(`[multi-auth] Request failed: ${err}`)
  }
}

export const plugin: OpenCodePlugin = {
  name: 'opencode-multi-auth',
  version: '1.0.0',

  provider: {
    name: 'openai',

    options: {
      reasoningEffort: 'medium',
      reasoningSummary: 'auto',
      textVerbosity: 'medium',
      include: ['reasoning.encrypted_content'],
      store: false
    },

    models: async () => {
      const accounts = listAccounts()
      const token = accounts[0]?.accessToken
      return getModels(token)
    },

    call: callOpenAI
  }
}

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
export { getModels } from './models.js'
export { DEFAULT_CONFIG } from './types.js'
export default plugin
