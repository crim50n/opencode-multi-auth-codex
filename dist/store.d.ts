import type { AccountStore, AccountCredentials, StoredAccount } from './types.js';
export declare function loadStore(): AccountStore;
export declare function saveStore(store: AccountStore): void;
export declare function getStoreDiagnostics(): {
    storeDir: string;
    storeFile: string;
    locked: boolean;
    encrypted: boolean;
    error: string | null;
};
/** Find account index by email. Returns -1 if not found. */
export declare function findIndexByEmail(email: string): number;
/** Find account index by refresh token. Returns -1 if not found. */
export declare function findIndexByToken(access?: string, refresh?: string): number;
/** Add or update an account. Deduplicates by email. Returns the store and the account's index. */
export declare function addAccount(creds: Omit<StoredAccount, 'usageCount'>): {
    store: AccountStore;
    index: number;
};
/** Remove account by index. Returns updated store. */
export declare function removeAccount(index: number): AccountStore;
/** Remove account by email. Returns updated store. */
export declare function removeAccountByEmail(email: string): AccountStore;
/** Update account at index. Returns updated store. */
export declare function updateAccount(index: number, updates: Partial<StoredAccount>): AccountStore;
/** Update account by alias (backward compat for web.ts etc.). */
export declare function updateAccountByAlias(alias: string, updates: Partial<StoredAccount>): AccountStore;
/** Set active account by index. */
export declare function setActiveIndex(index: number): AccountStore;
/** Get the currently active account (with computed alias). */
export declare function getActiveAccount(): AccountCredentials | null;
/** List all accounts with computed aliases. */
export declare function listAccounts(): AccountCredentials[];
export declare function getStorePath(): string;
export declare function getStoreStatus(): {
    locked: boolean;
    encrypted: boolean;
    error: string | null;
};
/** Remove account by alias (backward compat for web.ts etc.). */
export declare function removeAccountByAlias(alias: string): AccountStore;
/** Resolve alias to index (backward compat). Returns -1 if not found. */
export declare function resolveAlias(alias: string): number;
export { setActiveIndex as setActiveAlias };
//# sourceMappingURL=store.d.ts.map