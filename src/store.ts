import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'node:crypto'
import type { AccountStore, AccountCredentials, RateLimitHistoryEntry, RateLimitSnapshot } from './types.js'

const STORE_DIR = path.join(os.homedir(), '.config', 'opencode-multi-auth')
const STORE_FILE = path.join(STORE_DIR, 'accounts.json')
const STORE_ENV_PASSPHRASE = 'CODEX_SOFT_STORE_PASSPHRASE'
const STORE_VERSION = 1

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
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 })
  }
}

function emptyStore(): AccountStore {
  return {
    accounts: {},
    activeAlias: null,
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
    version: STORE_VERSION,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  }
}

function decryptStore(file: EncryptedStoreFile, passphrase: string): AccountStore {
  const salt = Buffer.from(file.salt, 'base64')
  const iv = Buffer.from(file.iv, 'base64')
  const tag = Buffer.from(file.tag, 'base64')
  const data = Buffer.from(file.data, 'base64')
  const key = deriveKey(passphrase, salt)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  return JSON.parse(decrypted) as AccountStore
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

export function loadStore(): AccountStore {
  storeLocked = false
  lastStoreError = null
  lastStoreEncrypted = false
  ensureDir()
  if (fs.existsSync(STORE_FILE)) {
    try {
      const data = fs.readFileSync(STORE_FILE, 'utf-8')
      const parsed = JSON.parse(data)
      if (isEncryptedFile(parsed)) {
        lastStoreEncrypted = true
        const passphrase = getPassphrase()
        if (!passphrase) {
          storeLocked = true
          lastStoreError = `Store is encrypted. Set ${STORE_ENV_PASSPHRASE} to unlock.`
          return emptyStore()
        }
        try {
          return decryptStore(parsed, passphrase)
        } catch (err) {
          storeLocked = true
          lastStoreError = 'Failed to decrypt store. Check passphrase.'
          console.error('[multi-auth] Failed to decrypt store:', err)
          return emptyStore()
        }
      }
      return parsed as AccountStore
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
  const passphrase = getPassphrase()
  if (passphrase) {
    const payload = encryptStore(store, passphrase)
    fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 })
    return
  }
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), { mode: 0o600 })
}

export function addAccount(alias: string, creds: Omit<AccountCredentials, 'alias' | 'usageCount'>): AccountStore {
  const store = loadStore()
  const entry = buildHistoryEntry(creds.rateLimits)
  store.accounts[alias] = {
    ...creds,
    alias,
    usageCount: 0,
    rateLimitHistory: entry ? [entry] : creds.rateLimitHistory
  }
  if (!store.activeAlias) {
    store.activeAlias = alias
  }
  saveStore(store)
  return store
}

export function removeAccount(alias: string): AccountStore {
  const store = loadStore()
  delete store.accounts[alias]
  if (store.activeAlias === alias) {
    const remaining = Object.keys(store.accounts)
    store.activeAlias = remaining[0] || null
  }
  saveStore(store)
  return store
}

export function updateAccount(alias: string, updates: Partial<AccountCredentials>): AccountStore {
  const store = loadStore()
  if (store.accounts[alias]) {
    const current = store.accounts[alias]
    const next = { ...current, ...updates }
    if (updates.rateLimits || next.rateLimits) {
      const entry = buildHistoryEntry(next.rateLimits)
      if (entry) {
        next.rateLimitHistory = appendHistory(current.rateLimitHistory, entry)
      }
    }
    store.accounts[alias] = next
    saveStore(store)
  }
  return store
}

export function setActiveAlias(alias: string | null): AccountStore {
  const store = loadStore()
  const now = Date.now()
  const previousAlias = store.activeAlias

  if (alias === null) {
    store.activeAlias = null
  } else if (store.accounts[alias]) {
    if (previousAlias && previousAlias !== alias && store.accounts[previousAlias]) {
      store.accounts[previousAlias] = {
        ...store.accounts[previousAlias],
        lastActiveUntil: now
      }
    }

    store.activeAlias = alias
    store.accounts[alias] = {
      ...store.accounts[alias],
      lastSeenAt: now,
      lastActiveUntil: undefined
    }

    const aliases = Object.keys(store.accounts)
    const idx = aliases.indexOf(alias)
    if (idx >= 0) {
      store.rotationIndex = idx
    }
    store.lastRotation = now
  }
  saveStore(store)
  return store
}

export function getActiveAccount(): AccountCredentials | null {
  const store = loadStore()
  if (!store.activeAlias) return null
  return store.accounts[store.activeAlias] || null
}

export function listAccounts(): AccountCredentials[] {
  const store = loadStore()
  return Object.values(store.accounts)
}

export function getStorePath(): string {
  return STORE_FILE
}

export function getStoreStatus(): { locked: boolean; encrypted: boolean; error: string | null } {
  return { locked: storeLocked, encrypted: lastStoreEncrypted, error: lastStoreError }
}
