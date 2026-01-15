import { mergeRateLimits } from './rate-limits.js';
import { loadStore, updateAccount } from './store.js';
import { probeRateLimitsForAccount } from './probe-limits.js';
export async function refreshRateLimitsForAccount(account) {
    const probe = await probeRateLimitsForAccount(account);
    if (!probe.rateLimits) {
        return {
            alias: account.alias,
            updated: false,
            error: probe.error || 'Probe failed'
        };
    }
    updateAccount(account.alias, {
        rateLimits: mergeRateLimits(account.rateLimits, probe.rateLimits)
    });
    return { alias: account.alias, updated: true };
}
export async function refreshRateLimits(accounts, alias) {
    if (alias) {
        const account = accounts.find((acc) => acc.alias === alias);
        if (!account) {
            return [{ alias, updated: false, error: 'Unknown alias' }];
        }
        return [await refreshRateLimitsForAccount(account)];
    }
    const store = loadStore();
    const results = [];
    for (const account of accounts) {
        results.push(await refreshRateLimitsForAccount(account));
    }
    if (results.length === 0 && !store.activeAlias) {
        return [{ alias: 'active', updated: false, error: 'No accounts configured' }];
    }
    return results;
}
//# sourceMappingURL=limits-refresh.js.map