const WINDOW_PATTERNS = [
    { key: 'fiveHour', patterns: ['5h', '5hr', '5hour', '5hours', '5-hour'] },
    { key: 'weekly', patterns: ['week', 'weekly', '1w', '7d', '7day', '7days', '7-day', '1-week'] }
];
function parseNumber(value) {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (!match)
        return undefined;
    const num = Number(match[0]);
    if (Number.isNaN(num))
        return undefined;
    return num;
}
function parseReset(value, now) {
    const num = parseNumber(value);
    if (num === undefined)
        return undefined;
    if (num > 1e12)
        return num;
    if (num > 1e9)
        return num * 1000;
    return now + num * 1000;
}
function parseTimestamp(value) {
    const num = parseNumber(value);
    if (num !== undefined) {
        if (num > 1e12)
            return num;
        if (num > 1e9)
            return num * 1000;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed))
        return parsed;
    return undefined;
}
function matchWindowKey(headerName) {
    for (const entry of WINDOW_PATTERNS) {
        if (entry.patterns.some((pattern) => headerName.includes(pattern))) {
            return entry.key;
        }
    }
    return null;
}
function ensureWindow(update, key, now) {
    if (!update[key]) {
        update[key] = { updatedAt: now };
    }
    else if (!update[key]?.updatedAt) {
        update[key] = { ...update[key], updatedAt: now };
    }
    return update[key];
}
export function extractRateLimitUpdate(headers) {
    const update = {};
    const now = Date.now();
    for (const [rawName, value] of headers.entries()) {
        const name = rawName.toLowerCase();
        if (name.startsWith('x-codex-')) {
            if (name.startsWith('x-codex-primary-') || name.startsWith('x-codex-secondary-')) {
                const windowKey = name.startsWith('x-codex-primary-') ? 'fiveHour' : 'weekly';
                const window = ensureWindow(update, windowKey, now);
                if (name.endsWith('used-percent')) {
                    const usedPercent = parseNumber(value);
                    if (usedPercent !== undefined) {
                        const remaining = Math.max(0, 100 - usedPercent);
                        window.limit = 100;
                        window.remaining = remaining;
                    }
                    continue;
                }
                if (name.endsWith('reset-at')) {
                    const resetAt = parseTimestamp(value);
                    if (resetAt !== undefined)
                        window.resetAt = resetAt;
                    continue;
                }
                if (name.endsWith('window-minutes')) {
                    // Window length is informational; not shown in UI yet.
                    continue;
                }
            }
            continue;
        }
        if (name.startsWith('x-ratelimit-')) {
            const windowKey = matchWindowKey(name);
            if (!windowKey)
                continue;
            const window = ensureWindow(update, windowKey, now);
            if (name.includes('limit')) {
                const limit = parseNumber(value);
                if (limit !== undefined)
                    window.limit = limit;
                continue;
            }
            if (name.includes('remaining')) {
                const remaining = parseNumber(value);
                if (remaining !== undefined)
                    window.remaining = remaining;
                continue;
            }
            if (name.includes('reset')) {
                const resetAt = parseReset(value, now);
                if (resetAt !== undefined)
                    window.resetAt = resetAt;
            }
        }
    }
    return Object.keys(update).length > 0 ? update : null;
}
export function mergeRateLimits(existing, update) {
    return {
        fiveHour: { ...(existing?.fiveHour || {}), ...(update.fiveHour || {}) },
        weekly: { ...(existing?.weekly || {}), ...(update.weekly || {}) }
    };
}
//# sourceMappingURL=rate-limits.js.map