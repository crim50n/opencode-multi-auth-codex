import type { AccountCredentials, AccountRateLimits } from './types.js';
export interface ProbeResult {
    rateLimits?: AccountRateLimits;
    eventTs?: number;
    sourceFile?: string;
    error?: string;
}
export declare function probeRateLimitsForAccount(account: AccountCredentials): Promise<ProbeResult>;
export declare function getProbeHomeRoot(): string;
//# sourceMappingURL=probe-limits.d.ts.map