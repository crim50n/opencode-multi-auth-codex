export interface AccountCredentials {
    alias: string;
    accessToken: string;
    refreshToken: string;
    idToken?: string;
    accountId?: string;
    expiresAt: number;
    email?: string;
    lastRefresh?: string;
    lastSeenAt?: number;
    lastActiveUntil?: number;
    lastUsed?: number;
    usageCount: number;
    rateLimitedUntil?: number;
    rateLimits?: AccountRateLimits;
    source?: 'opencode' | 'codex';
}
export interface RateLimitWindow {
    limit?: number;
    remaining?: number;
    resetAt?: number;
    updatedAt?: number;
}
export interface AccountRateLimits {
    fiveHour?: RateLimitWindow;
    weekly?: RateLimitWindow;
}
export interface AccountStore {
    accounts: Record<string, AccountCredentials>;
    activeAlias: string | null;
    rotationIndex: number;
    lastRotation: number;
}
export interface OpenAIModel {
    id: string;
    object: string;
    created: number;
    owned_by: string;
}
export interface PluginConfig {
    rotationStrategy: 'round-robin' | 'least-used' | 'random';
    autoRefreshTokens: boolean;
    rateLimitCooldownMs: number;
    modelFilter: RegExp;
}
export interface ProviderModel {
    name: string;
    limit: {
        context: number;
        output: number;
    };
    modalities: {
        input: string[];
        output: string[];
    };
    options: {
        reasoningEffort: string;
        reasoningSummary: string;
        textVerbosity: string;
        include: string[];
        store: boolean;
    };
}
export declare const DEFAULT_CONFIG: PluginConfig;
//# sourceMappingURL=types.d.ts.map