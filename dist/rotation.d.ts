import type { AccountCredentials, PluginConfig } from './types.js';
export interface RotationResult {
    account: AccountCredentials;
    token: string;
    index: number;
}
export declare function getNextAccount(config: PluginConfig): Promise<RotationResult | null>;
export declare function markRateLimited(index: number, cooldownMs: number): void;
export declare function markModelUnsupported(index: number, cooldownMs: number): void;
export declare function markWorkspaceDeactivated(index: number, cooldownMs: number): void;
export declare function markAuthInvalid(index: number): void;
//# sourceMappingURL=rotation.d.ts.map