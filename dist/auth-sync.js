import { addAccount, findIndexByEmail, findIndexByToken, updateAccount } from './store.js';
import { decodeJwtPayload, getAccountIdFromClaims, getEmailFromClaims } from './codex-auth.js';
const OPENAI_ISSUER = 'https://auth.openai.com';
const AUTH_SYNC_COOLDOWN_MS = 10_000;
let lastSyncedAccess = null;
let lastSyncAt = 0;
async function fetchEmail(accessToken) {
    try {
        const res = await fetch(`${OPENAI_ISSUER}/userinfo`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok)
            return undefined;
        const user = (await res.json());
        return user.email;
    }
    catch {
        return undefined;
    }
}
export async function syncAuthFromOpenCode(getAuth) {
    const now = Date.now();
    if (now - lastSyncAt < AUTH_SYNC_COOLDOWN_MS)
        return;
    lastSyncAt = now;
    let auth = null;
    try {
        auth = await getAuth();
    }
    catch {
        return;
    }
    if (!auth || auth.type !== 'oauth')
        return;
    if (!auth.access)
        return;
    if (auth.access === lastSyncedAccess)
        return;
    lastSyncedAccess = auth.access;
    const accessClaims = decodeJwtPayload(auth.access);
    const derivedEmail = getEmailFromClaims(accessClaims);
    const derivedAccountId = getAccountIdFromClaims(accessClaims);
    // Try to find existing account by token
    const tokenIdx = findIndexByToken(auth.access, auth.refresh);
    if (tokenIdx >= 0) {
        updateAccount(tokenIdx, {
            accessToken: auth.access,
            refreshToken: auth.refresh,
            expiresAt: auth.expires,
            email: derivedEmail,
            accountId: derivedAccountId
        });
        return;
    }
    // Try to find by email
    const email = (await fetchEmail(auth.access)) || derivedEmail;
    if (email) {
        const emailIdx = findIndexByEmail(email);
        if (emailIdx >= 0) {
            updateAccount(emailIdx, {
                accessToken: auth.access,
                refreshToken: auth.refresh,
                expiresAt: auth.expires,
                email
            });
            return;
        }
    }
    // New account — addAccount will dedup by email if needed
    addAccount({
        accessToken: auth.access,
        refreshToken: auth.refresh,
        expiresAt: auth.expires,
        email,
        accountId: derivedAccountId,
        source: 'opencode'
    });
}
//# sourceMappingURL=auth-sync.js.map