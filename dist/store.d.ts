import type { AccountCredentials, AccountStore, StoredAccount } from './types.js';
export declare function withStoreLock<T>(fn: (store: AccountStore) => T | Promise<T>): Promise<T>;
export declare function loadStore(): AccountStore;
export declare function saveStore(store: AccountStore): void;
export declare function listAccounts(): AccountCredentials[];
export declare function addAccount(account: Omit<StoredAccount, 'usageCount'>): {
    store: AccountStore;
    index: number;
};
export declare function updateAccount(index: number, updates: Partial<StoredAccount>): AccountStore;
export declare function setActiveIndex(index: number): AccountStore;
export declare function removeAccount(index: number): AccountStore;
export declare function findIndexByEmail(email: string): number;
export declare function findIndexByAlias(alias: string): number;
export declare function getStorePath(): string;
//# sourceMappingURL=store.d.ts.map