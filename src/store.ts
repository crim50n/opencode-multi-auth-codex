import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { AccountStore, AccountCredentials } from './types.js'

const STORE_DIR = path.join(os.homedir(), '.config', 'opencode-multi-auth')
const STORE_FILE = path.join(STORE_DIR, 'accounts.json')

function ensureDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 })
  }
}

export function loadStore(): AccountStore {
  ensureDir()
  if (fs.existsSync(STORE_FILE)) {
    try {
      const data = fs.readFileSync(STORE_FILE, 'utf-8')
      return JSON.parse(data)
    } catch {
      console.error('[multi-auth] Failed to parse store, resetting')
    }
  }
  return {
    accounts: {},
    activeAlias: null,
    rotationIndex: 0,
    lastRotation: Date.now()
  }
}

export function saveStore(store: AccountStore): void {
  ensureDir()
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), {
    mode: 0o600 // Owner read/write only
  })
}

export function addAccount(alias: string, creds: Omit<AccountCredentials, 'alias' | 'usageCount'>): AccountStore {
  const store = loadStore()
  store.accounts[alias] = {
    ...creds,
    alias,
    usageCount: 0
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
    store.accounts[alias] = { ...store.accounts[alias], ...updates }
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
