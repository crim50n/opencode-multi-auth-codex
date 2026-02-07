import { getStoreDiagnostics, loadStore, saveStore, updateAccount } from './store.js'
import { ensureValidToken } from './auth.js'
import type { AccountCredentials, DEFAULT_CONFIG } from './types.js'

export interface RotationResult {
  account: AccountCredentials
  token: string
}

function shuffled<T>(input: T[]): T[] {
  const a = [...input]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function getNextAccount(
  config: typeof DEFAULT_CONFIG
): Promise<RotationResult | null> {
  let store = loadStore()
  const aliases = Object.keys(store.accounts)

  if (aliases.length === 0) {
    const diag = getStoreDiagnostics()
    const extra = diag.error ? ` (${diag.error})` : ''
    console.error(
      `[multi-auth] No accounts configured. Run: opencode-multi-auth add <alias>${extra}`
    )
    if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
      console.error(`[multi-auth] store file: ${diag.storeFile}`)
    }
    return null
  }

  const now = Date.now()
  const availableAliases = aliases.filter(alias => {
    const acc = store.accounts[alias]
    const notRateLimited = !acc.rateLimitedUntil || acc.rateLimitedUntil < now
    const notModelUnsupported =
      !acc.modelUnsupportedUntil || acc.modelUnsupportedUntil < now
    const notInvalidated = !acc.authInvalid
    return notRateLimited && notModelUnsupported && notInvalidated
  })

  if (availableAliases.length === 0) {
    console.warn('[multi-auth] No available accounts (rate-limited or invalidated).')
    return null
  }

  const tokenFailureCooldownMs = (() => {
    const raw = process.env.OPENCODE_MULTI_AUTH_TOKEN_FAILURE_COOLDOWN_MS
    const parsed = raw ? Number(raw) : NaN
    if (Number.isFinite(parsed) && parsed > 0) return parsed
    return 60_000
  })()

  const buildCandidates = (): { aliases: string[]; nextIndex?: (selected: string) => number } => {
    switch (config.rotationStrategy) {
      case 'least-used': {
        const sorted = [...availableAliases].sort((a, b) => {
          const aa = store.accounts[a]
          const bb = store.accounts[b]
          const usageDiff = (aa?.usageCount || 0) - (bb?.usageCount || 0)
          if (usageDiff !== 0) return usageDiff
          const lastDiff = (aa?.lastUsed || 0) - (bb?.lastUsed || 0)
          if (lastDiff !== 0) return lastDiff
          return a.localeCompare(b)
        })
        return { aliases: sorted }
      }
      case 'random': {
        return { aliases: shuffled(availableAliases) }
      }
      case 'round-robin':
      default: {
        const start = store.rotationIndex % availableAliases.length
        const rr = availableAliases.map(
          (_, i) => availableAliases[(start + i) % availableAliases.length]
        )
        const nextIndex = (selected: string): number => {
          const idx = availableAliases.indexOf(selected)
          if (idx < 0) return store.rotationIndex
          return (idx + 1) % availableAliases.length
        }
        return { aliases: rr, nextIndex }
      }
    }
  }

  const { aliases: candidates, nextIndex } = buildCandidates()

  for (const candidate of candidates) {
    const token = await ensureValidToken(candidate)
    if (!token) {
      // Don't hard-fail the whole system on a single broken account.
      // Put it on a short cooldown so rotation can keep working.
      store = updateAccount(candidate, {
        rateLimitedUntil: now + tokenFailureCooldownMs,
        limitError: '[multi-auth] Token unavailable (refresh failed?)',
        lastLimitErrorAt: now
      })
      continue
    }

    store = updateAccount(candidate, {
      usageCount: (store.accounts[candidate]?.usageCount || 0) + 1,
      lastUsed: now,
      limitError: undefined
    })

    store.activeAlias = candidate
    store.lastRotation = now
    if (nextIndex) {
      store.rotationIndex = nextIndex(candidate)
    }
    saveStore(store)

    return { account: store.accounts[candidate], token }
  }

  console.error('[multi-auth] No available accounts (token refresh failed on all candidates).')
  return null
}

export function markRateLimited(alias: string, cooldownMs: number): void {
  updateAccount(alias, {
    rateLimitedUntil: Date.now() + cooldownMs
  })
  console.warn(`[multi-auth] Account ${alias} marked rate-limited for ${cooldownMs / 1000}s`)
}

export function clearRateLimit(alias: string): void {
  updateAccount(alias, {
    rateLimitedUntil: undefined
  })
}

export function markModelUnsupported(
  alias: string,
  cooldownMs: number,
  info?: { model?: string; error?: string }
): void {
  updateAccount(alias, {
    modelUnsupportedUntil: Date.now() + cooldownMs,
    modelUnsupportedAt: Date.now(),
    modelUnsupportedModel: info?.model,
    modelUnsupportedError: info?.error
  })
  const extra = info?.model ? ` (model=${info.model})` : ''
  console.warn(
    `[multi-auth] Account ${alias} marked model-unsupported for ${cooldownMs / 1000}s${extra}`
  )
}

export function clearModelUnsupported(alias: string): void {
  updateAccount(alias, {
    modelUnsupportedUntil: undefined,
    modelUnsupportedAt: undefined,
    modelUnsupportedModel: undefined,
    modelUnsupportedError: undefined
  })
}

export function markAuthInvalid(alias: string): void {
  updateAccount(alias, {
    authInvalid: true,
    authInvalidatedAt: Date.now()
  })
  console.warn(`[multi-auth] Account ${alias} marked invalidated`)
}

export function clearAuthInvalid(alias: string): void {
  updateAccount(alias, {
    authInvalid: false,
    authInvalidatedAt: undefined
  })
}
