import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import lockfile from 'proper-lockfile';
const STORE_DIR_ENV = 'OPENCODE_MULTI_AUTH_STORE_DIR';
const STORE_FILE_ENV = 'OPENCODE_MULTI_AUTH_STORE_FILE';
const DEFAULT_STORE_DIR = path.join(os.homedir(), '.config', 'opencode');
const DEFAULT_STORE_FILE = 'opencode-multi-auth-codex-accounts.json';
function storeDir() {
    return process.env[STORE_DIR_ENV] || DEFAULT_STORE_DIR;
}
function storeFile() {
    const env = process.env[STORE_FILE_ENV];
    if (env)
        return env;
    return path.join(storeDir(), DEFAULT_STORE_FILE);
}
function ensureStoreDir() {
    const dir = path.dirname(storeFile());
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true, mode: 0o700 });
}
function emptyStore() {
    return {
        version: 2,
        accounts: [],
        activeIndex: -1,
        rotationIndex: 0
    };
}
function normalizeEmail(email) {
    const value = email?.trim().toLowerCase();
    return value || undefined;
}
function accountAlias(account, index) {
    if (account.email)
        return account.email.split('@')[0] || `account-${index}`;
    return `account-${index}`;
}
function deduplicateByEmail(accounts) {
    const newest = new Map();
    for (let i = 0; i < accounts.length; i += 1) {
        const email = normalizeEmail(accounts[i]?.email);
        if (!email)
            continue;
        const prev = newest.get(email);
        if (prev === undefined) {
            newest.set(email, i);
            continue;
        }
        const prevScore = Math.max(accounts[prev]?.lastUsed || 0, accounts[prev]?.addedAt || 0);
        const nextScore = Math.max(accounts[i]?.lastUsed || 0, accounts[i]?.addedAt || 0);
        if (nextScore >= prevScore)
            newest.set(email, i);
    }
    if (newest.size === 0)
        return accounts;
    return accounts.filter((account, i) => {
        const email = normalizeEmail(account.email);
        if (!email)
            return true;
        return newest.get(email) === i;
    });
}
function migrateV1toV2(v1) {
    const accounts = Object.entries(v1.accounts || {}).map(([alias, acc]) => ({
        ...acc,
        email: normalizeEmail(acc.email),
        usageCount: acc.usageCount || 0,
        addedAt: acc.addedAt || Date.now(),
        lastRefresh: acc.lastRefresh || new Date().toISOString(),
        lastSeenAt: acc.lastSeenAt || Date.now(),
        source: 'opencode'
    }));
    const dedup = deduplicateByEmail(accounts);
    const activeIndex = (() => {
        const activeAlias = v1.activeAlias;
        if (!activeAlias)
            return dedup.length > 0 ? 0 : -1;
        const idx = Object.keys(v1.accounts || {}).indexOf(activeAlias);
        if (idx < 0 || idx >= dedup.length)
            return dedup.length > 0 ? 0 : -1;
        return idx;
    })();
    return {
        version: 2,
        accounts: dedup,
        activeIndex,
        rotationIndex: v1.rotationIndex || 0
    };
}
function readStore() {
    ensureStoreDir();
    const file = storeFile();
    if (!existsSync(file))
        return emptyStore();
    try {
        const raw = readFileSync(file, 'utf8');
        if (!raw.trim())
            return emptyStore();
        const parsed = JSON.parse(raw);
        const v2 = parsed.version === 2 ? parsed : migrateV1toV2(parsed);
        const accounts = deduplicateByEmail(v2.accounts || []);
        const activeIndex = accounts.length === 0 ? -1 : Math.min(Math.max(v2.activeIndex ?? 0, 0), accounts.length - 1);
        return {
            version: 2,
            accounts,
            activeIndex,
            rotationIndex: Math.max(v2.rotationIndex || 0, 0)
        };
    }
    catch {
        return emptyStore();
    }
}
function writeStore(store) {
    ensureStoreDir();
    writeFileSync(storeFile(), JSON.stringify(store, null, 2), { mode: 0o600 });
}
export async function withStoreLock(fn) {
    ensureStoreDir();
    const file = storeFile();
    if (!existsSync(file))
        writeStore(emptyStore());
    const release = await lockfile.lock(file, {
        retries: { retries: 8, factor: 1.2, minTimeout: 20, maxTimeout: 120 },
        stale: 15_000,
        update: 2_000,
        realpath: false
    });
    try {
        const store = readStore();
        const result = await fn(store);
        writeStore(store);
        return result;
    }
    finally {
        await release();
    }
}
export function loadStore() {
    return readStore();
}
export function saveStore(store) {
    writeStore(store);
}
export function listAccounts() {
    const store = readStore();
    return store.accounts.map((account, index) => ({
        ...account,
        alias: accountAlias(account, index),
        usageCount: account.usageCount || 0
    }));
}
export function addAccount(account) {
    const store = readStore();
    const now = Date.now();
    const email = normalizeEmail(account.email);
    const next = {
        ...account,
        email,
        usageCount: 0,
        addedAt: account.addedAt || now,
        lastSeenAt: account.lastSeenAt || now,
        lastRefresh: account.lastRefresh || new Date(now).toISOString(),
        source: 'opencode'
    };
    if (email) {
        const existingIndex = store.accounts.findIndex((a) => normalizeEmail(a.email) === email);
        if (existingIndex >= 0) {
            store.accounts[existingIndex] = {
                ...store.accounts[existingIndex],
                ...next,
                usageCount: store.accounts[existingIndex].usageCount || 0
            };
            store.activeIndex = existingIndex;
            writeStore(store);
            return { store, index: existingIndex };
        }
    }
    store.accounts.push(next);
    const index = store.accounts.length - 1;
    store.activeIndex = index;
    writeStore(store);
    return { store, index };
}
export function updateAccount(index, updates) {
    const store = readStore();
    if (index < 0 || index >= store.accounts.length)
        return store;
    store.accounts[index] = { ...store.accounts[index], ...updates };
    writeStore(store);
    return store;
}
export function setActiveIndex(index) {
    const store = readStore();
    if (index < 0 || index >= store.accounts.length)
        return store;
    store.activeIndex = index;
    writeStore(store);
    return store;
}
export function removeAccount(index) {
    const store = readStore();
    if (index < 0 || index >= store.accounts.length)
        return store;
    store.accounts.splice(index, 1);
    if (store.accounts.length === 0) {
        store.activeIndex = -1;
        store.rotationIndex = 0;
    }
    else {
        store.activeIndex = Math.min(Math.max(store.activeIndex, 0), store.accounts.length - 1);
        store.rotationIndex = store.rotationIndex % store.accounts.length;
    }
    writeStore(store);
    return store;
}
export function findIndexByEmail(email) {
    const needle = normalizeEmail(email);
    if (!needle)
        return -1;
    const store = readStore();
    return store.accounts.findIndex((a) => normalizeEmail(a.email) === needle);
}
export function findIndexByAlias(alias) {
    const store = readStore();
    return store.accounts.findIndex((account, index) => accountAlias(account, index) === alias);
}
export function getStorePath() {
    return storeFile();
}
//# sourceMappingURL=store.js.map