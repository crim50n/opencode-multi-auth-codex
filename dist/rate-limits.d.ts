import type { AccountRateLimits } from './types.js';
type RateLimitUpdate = AccountRateLimits;
export declare function extractRateLimitUpdate(headers: Headers): RateLimitUpdate | null;
export declare function mergeRateLimits(existing: AccountRateLimits | undefined, update: RateLimitUpdate): AccountRateLimits;
export {};
//# sourceMappingURL=rate-limits.d.ts.map