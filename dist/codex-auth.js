import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addAccount, findIndexByEmail, findIndexByToken, loadStore, setActiveIndex, updateAccount } from './store.js';
const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_AUTH_FILE = path.join(CODEX_DIR, 'auth.json');
let lastFingerprint = null;
let lastAuthError = null;
export function getCodexAuthPath() {
    return CODEX_AUTH_FILE;
}
function ensureDir() {
    if (!fs.existsSync(CODEX_DIR)) {
        fs.mkdirSync(CODEX_DIR, { recursive: true, mode: 0o700 });
    }
}
export function loadCodexAuthFile() {
    lastAuthError = null;
    if (!fs.existsSync(CODEX_AUTH_FILE))
        return null;
    try {
        const raw = fs.readFileSync(CODEX_AUTH_FILE, 'utf-8');
        return JSON.parse(raw);
    }
    catch (err) {
        lastAuthError = 'Failed to parse codex auth.json';
        console.error('[multi-auth] Failed to parse codex auth.json:', err);
        return null;
    }
}
export function writeCodexAuthFile(auth) {
    ensureDir();
    fs.writeFileSync(CODEX_AUTH_FILE, JSON.stringify(auth, null, 2), {
        mode: 0o600
    });
}
export function decodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
        const decoded = Buffer.from(padded, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    }
    catch {
        return null;
    }
}
export function getEmailFromClaims(claims) {
    if (!claims)
        return undefined;
    if (typeof claims.email === 'string')
        return claims.email;
    const profile = claims['https://api.openai.com/profile'];
    if (profile?.email)
        return profile.email;
    return undefined;
}
export function getAccountIdFromClaims(claims) {
    if (!claims)
        return undefined;
    const auth = claims['https://api.openai.com/auth'];
    return auth?.chatgpt_account_id;
}
export function getExpiryFromClaims(claims) {
    if (!claims)
        return undefined;
    const exp = claims.exp;
    if (typeof exp === 'number')
        return exp * 1000;
    return undefined;
}
function fingerprintTokens(tokens) {
    return `${tokens.access_token}:${tokens.refresh_token}:${tokens.id_token}`;
}
export function syncCodexAuthFile() {
    const auth = loadCodexAuthFile();
    if (!auth?.tokens?.access_token || !auth.tokens.refresh_token || !auth.tokens.id_token) {
        return { index: null, added: false, updated: false };
    }
    const fingerprint = fingerprintTokens(auth.tokens);
    const accessClaims = decodeJwtPayload(auth.tokens.access_token);
    const idClaims = decodeJwtPayload(auth.tokens.id_token);
    const email = getEmailFromClaims(idClaims) || getEmailFromClaims(accessClaims);
    const accountId = auth.tokens.account_id || getAccountIdFromClaims(idClaims) || getAccountIdFromClaims(accessClaims);
    const expiresAt = getExpiryFromClaims(accessClaims) || getExpiryFromClaims(idClaims) || Date.now();
    // Try to find by token first
    const tokenIdx = findIndexByToken(auth.tokens.access_token, auth.tokens.refresh_token);
    if (tokenIdx >= 0 && lastFingerprint === fingerprint) {
        return { index: tokenIdx, added: false, updated: false };
    }
    lastFingerprint = fingerprint;
    const update = {
        accessToken: auth.tokens.access_token,
        refreshToken: auth.tokens.refresh_token,
        idToken: auth.tokens.id_token,
        accountId,
        expiresAt,
        email,
        lastRefresh: auth.last_refresh,
        lastSeenAt: Date.now(),
        source: 'codex'
    };
    if (tokenIdx >= 0) {
        updateAccount(tokenIdx, update);
        setActiveIndex(tokenIdx);
        return { index: tokenIdx, added: false, updated: true };
    }
    // Try by email
    if (email) {
        const emailIdx = findIndexByEmail(email);
        if (emailIdx >= 0) {
            updateAccount(emailIdx, update);
            setActiveIndex(emailIdx);
            return { index: emailIdx, added: false, updated: true };
        }
    }
    // New account — addAccount deduplicates by email
    const { index: newIndex } = addAccount(update);
    setActiveIndex(newIndex);
    return { index: newIndex, added: true, updated: true };
}
export function getCodexAuthStatus() {
    return { error: lastAuthError };
}
export function writeCodexAuthForAlias(alias) {
    // Backward compat: accept alias or email or index
    const accounts = loadStore();
    let index = -1;
    // Try as number index
    const asNum = Number(alias);
    if (Number.isInteger(asNum) && asNum >= 0 && asNum < accounts.accounts.length) {
        index = asNum;
    }
    else {
        // Try as email
        index = accounts.accounts.findIndex((acc) => acc.email === alias);
        if (index < 0) {
            // Try as computed alias
            const computed = accounts.accounts.findIndex((acc) => {
                const a = acc.email?.split('@')[0];
                return a === alias;
            });
            if (computed >= 0)
                index = computed;
        }
    }
    if (index < 0) {
        throw new Error(`Unknown account: ${alias}`);
    }
    const account = accounts.accounts[index];
    if (!account.accessToken || !account.refreshToken || !account.idToken) {
        throw new Error('Missing token data for account');
    }
    const current = loadCodexAuthFile();
    const authFile = {
        OPENAI_API_KEY: current?.OPENAI_API_KEY ?? null,
        tokens: {
            id_token: account.idToken,
            access_token: account.accessToken,
            refresh_token: account.refreshToken,
            account_id: account.accountId
        },
        last_refresh: new Date().toISOString()
    };
    writeCodexAuthFile(authFile);
    setActiveIndex(index);
    updateAccount(index, {
        lastRefresh: authFile.last_refresh,
        lastSeenAt: Date.now(),
        source: 'codex'
    });
}
//# sourceMappingURL=codex-auth.js.map