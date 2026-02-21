export interface StoredAccount {
    email?: string;
    accessToken: string;
    refreshToken: string;
    idToken?: string;
    accountId?: string;
    expiresAt: number;
    lastRefresh: string;
    usageCount: number;
    enabled?: boolean;
    lastUsed?: number;
    lastSeenAt?: number;
    addedAt?: number;
    source?: 'opencode';
    authInvalid?: boolean;
    authInvalidatedAt?: number;
    rateLimitedUntil?: number;
    modelUnsupportedUntil?: number;
    workspaceDeactivatedUntil?: number;
}
export interface AccountCredentials extends StoredAccount {
    alias: string;
}
export interface AccountStore {
    version: 2;
    accounts: StoredAccount[];
    activeIndex: number;
    rotationIndex: number;
}
export interface LegacyAccountV1 extends StoredAccount {
    alias?: string;
}
export interface AccountStoreV1 {
    version?: 1;
    accounts: Record<string, LegacyAccountV1>;
    activeAlias?: string | null;
    rotationIndex?: number;
}
export interface PluginConfig {
    rotationStrategy: 'sticky' | 'round-robin';
    rateLimitCooldownMs: number;
    modelUnsupportedCooldownMs: number;
    workspaceDeactivatedCooldownMs: number;
    maxRetries: number;
}
export declare const DEFAULT_CONFIG: PluginConfig;
//# sourceMappingURL=types.d.ts.map