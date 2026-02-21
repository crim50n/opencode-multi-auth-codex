import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'node:crypto'
import type {
  AccountStore,
  AccountStoreV1,
  AccountCredentials,
  StoredAccount,
  RateLimitHistoryEntry,
  RateLimitSnapshot
} from './types.js'

const STORE_DIR_ENV = 'OPENCODE_MULTI_AUTH_STORE_DIR'
const STORE_FILE_ENV = 'OPENCODE_MULTI_AUTH_STORE_FILE'
const DEFAULT_STORE_DIR = path.join(os.homedir(), '.config', 'opencode')
const DEFAULT_STORE_FILE = 'opencode-multi-auth-codex-accounts.json'
const LEGACY_STORE_DIR = path.join(os.homedir(), '.config', 'opencode-multi-auth')
const LEGACY_STORE_FILE = path.join(LEGACY_STORE_DIR, 'accounts.json')
const PREVIOUS_DEFAULT_STORE_FILE = path.join(DEFAULT_STORE_DIR, 'opencode-multi-auth-accounts.json')

function getStoreDir(): string {
  const override = process.env[STORE_DIR_ENV]
  if (override && override.trim()) return path.resolve(override.trim())
  return DEFAULT_STORE_DIR
}

function getStoreFile(): string {
  const override = process.env[STORE_FILE_ENV]
  if (override && override.trim()) return path.resolve(override.trim())
  return path.join(getStoreDir(), DEFAULT_STORE_FILE)
}

const STORE_ENV_PASSPHRASE = 'CODEX_SOFT_STORE_PASSPHRASE'

type EncryptedStoreFile = {
  encrypted: true
  version: number
  salt: string
  iv: string
  tag: string
  data: string
}

let storeLocked = false
let lastStoreError: string | null = null
let lastStoreEncrypted = false

function ensureDir(): void {
  const dir = getStoreDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function maybeMigrateLegacyStore(targetFile: string): void {
  if (process.env[STORE_DIR_ENV] || process.env[STORE_FILE_ENV]) return
  if (fs.existsSync(targetFile)) return

  const candidates = [PREVIOUS_DEFAULT_STORE_FILE, LEGACY_STORE_FILE]
  const source = candidates.find((file) => fs.existsSync(file))
  if (!source) return

  try {
    fs.renameSync(source, targetFile)
    fs.chmodSync(targetFile, 0o600)
  } catch {
    try {
      fs.copyFileSync(source, targetFile)
      fs.chmodSync(targetFile, 0o600)
    } catch {
      // ignore migration failures; loader will continue with empty store
    }
  }
}

function emptyStore(): AccountStore {
  return {
    version: 2,
    accounts: [],
    activeIndex: -1,
    rotationIndex: 0,
    lastRotation: Date.now()
  }
}

function getPassphrase(): string | null {
  const value = process.env[STORE_ENV_PASSPHRASE]
  return value && value.trim().length > 0 ? value : null
}

function isEncryptedFile(payload: any): payload is EncryptedStoreFile {
  return Boolean(payload && payload.encrypted === true && typeof payload.data === 'string')
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32)
}

function encryptStore(store: AccountStore, passphrase: string): EncryptedStoreFile {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = deriveKey(passphrase, salt)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const serialized = JSON.stringify(store)
  const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    encrypted: true,
    version: 2,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  }
}

function decryptStore(file: EncryptedStoreFile, passphrase: string): any {
  const salt = Buffer.from(file.salt, 'base64')
  const iv = Buffer.from(file.iv, 'base64')
  const tag = Buffer.from(file.tag, 'base64')
  const data = Buffer.from(file.data, 'base64')
  const key = deriveKey(passphrase, salt)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  return JSON.parse(decrypted)
}

function buildSnapshot(window?: { remaining?: number; limit?: number; resetAt?: number }): RateLimitSnapshot | undefined {
  if (!window) return undefined
  return {
    remaining: window.remaining,
    limit: window.limit,
    resetAt: window.resetAt
  }
}

function buildHistoryEntry(rateLimits?: { fiveHour?: any; weekly?: any }): RateLimitHistoryEntry | null {
  if (!rateLimits?.fiveHour && !rateLimits?.weekly) return null
  const updatedAtValues = [rateLimits?.fiveHour?.updatedAt, rateLimits?.weekly?.updatedAt].filter(
    (value): value is number => typeof value === 'number'
  )
  const at = updatedAtValues.length > 0 ? Math.max(...updatedAtValues) : Date.now()
  return {
    at,
    fiveHour: buildSnapshot(rateLimits?.fiveHour),
    weekly: buildSnapshot(rateLimits?.weekly)
  }
}

function appendHistory(
  history: RateLimitHistoryEntry[] | undefined,
  entry: RateLimitHistoryEntry
): RateLimitHistoryEntry[] {
  const next = history ? [...history] : []
  const last = next[next.length - 1]
  const same =
    last &&
    last.fiveHour?.remaining === entry.fiveHour?.remaining &&
    last.weekly?.remaining === entry.weekly?.remaining &&
    last.fiveHour?.resetAt === entry.fiveHour?.resetAt &&
    last.weekly?.resetAt === entry.weekly?.resetAt
  if (!same) {
    next.push(entry)
  }
  if (next.length > 160) {
    return next.slice(next.length - 160)
  }
  return next
}

// --- Alias computation (backward compat for web.ts, probe-limits, etc.) ---

function computeAlias(account: StoredAccount, index: number): string {
  if (account.email) {
    return account.email.split('@')[0] || `account-${index}`
  }
  return `account-${index}`
}

function assignAliases(accounts: StoredAccount[]): AccountCredentials[] {
  const seen = new Map<string, number>()
  return accounts.map((acc, idx) => {
    let base = computeAlias(acc, idx)
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    const alias = count === 0 ? base : `${base}-${count + 1}`
    return { ...acc, alias, usageCount: acc.usageCount ?? 0 }
  })
}

// --- Email deduplication (antigravity-style: keep newest per email) ---

function deduplicateByEmail(accounts: StoredAccount[]): StoredAccount[] {
  const byEmail = new Map<string, StoredAccount>()
  const noEmail: StoredAccount[] = []

  for (const acc of accounts) {
    if (!acc.email) {
      noEmail.push(acc)
      continue
    }
    const existing = byEmail.get(acc.email)
    if (!existing) {
      byEmail.set(acc.email, acc)
      continue
    }
    // Keep the one with the newest lastUsed, then addedAt
    const existingTime = existing.lastUsed || existing.addedAt || 0
    const newTime = acc.lastUsed || acc.addedAt || 0
    if (newTime > existingTime) {
      byEmail.set(acc.email, acc)
    }
  }

  return [...byEmail.values(), ...noEmail]
}

// --- Migration from v1 (alias-keyed map) to v2 (array-based) ---

function isV1Store(parsed: any): parsed is AccountStoreV1 {
  return (
    parsed &&
    typeof parsed.accounts === 'object' &&
    !Array.isArray(parsed.accounts) &&
    !('version' in parsed)
  )
}

function isV2Store(parsed: any): parsed is AccountStore {
  return parsed && parsed.version === 2 && Array.isArray(parsed.accounts)
}

function migrateV1toV2(v1: AccountStoreV1): AccountStore {
  const accounts: StoredAccount[] = Object.values(v1.accounts).map((acc) => {
    const { alias, ...rest } = acc
    return {
      ...rest,
      usageCount: rest.usageCount ?? 0,
      addedAt: rest.lastSeenAt || Date.now(),
      enabled: !rest.authInvalid
    }
  })

  const activeIdx = v1.activeAlias
    ? Object.keys(v1.accounts).indexOf(v1.activeAlias)
    : -1

  return {
    version: 2,
    accounts: deduplicateByEmail(accounts),
    activeIndex: activeIdx >= 0 ? activeIdx : (accounts.length > 0 ? 0 : -1),
    rotationIndex: v1.rotationIndex || 0,
    lastRotation: v1.lastRotation || Date.now()
  }
}

// --- Load / Save ---

export function loadStore(): AccountStore {
  storeLocked = false
  lastStoreError = null
  lastStoreEncrypted = false
  ensureDir()
  const file = getStoreFile()
  maybeMigrateLegacyStore(file)
  if (fs.existsSync(file)) {
    try {
      const data = fs.readFileSync(file, 'utf-8')
      let parsed = JSON.parse(data)

      if (isEncryptedFile(parsed)) {
        lastStoreEncrypted = true
        const passphrase = getPassphrase()
        if (!passphrase) {
          storeLocked = true
          lastStoreError = `Store is encrypted. Set ${STORE_ENV_PASSPHRASE} to unlock.`
          return emptyStore()
        }
        try {
          parsed = decryptStore(parsed, passphrase)
        } catch (err) {
          storeLocked = true
          lastStoreError = 'Failed to decrypt store. Check passphrase.'
          console.error('[multi-auth] Failed to decrypt store:', err)
          return emptyStore()
        }
      }

      // Migration
      if (isV1Store(parsed)) {
        const v2 = migrateV1toV2(parsed)
        // Save migrated store
        try {
          saveStore(v2)
        } catch {
          // best effort
        }
        return v2
      }

      if (isV2Store(parsed)) {
        // Deduplicate on every load (like antigravity)
        parsed.accounts = deduplicateByEmail(parsed.accounts)
        // Clamp activeIndex
        if (parsed.activeIndex >= parsed.accounts.length) {
          parsed.activeIndex = parsed.accounts.length > 0 ? 0 : -1
        }
        return parsed
      }

      // Unknown format - try to parse as v1
      if (parsed && typeof parsed.accounts === 'object') {
        if (Array.isArray(parsed.accounts)) {
          // Already array but no version marker - treat as v2
          return {
            version: 2,
            accounts: deduplicateByEmail(parsed.accounts),
            activeIndex: typeof parsed.activeIndex === 'number' ? parsed.activeIndex : 0,
            rotationIndex: parsed.rotationIndex || 0,
            lastRotation: parsed.lastRotation || Date.now()
          }
        }
        return migrateV1toV2(parsed as AccountStoreV1)
      }
    } catch {
      storeLocked = true
      lastStoreError = 'Failed to parse store. Store locked until fixed.'
      console.error('[multi-auth] Failed to parse store, resetting')
    }
  }
  return emptyStore()
}

export function saveStore(store: AccountStore): void {
  ensureDir()
  if (storeLocked) {
    console.error('[multi-auth] Store locked; refusing to overwrite encrypted file.')
    return
  }

  const file = getStoreFile()
  const passphrase = getPassphrase()
  const payload = passphrase ? encryptStore(store, passphrase) : store
  const json = JSON.stringify(payload, null, 2)

  // Best-effort backup to help recover from crashes/corruption.
  try {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, `${file}.bak`)
      fs.chmodSync(`${file}.bak`, 0o600)
    }
  } catch {
    // ignore backup failures
  }

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  let fd: number | null = null

  try {
    fd = fs.openSync(tmp, 'w', 0o600)
    fs.writeFileSync(fd, json, { encoding: 'utf-8' })
    try {
      fs.fsyncSync(fd)
    } catch {
      // fsync not supported everywhere; best-effort
    }
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        // ignore
      }
    }
  }

  try {
    fs.renameSync(tmp, file)
  } catch (err: any) {
    // Windows can fail to rename over an existing file.
    if (err?.code === 'EPERM' || err?.code === 'EEXIST') {
      try {
        fs.unlinkSync(file)
      } catch {
        // ignore
      }
      fs.renameSync(tmp, file)
    } else {
      try {
        fs.unlinkSync(tmp)
      } catch {
        // ignore
      }
      throw err
    }
  }

  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // ignore
  }
}

export function getStoreDiagnostics(): {
  storeDir: string
  storeFile: string
  locked: boolean
  encrypted: boolean
  error: string | null
} {
  return {
    storeDir: getStoreDir(),
    storeFile: getStoreFile(),
    locked: storeLocked,
    encrypted: lastStoreEncrypted,
    error: lastStoreError
  }
}

// --- Account operations (array-based, antigravity-style) ---

/** Find account index by email. Returns -1 if not found. */
export function findIndexByEmail(email: string): number {
  const store = loadStore()
  return store.accounts.findIndex((acc) => acc.email === email)
}

/** Find account index by refresh token. Returns -1 if not found. */
export function findIndexByToken(access?: string, refresh?: string): number {
  const store = loadStore()
  return store.accounts.findIndex((acc) => {
    if (access && acc.accessToken === access) return true
    if (refresh && acc.refreshToken === refresh) return true
    return false
  })
}

/** Add or update an account. Deduplicates by email. Returns the store and the account's index. */
export function addAccount(creds: Omit<StoredAccount, 'usageCount'>): { store: AccountStore; index: number } {
  const store = loadStore()
  const entry = buildHistoryEntry(creds.rateLimits)

  const newAccount: StoredAccount = {
    ...creds,
    usageCount: 0,
    addedAt: creds.addedAt || Date.now(),
    enabled: creds.enabled !== false,
    rateLimitHistory: entry ? [entry] : creds.rateLimitHistory
  }

  // Dedup by email: if same email exists, update it instead
  if (creds.email) {
    const existingIdx = store.accounts.findIndex((acc) => acc.email === creds.email)
    if (existingIdx >= 0) {
      const existing = store.accounts[existingIdx]
      store.accounts[existingIdx] = {
        ...existing,
        ...newAccount,
        usageCount: existing.usageCount || 0,
        addedAt: existing.addedAt || newAccount.addedAt,
        rateLimitHistory: entry
          ? appendHistory(existing.rateLimitHistory, entry)
          : existing.rateLimitHistory || newAccount.rateLimitHistory
      }
      saveStore(store)
      return { store, index: existingIdx }
    }
  }

  // New account
  store.accounts.push(newAccount)
  const index = store.accounts.length - 1
  if (store.activeIndex < 0) {
    store.activeIndex = index
  }
  saveStore(store)
  return { store, index }
}

/** Remove account by index. Returns updated store. */
export function removeAccount(index: number): AccountStore {
  const store = loadStore()
  if (index < 0 || index >= store.accounts.length) return store

  store.accounts.splice(index, 1)

  // Adjust activeIndex
  if (store.accounts.length === 0) {
    store.activeIndex = -1
  } else if (store.activeIndex === index) {
    store.activeIndex = 0
  } else if (store.activeIndex > index) {
    store.activeIndex -= 1
  }

  // Adjust rotationIndex
  if (store.rotationIndex >= store.accounts.length) {
    store.rotationIndex = 0
  }

  saveStore(store)
  return store
}

/** Remove account by email. Returns updated store. */
export function removeAccountByEmail(email: string): AccountStore {
  const idx = findIndexByEmail(email)
  if (idx < 0) return loadStore()
  return removeAccount(idx)
}

/** Update account at index. Returns updated store. */
export function updateAccount(index: number, updates: Partial<StoredAccount>): AccountStore {
  const store = loadStore()
  if (index < 0 || index >= store.accounts.length) return store

  const current = store.accounts[index]
  const next = { ...current, ...updates }

  if (updates.rateLimits || next.rateLimits) {
    const entry = buildHistoryEntry(next.rateLimits)
    if (entry) {
      next.rateLimitHistory = appendHistory(current.rateLimitHistory, entry)
    }
  }

  store.accounts[index] = next
  saveStore(store)
  return store
}

/** Update account by alias (backward compat for web.ts etc.). */
export function updateAccountByAlias(alias: string, updates: Partial<StoredAccount>): AccountStore {
  const accounts = listAccounts()
  const idx = accounts.findIndex((acc) => acc.alias === alias)
  if (idx < 0) return loadStore()
  return updateAccount(idx, updates)
}

/** Set active account by index. */
export function setActiveIndex(index: number): AccountStore {
  const store = loadStore()
  const now = Date.now()

  if (index < 0 || index >= store.accounts.length) {
    store.activeIndex = store.accounts.length > 0 ? 0 : -1
    saveStore(store)
    return store
  }

  const previousIndex = store.activeIndex
  if (previousIndex >= 0 && previousIndex < store.accounts.length && previousIndex !== index) {
    store.accounts[previousIndex] = {
      ...store.accounts[previousIndex],
      lastActiveUntil: now
    }
  }

  store.activeIndex = index
  store.accounts[index] = {
    ...store.accounts[index],
    lastSeenAt: now,
    lastActiveUntil: undefined
  }
  store.rotationIndex = index
  store.lastRotation = now
  saveStore(store)
  return store
}

/** Get the currently active account (with computed alias). */
export function getActiveAccount(): AccountCredentials | null {
  const store = loadStore()
  if (store.activeIndex < 0 || store.activeIndex >= store.accounts.length) return null
  const acc = store.accounts[store.activeIndex]
  return { ...acc, alias: computeAlias(acc, store.activeIndex), usageCount: acc.usageCount ?? 0 }
}

/** List all accounts with computed aliases. */
export function listAccounts(): AccountCredentials[] {
  const store = loadStore()
  return assignAliases(store.accounts)
}

export function getStorePath(): string {
  return getStoreFile()
}

export function getStoreStatus(): { locked: boolean; encrypted: boolean; error: string | null } {
  const diag = getStoreDiagnostics()
  return { locked: diag.locked, encrypted: diag.encrypted, error: diag.error }
}

/** Remove account by alias (backward compat for web.ts etc.). */
export function removeAccountByAlias(alias: string): AccountStore {
  const accounts = listAccounts()
  const idx = accounts.findIndex((acc) => acc.alias === alias)
  if (idx < 0) return loadStore()
  return removeAccount(idx)
}

/** Resolve alias to index (backward compat). Returns -1 if not found. */
export function resolveAlias(alias: string): number {
  const accounts = listAccounts()
  return accounts.findIndex((acc) => acc.alias === alias)
}

// Backward compat: aliases for old API surface used by web.ts etc.
export { setActiveIndex as setActiveAlias }
