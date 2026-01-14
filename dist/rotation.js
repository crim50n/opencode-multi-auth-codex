import { loadStore, saveStore, updateAccount } from './store.js';
import { ensureValidToken } from './auth.js';
export async function getNextAccount(config) {
    const store = loadStore();
    const aliases = Object.keys(store.accounts);
    if (aliases.length === 0) {
        console.error('[multi-auth] No accounts configured. Run: opencode-multi-auth add <alias>');
        return null;
    }
    const now = Date.now();
    const availableAliases = aliases.filter(alias => {
        const acc = store.accounts[alias];
        return !acc.rateLimitedUntil || acc.rateLimitedUntil < now;
    });
    if (availableAliases.length === 0) {
        console.warn('[multi-auth] All accounts rate-limited. Using first available.');
        availableAliases.push(aliases[0]);
    }
    let selectedAlias;
    switch (config.rotationStrategy) {
        case 'round-robin': {
            const idx = store.rotationIndex % availableAliases.length;
            selectedAlias = availableAliases[idx];
            store.rotationIndex = (store.rotationIndex + 1) % availableAliases.length;
            break;
        }
        case 'least-used': {
            selectedAlias = availableAliases.reduce((min, alias) => {
                const acc = store.accounts[alias];
                const minAcc = store.accounts[min];
                return acc.usageCount < minAcc.usageCount ? alias : min;
            }, availableAliases[0]);
            break;
        }
        case 'random': {
            selectedAlias = availableAliases[Math.floor(Math.random() * availableAliases.length)];
            break;
        }
        default:
            selectedAlias = availableAliases[0];
    }
    const token = await ensureValidToken(selectedAlias);
    if (!token) {
        console.error(`[multi-auth] Failed to get valid token for ${selectedAlias}`);
        return null;
    }
    updateAccount(selectedAlias, {
        usageCount: store.accounts[selectedAlias].usageCount + 1,
        lastUsed: now
    });
    store.activeAlias = selectedAlias;
    store.lastRotation = now;
    saveStore(store);
    return {
        account: store.accounts[selectedAlias],
        token
    };
}
export function markRateLimited(alias, cooldownMs) {
    updateAccount(alias, {
        rateLimitedUntil: Date.now() + cooldownMs
    });
    console.warn(`[multi-auth] Account ${alias} marked rate-limited for ${cooldownMs / 1000}s`);
}
export function clearRateLimit(alias) {
    updateAccount(alias, {
        rateLimitedUntil: undefined
    });
}
//# sourceMappingURL=rotation.js.map