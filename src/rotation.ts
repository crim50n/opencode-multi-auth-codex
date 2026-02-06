import { loadStore, saveStore } from './store.js'
import { ensureValidToken } from './auth.js'
import type { AccountCredentials, DEFAULT_CONFIG } from './types.js'

export interface RotationResult {
  account: AccountCredentials
  token: string
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function buildCandidateOrder(
  config: typeof DEFAULT_CONFIG,
  store: ReturnType<typeof loadStore>,
  availableAliases: string[]
): string[] {
  if (availableAliases.length <= 1) return [...availableAliases]

  switch (config.rotationStrategy) {
    case 'round-robin': {
      // Start from rotationIndex but try all candidates before giving up.
      const start = store.rotationIndex % availableAliases.length
      return [...availableAliases.slice(start), ...availableAliases.slice(0, start)]
    }
    case 'least-used': {
      return [...availableAliases].sort((a, b) => {
        const accA = store.accounts[a]
        const accB = store.accounts[b]
        const usageA = accA?.usageCount ?? 0
        const usageB = accB?.usageCount ?? 0
        if (usageA !== usageB) return usageA - usageB
        const lastA = accA?.lastUsed ?? 0
        const lastB = accB?.lastUsed ?? 0
        return lastA - lastB
      })
    }
    case 'random': {
      return shuffle(availableAliases)
    }
    default:
      return [...availableAliases]
  }
}

export async function getNextAccount(
  config: typeof DEFAULT_CONFIG
): Promise<RotationResult | null> {
  const snapshot = loadStore()
  const aliases = Object.keys(snapshot.accounts)

  if (aliases.length === 0) {
    console.error('[multi-auth] No accounts configured. Run: opencode-multi-auth add <alias>')
    return null
  }

  const now = Date.now()
  const availableAliases = aliases.filter((alias) => {
    const acc = snapshot.accounts[alias]
    const notRateLimited = !acc.rateLimitedUntil || acc.rateLimitedUntil < now
    const notInvalidated = !acc.authInvalid
    return notRateLimited && notInvalidated
  })

  if (availableAliases.length === 0) {
    console.warn('[multi-auth] No available accounts (rate-limited or invalidated).')
    return null
  }

  const candidates = buildCandidateOrder(config, snapshot, availableAliases)

  let selectedAlias: string | null = null
  let token: string | null = null

  // Important: ensureValidToken() may refresh and write the store.
  // Never save a stale snapshot after this call, or we can overwrite refreshed tokens.
  for (const alias of candidates) {
    const maybeToken = await ensureValidToken(alias)
    if (!maybeToken) continue
    selectedAlias = alias
    token = maybeToken
    break
  }

  if (!selectedAlias || !token) {
    console.error(
      `[multi-auth] Failed to get valid token for any available account (${candidates.length})`
    )
    return null
  }

  // Reload to include any token refresh updates before we persist rotation metadata.
  const store = loadStore()
  const account = store.accounts[selectedAlias]

  if (!account) {
    console.error(`[multi-auth] Selected account disappeared from store: ${selectedAlias}`)
    return null
  }

  store.accounts[selectedAlias] = {
    ...account,
    usageCount: (account.usageCount ?? 0) + 1,
    lastUsed: now,
    lastSeenAt: now
  }

  store.activeAlias = selectedAlias
  store.lastRotation = now

  if (config.rotationStrategy === 'round-robin') {
    // Keep rotationIndex stable across calls even when some candidates fail refresh.
    const idx = availableAliases.indexOf(selectedAlias)
    if (idx >= 0) {
      store.rotationIndex = (idx + 1) % availableAliases.length
    }
  }

  saveStore(store)

  return {
    account: store.accounts[selectedAlias],
    token
  }
}

export function markRateLimited(alias: string, cooldownMs: number): void {
  const store = loadStore()
  if (!store.accounts[alias]) return
  store.accounts[alias] = {
    ...store.accounts[alias],
    rateLimitedUntil: Date.now() + cooldownMs
  }
  saveStore(store)
  console.warn(`[multi-auth] Account ${alias} marked rate-limited for ${cooldownMs / 1000}s`)
}

export function clearRateLimit(alias: string): void {
  const store = loadStore()
  if (!store.accounts[alias]) return
  store.accounts[alias] = {
    ...store.accounts[alias],
    rateLimitedUntil: undefined
  }
  saveStore(store)
}

export function markAuthInvalid(alias: string): void {
  const store = loadStore()
  if (!store.accounts[alias]) return
  store.accounts[alias] = {
    ...store.accounts[alias],
    authInvalid: true,
    authInvalidatedAt: Date.now()
  }
  saveStore(store)
  console.warn(`[multi-auth] Account ${alias} marked invalidated`)
}

export function clearAuthInvalid(alias: string): void {
  const store = loadStore()
  if (!store.accounts[alias]) return
  store.accounts[alias] = {
    ...store.accounts[alias],
    authInvalid: false,
    authInvalidatedAt: undefined
  }
  saveStore(store)
}
