import { getStoreDiagnostics, loadStore, saveStore, updateAccount } from './store.js';
import { ensureValidToken } from './auth.js';
function shuffled(input) {
    const a = [...input];
    for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function computeAlias(account, index) {
    if (account.email) {
        return account.email.split('@')[0] || `account-${index}`;
    }
    return `account-${index}`;
}
export async function getNextAccount(config) {
    let store = loadStore();
    const accountCount = store.accounts.length;
    if (accountCount === 0) {
        const diag = getStoreDiagnostics();
        const extra = diag.error ? ` (${diag.error})` : '';
        console.error(`[multi-auth] No accounts configured. Run: opencode-multi-auth add${extra}`);
        if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
            console.error(`[multi-auth] store file: ${diag.storeFile}`);
        }
        return null;
    }
    const now = Date.now();
    // Build list of available indices
    const availableIndices = [];
    for (let i = 0; i < accountCount; i++) {
        const acc = store.accounts[i];
        const notRateLimited = !acc.rateLimitedUntil || acc.rateLimitedUntil < now;
        const notModelUnsupported = !acc.modelUnsupportedUntil || acc.modelUnsupportedUntil < now;
        const notWorkspaceDeactivated = !acc.workspaceDeactivatedUntil || acc.workspaceDeactivatedUntil < now;
        const notInvalidated = !acc.authInvalid;
        const enabled = acc.enabled !== false;
        if (notRateLimited && notModelUnsupported && notWorkspaceDeactivated && notInvalidated && enabled) {
            availableIndices.push(i);
        }
    }
    if (availableIndices.length === 0) {
        console.warn('[multi-auth] No available accounts (rate-limited, disabled, or invalidated).');
        return null;
    }
    const tokenFailureCooldownMs = (() => {
        const raw = process.env.OPENCODE_MULTI_AUTH_TOKEN_FAILURE_COOLDOWN_MS;
        const parsed = raw ? Number(raw) : NaN;
        if (Number.isFinite(parsed) && parsed > 0)
            return parsed;
        return 60_000;
    })();
    const buildCandidates = () => {
        switch (config.rotationStrategy) {
            case 'least-used': {
                const sorted = [...availableIndices].sort((a, b) => {
                    const aa = store.accounts[a];
                    const bb = store.accounts[b];
                    const usageDiff = (aa?.usageCount || 0) - (bb?.usageCount || 0);
                    if (usageDiff !== 0)
                        return usageDiff;
                    const lastDiff = (aa?.lastUsed || 0) - (bb?.lastUsed || 0);
                    if (lastDiff !== 0)
                        return lastDiff;
                    return a - b;
                });
                return { indices: sorted };
            }
            case 'random': {
                return { indices: shuffled(availableIndices) };
            }
            case 'round-robin':
            default: {
                const start = store.rotationIndex % availableIndices.length;
                const rr = availableIndices.map((_, i) => availableIndices[(start + i) % availableIndices.length]);
                const nextRotation = (selected) => {
                    const pos = availableIndices.indexOf(selected);
                    if (pos < 0)
                        return store.rotationIndex;
                    return (pos + 1) % availableIndices.length;
                };
                return { indices: rr, nextRotation };
            }
        }
    };
    const { indices: candidates, nextRotation } = buildCandidates();
    for (const candidateIdx of candidates) {
        const token = await ensureValidToken(candidateIdx);
        if (!token) {
            // Don't hard-fail the whole system on a single broken account.
            // Put it on a short cooldown so rotation can keep working.
            store = updateAccount(candidateIdx, {
                rateLimitedUntil: now + tokenFailureCooldownMs,
                limitError: '[multi-auth] Token unavailable (refresh failed?)',
                lastLimitErrorAt: now
            });
            continue;
        }
        store = updateAccount(candidateIdx, {
            usageCount: (store.accounts[candidateIdx]?.usageCount || 0) + 1,
            lastUsed: now,
            limitError: undefined
        });
        store.activeIndex = candidateIdx;
        store.lastRotation = now;
        if (nextRotation) {
            store.rotationIndex = nextRotation(candidateIdx);
        }
        saveStore(store);
        const acc = store.accounts[candidateIdx];
        return {
            account: {
                ...acc,
                alias: computeAlias(acc, candidateIdx),
                usageCount: acc.usageCount ?? 0
            },
            token,
            index: candidateIdx
        };
    }
    console.error('[multi-auth] No available accounts (token refresh failed on all candidates).');
    return null;
}
export function markRateLimited(index, cooldownMs) {
    const store = loadStore();
    const label = store.accounts[index]?.email || `#${index}`;
    updateAccount(index, {
        rateLimitedUntil: Date.now() + cooldownMs
    });
    console.warn(`[multi-auth] Account ${label} marked rate-limited for ${cooldownMs / 1000}s`);
}
export function clearRateLimit(index) {
    updateAccount(index, {
        rateLimitedUntil: undefined
    });
}
export function markModelUnsupported(index, cooldownMs, info) {
    const store = loadStore();
    const label = store.accounts[index]?.email || `#${index}`;
    updateAccount(index, {
        modelUnsupportedUntil: Date.now() + cooldownMs,
        modelUnsupportedAt: Date.now(),
        modelUnsupportedModel: info?.model,
        modelUnsupportedError: info?.error
    });
    const extra = info?.model ? ` (model=${info.model})` : '';
    console.warn(`[multi-auth] Account ${label} marked model-unsupported for ${cooldownMs / 1000}s${extra}`);
}
export function clearModelUnsupported(index) {
    updateAccount(index, {
        modelUnsupportedUntil: undefined,
        modelUnsupportedAt: undefined,
        modelUnsupportedModel: undefined,
        modelUnsupportedError: undefined
    });
}
export function markWorkspaceDeactivated(index, cooldownMs, info) {
    const store = loadStore();
    const label = store.accounts[index]?.email || `#${index}`;
    updateAccount(index, {
        workspaceDeactivatedUntil: Date.now() + cooldownMs,
        workspaceDeactivatedAt: Date.now(),
        workspaceDeactivatedError: info?.error
    });
    console.warn(`[multi-auth] Account ${label} marked workspace-deactivated for ${cooldownMs / 1000}s`);
}
export function clearWorkspaceDeactivated(index) {
    updateAccount(index, {
        workspaceDeactivatedUntil: undefined,
        workspaceDeactivatedAt: undefined,
        workspaceDeactivatedError: undefined
    });
}
export function markAuthInvalid(index) {
    const store = loadStore();
    const label = store.accounts[index]?.email || `#${index}`;
    updateAccount(index, {
        authInvalid: true,
        authInvalidatedAt: Date.now()
    });
    console.warn(`[multi-auth] Account ${label} marked invalidated`);
}
export function clearAuthInvalid(index) {
    updateAccount(index, {
        authInvalid: false,
        authInvalidatedAt: undefined
    });
}
//# sourceMappingURL=rotation.js.map