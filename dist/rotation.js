import { ensureValidToken } from './auth.js';
import { loadStore, updateAccount, withStoreLock } from './store.js';
function toAlias(email, index) {
    if (email)
        return email.split('@')[0] || `account-${index}`;
    return `account-${index}`;
}
function isAvailable(now, account) {
    if (account.enabled === false)
        return false;
    if (account.authInvalid)
        return false;
    if ((account.rateLimitedUntil || 0) > now)
        return false;
    if ((account.modelUnsupportedUntil || 0) > now)
        return false;
    if ((account.workspaceDeactivatedUntil || 0) > now)
        return false;
    return true;
}
export async function getNextAccount(config) {
    const store = loadStore();
    if (store.accounts.length === 0)
        return null;
    const now = Date.now();
    const available = store.accounts
        .map((account, index) => ({ account, index }))
        .filter((entry) => isAvailable(now, entry.account));
    if (available.length === 0) {
        console.warn('[multi-auth] No available accounts (rate-limited, disabled, or invalidated).');
        return null;
    }
    const candidates = (() => {
        if (config.rotationStrategy === 'sticky' && store.activeIndex >= 0) {
            const sticky = available.find((entry) => entry.index === store.activeIndex);
            if (sticky)
                return [sticky, ...available.filter((entry) => entry.index !== sticky.index)];
        }
        if (config.rotationStrategy === 'round-robin') {
            const start = store.rotationIndex % available.length;
            return available.map((_, i) => available[(start + i) % available.length]);
        }
        return available;
    })();
    for (const candidate of candidates) {
        const token = await ensureValidToken(candidate.index);
        if (!token)
            continue;
        const updated = await withStoreLock((locked) => {
            if (!locked.accounts[candidate.index])
                return null;
            const account = locked.accounts[candidate.index];
            account.usageCount = (account.usageCount || 0) + 1;
            account.lastUsed = now;
            locked.activeIndex = candidate.index;
            if (config.rotationStrategy === 'round-robin' && locked.accounts.length > 0) {
                const availableLocked = locked.accounts
                    .map((a, i) => ({ a, i }))
                    .filter((entry) => isAvailable(now, entry.a));
                const pos = availableLocked.findIndex((entry) => entry.i === candidate.index);
                locked.rotationIndex = pos < 0 ? 0 : (pos + 1) % Math.max(availableLocked.length, 1);
            }
            return {
                ...account,
                alias: toAlias(account.email, candidate.index),
                usageCount: account.usageCount || 0
            };
        });
        if (!updated)
            continue;
        return { account: updated, token, index: candidate.index };
    }
    console.error('[multi-auth] No available accounts (token refresh failed on all candidates).');
    return null;
}
export function markRateLimited(index, cooldownMs) {
    updateAccount(index, { rateLimitedUntil: Date.now() + cooldownMs });
}
export function markModelUnsupported(index, cooldownMs) {
    updateAccount(index, { modelUnsupportedUntil: Date.now() + cooldownMs });
}
export function markWorkspaceDeactivated(index, cooldownMs) {
    updateAccount(index, { workspaceDeactivatedUntil: Date.now() + cooldownMs });
}
export function markAuthInvalid(index) {
    updateAccount(index, { authInvalid: true, authInvalidatedAt: Date.now() });
}
//# sourceMappingURL=rotation.js.map