import type { AccountCredentials, DEFAULT_CONFIG } from './types.js';
export interface RotationResult {
    account: AccountCredentials;
    token: string;
    index: number;
}
export declare function getNextAccount(config: typeof DEFAULT_CONFIG): Promise<RotationResult | null>;
export declare function markRateLimited(index: number, cooldownMs: number): void;
export declare function clearRateLimit(index: number): void;
export declare function markModelUnsupported(index: number, cooldownMs: number, info?: {
    model?: string;
    error?: string;
}): void;
export declare function clearModelUnsupported(index: number): void;
export declare function markWorkspaceDeactivated(index: number, cooldownMs: number, info?: {
    error?: string;
}): void;
export declare function clearWorkspaceDeactivated(index: number): void;
export declare function markAuthInvalid(index: number): void;
export declare function clearAuthInvalid(index: number): void;
//# sourceMappingURL=rotation.d.ts.map