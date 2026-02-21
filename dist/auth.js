import { generatePKCE } from '@openauthjs/openauth/pkce';
import { randomBytes } from 'node:crypto';
import * as http from 'node:http';
import * as net from 'node:net';
import * as url from 'node:url';
import { ProxyAgent } from 'undici';
import { addAccount, loadStore, withStoreLock } from './store.js';
const ISSUER = 'https://auth.openai.com';
const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
const USERINFO_URL = `${ISSUER}/userinfo`;
const DEVICE_CODE_URL = `${ISSUER}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${ISSUER}/api/accounts/deviceauth/token`;
const DEVICE_REDIRECT_URI = `${ISSUER}/deviceauth/callback`;
const DEVICE_VERIFY_URL = `${ISSUER}/codex/device`;
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_PORT = 1455;
const SCOPES = ['openid', 'profile', 'email', 'offline_access'];
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000;
let proxyCache = null;
function getDeviceUserAgent() {
    const explicit = process.env.OPENCODE_MULTI_AUTH_USER_AGENT?.trim();
    if (explicit)
        return explicit;
    const hostVersion = process.env.OPENCODE_VERSION?.trim() || 'unknown';
    return `opencode/${hostVersion}`;
}
function getNoProxyList() {
    return (process.env.NO_PROXY || process.env.no_proxy || '')
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
}
function isNoProxyHost(hostname) {
    const host = hostname.toLowerCase();
    const rules = getNoProxyList();
    if (rules.includes('*'))
        return true;
    return rules.some((rule) => {
        const normalized = rule.replace(/^\./, '');
        if (!normalized)
            return false;
        if (host === normalized)
            return true;
        return host.endsWith(`.${normalized}`);
    });
}
function resolveProxyForUrl(rawUrl) {
    const explicit = process.env.OPENCODE_MULTI_AUTH_PROXY_URL?.trim();
    if (explicit)
        return explicit;
    const parsed = new URL(rawUrl);
    if (isNoProxyHost(parsed.hostname))
        return null;
    if (parsed.protocol === 'https:') {
        return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy || null;
    }
    return process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy || null;
}
function getDispatcherForUrl(rawUrl) {
    const proxyUrl = resolveProxyForUrl(rawUrl);
    if (!proxyUrl)
        return undefined;
    if (proxyCache?.key === proxyUrl)
        return proxyCache.dispatcher;
    const dispatcher = new ProxyAgent(proxyUrl);
    proxyCache = { key: proxyUrl, dispatcher };
    return dispatcher;
}
async function fetchWithProxy(rawUrl, init) {
    const dispatcher = getDispatcherForUrl(rawUrl);
    if (!dispatcher)
        return fetch(rawUrl, init);
    return fetch(rawUrl, { ...(init || {}), dispatcher });
}
function decodeJwt(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        const decoded = Buffer.from(parts[1], 'base64').toString('utf8');
        return JSON.parse(decoded);
    }
    catch {
        return null;
    }
}
function expiresAt(tokens) {
    const claims = decodeJwt(tokens.access_token);
    if (claims?.exp)
        return claims.exp * 1000;
    return Date.now() + tokens.expires_in * 1000;
}
function toCredentials(account, index) {
    return {
        ...account,
        alias: account.email?.split('@')[0] || `account-${index}`,
        usageCount: account.usageCount || 0
    };
}
async function reserveRedirectPort(preferredPort) {
    const tryPort = (port) => new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            const address = server.address();
            const selected = typeof address === 'object' && address ? address.port : port;
            server.close(() => resolve(selected));
        });
    });
    try {
        return await tryPort(preferredPort);
    }
    catch {
        return await tryPort(0);
    }
}
function state() {
    return randomBytes(32).toString('base64url');
}
export async function createAuthorizationFlow() {
    const pkce = await generatePKCE();
    const redirectPort = await reserveRedirectPort(OAUTH_PORT);
    const redirectUri = `http://localhost:${redirectPort}/auth/callback`;
    const authUrl = new URL(AUTHORIZE_URL);
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES.join(' '));
    authUrl.searchParams.set('code_challenge', pkce.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('id_token_add_organizations', 'true');
    authUrl.searchParams.set('codex_cli_simplified_flow', 'true');
    authUrl.searchParams.set('originator', 'opencode');
    const oauthState = state();
    authUrl.searchParams.set('state', oauthState);
    return { pkce, state: oauthState, url: authUrl.toString(), redirectUri, redirectPort };
}
export async function createDeviceAuthorizationFlow() {
    const userAgent = getDeviceUserAgent();
    const response = await fetchWithProxy(DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': userAgent
        },
        body: JSON.stringify({ client_id: CLIENT_ID })
    });
    if (!response.ok) {
        const body = (await response.text().catch(() => '')).trim();
        throw new Error(`Failed to initiate device authorization: ${response.status}${body ? ` ${body}` : ''}`);
    }
    const data = (await response.json());
    const intervalSeconds = Math.max(Number.parseInt(data.interval || '5', 10) || 5, 1);
    return {
        deviceAuthId: data.device_auth_id,
        userCode: data.user_code,
        intervalMs: intervalSeconds * 1000,
        url: DEVICE_VERIFY_URL,
        instructions: `Enter code: ${data.user_code}`
    };
}
async function exchangeCodeForTokens(code, redirectUri, codeVerifier) {
    const response = await fetchWithProxy(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: CLIENT_ID,
            code_verifier: codeVerifier
        }).toString()
    });
    if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status}`);
    }
    return response.json();
}
async function saveTokens(tokens) {
    if (!tokens.refresh_token)
        throw new Error('No refresh token received');
    const now = Date.now();
    const idClaims = tokens.id_token ? decodeJwt(tokens.id_token) : null;
    const accessClaims = decodeJwt(tokens.access_token);
    let email = idClaims?.email || accessClaims?.email;
    try {
        const userinfo = await fetchWithProxy(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
        if (userinfo.ok) {
            const user = (await userinfo.json());
            email = user.email || email;
        }
    }
    catch {
        // ignore
    }
    const accountId = idClaims?.sub || accessClaims?.sub;
    const { store, index } = addAccount({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        accountId,
        email: email?.trim().toLowerCase(),
        expiresAt: expiresAt(tokens),
        lastRefresh: new Date(now).toISOString(),
        lastSeenAt: now,
        addedAt: now,
        source: 'opencode',
        authInvalid: false,
        authInvalidatedAt: undefined
    });
    return toCredentials(store.accounts[index], index);
}
export async function loginAccount(flow) {
    const active = flow || await createAuthorizationFlow();
    return new Promise((resolve, reject) => {
        let server = null;
        const cleanup = () => {
            if (!server)
                return;
            server.close();
            server = null;
        };
        server = http.createServer(async (req, res) => {
            if (!req.url?.startsWith('/auth/callback')) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }
            const parsed = url.parse(req.url, true);
            const code = parsed.query.code;
            const returned = parsed.query.state;
            const error = parsed.query.error;
            const errorDescription = parsed.query.error_description;
            if (error) {
                res.writeHead(400);
                res.end(`Authorization failed: ${errorDescription || error}`);
                cleanup();
                reject(new Error(errorDescription || error));
                return;
            }
            if (!code) {
                res.writeHead(400);
                res.end('No authorization code');
                cleanup();
                reject(new Error('No authorization code'));
                return;
            }
            if (returned && returned !== active.state) {
                res.writeHead(400);
                res.end('Invalid state');
                cleanup();
                reject(new Error('Invalid state'));
                return;
            }
            try {
                const tokens = await exchangeCodeForTokens(code, active.redirectUri, active.pkce.verifier);
                const account = await saveTokens(tokens);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body><h1>Authenticated</h1><p>You can close this tab.</p></body></html>');
                cleanup();
                resolve(account);
            }
            catch (err) {
                res.writeHead(500);
                res.end('Authentication failed');
                cleanup();
                reject(err);
            }
        });
        server.listen(active.redirectPort, () => {
            if (!flow) {
                console.log(`\nOpen URL:\n${active.url}\n`);
            }
        });
        server.on('error', (err) => reject(err));
        setTimeout(() => {
            cleanup();
            reject(new Error('Login timeout'));
        }, 5 * 60 * 1000);
    });
}
export async function loginAccountHeadless(flow) {
    const userAgent = getDeviceUserAgent();
    while (true) {
        const response = await fetchWithProxy(DEVICE_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': userAgent
            },
            body: JSON.stringify({ device_auth_id: flow.deviceAuthId, user_code: flow.userCode })
        });
        if (response.ok) {
            const data = (await response.json());
            const tokens = await exchangeCodeForTokens(data.authorization_code, DEVICE_REDIRECT_URI, data.code_verifier);
            return saveTokens(tokens);
        }
        if (response.status !== 403 && response.status !== 404) {
            const body = (await response.text().catch(() => '')).trim();
            throw new Error(`Device authorization failed: ${response.status}${body ? ` ${body}` : ''}`);
        }
        await new Promise((resolve) => setTimeout(resolve, flow.intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS));
    }
}
export async function refreshToken(index) {
    return withStoreLock(async (store) => {
        if (index < 0 || index >= store.accounts.length)
            return null;
        const account = store.accounts[index];
        if (!account.refreshToken)
            return null;
        const response = await fetchWithProxy(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: CLIENT_ID,
                refresh_token: account.refreshToken
            }).toString()
        });
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                account.authInvalid = true;
                account.authInvalidatedAt = Date.now();
            }
            return null;
        }
        const tokens = (await response.json());
        account.accessToken = tokens.access_token;
        account.refreshToken = tokens.refresh_token || account.refreshToken;
        account.idToken = tokens.id_token || account.idToken;
        account.expiresAt = expiresAt(tokens);
        account.lastRefresh = new Date().toISOString();
        account.authInvalid = false;
        account.authInvalidatedAt = undefined;
        return toCredentials(account, index);
    });
}
export async function ensureValidToken(index) {
    const store = loadStore();
    if (index < 0 || index >= store.accounts.length)
        return null;
    const account = store.accounts[index];
    const bufferMs = 5 * 60 * 1000;
    if (account.expiresAt > Date.now() + bufferMs)
        return account.accessToken;
    const refreshed = await refreshToken(index);
    return refreshed?.accessToken || null;
}
//# sourceMappingURL=auth.js.map