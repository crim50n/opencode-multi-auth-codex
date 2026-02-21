import { createAuthorizationFlow, createDeviceAuthorizationFlow, loginAccount, loginAccountHeadless } from './auth.js';
import { getNextAccount, markAuthInvalid, markModelUnsupported, markRateLimited, markWorkspaceDeactivated } from './rotation.js';
import { DEFAULT_CONFIG } from './types.js';
const PROVIDER_ID = 'openai';
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';
let pluginConfig = { ...DEFAULT_CONFIG };
function decodeJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    }
    catch {
        return null;
    }
}
function mapUrl(original) {
    const parsed = new URL(original);
    if (parsed.pathname.includes('/responses'))
        parsed.pathname = parsed.pathname.replace('/responses', '/codex/responses');
    if (parsed.pathname.includes('/chat/completions'))
        parsed.pathname = parsed.pathname.replace('/chat/completions', '/codex/chat/completions');
    return new URL(`${parsed.pathname}${parsed.search}`, CODEX_BASE_URL).toString();
}
function normalizeModel(model) {
    if (!model)
        return 'gpt-5.3-codex';
    const id = model.includes('/') ? model.split('/').pop() || model : model;
    return id.replace(/-(none|low|medium|high|xhigh)$/i, '');
}
function jsonError(status, message) {
    return new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
async function parseJson(response) {
    return response.clone().json().catch(() => ({}));
}
const plugin = async (_input) => {
    return {
        auth: {
            provider: PROVIDER_ID,
            async loader() {
                const customFetch = async (input, init) => {
                    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
                    const attempts = Math.max(pluginConfig.maxRetries, 1) + 1;
                    for (let i = 0; i < attempts; i += 1) {
                        const selected = await getNextAccount(pluginConfig);
                        if (!selected)
                            return jsonError(503, 'No available accounts');
                        const claims = decodeJWT(selected.token);
                        const authClaim = claims?.[JWT_CLAIM_PATH];
                        const accountId = authClaim?.chatgpt_account_id;
                        if (!accountId) {
                            markAuthInvalid(selected.index);
                            continue;
                        }
                        const headers = new Headers(init?.headers || {});
                        headers.set('Authorization', `Bearer ${selected.token}`);
                        headers.set('Content-Type', 'application/json');
                        headers.set('chatgpt-account-id', accountId);
                        headers.set('OpenAI-Beta', 'responses=experimental');
                        headers.set('originator', 'codex_cli_rs');
                        let body = {};
                        try {
                            body = init?.body ? JSON.parse(init.body) : {};
                        }
                        catch {
                            body = {};
                        }
                        const payload = {
                            ...body,
                            model: normalizeModel(body.model),
                            store: false
                        };
                        const response = await fetch(mapUrl(url), {
                            method: init?.method || 'POST',
                            headers,
                            body: JSON.stringify(payload)
                        });
                        if (response.status === 401 || response.status === 403) {
                            markAuthInvalid(selected.index);
                            continue;
                        }
                        if (response.status === 429) {
                            markRateLimited(selected.index, pluginConfig.rateLimitCooldownMs);
                            continue;
                        }
                        if (response.status === 402) {
                            const data = await parseJson(response);
                            const detail = data.detail;
                            const code = typeof detail?.code === 'string' ? detail.code : '';
                            if (code === 'deactivated_workspace') {
                                markWorkspaceDeactivated(selected.index, pluginConfig.workspaceDeactivatedCooldownMs);
                                continue;
                            }
                        }
                        if (response.status === 400) {
                            const data = await parseJson(response);
                            const message = typeof data.message === 'string'
                                ? data.message
                                : typeof data.error?.message === 'string'
                                    ? data.error.message
                                    : '';
                            if (message.toLowerCase().includes('model is not supported')) {
                                markModelUnsupported(selected.index, pluginConfig.modelUnsupportedCooldownMs);
                                continue;
                            }
                        }
                        return response;
                    }
                    return jsonError(503, 'No available accounts after retries');
                };
                return {
                    apiKey: 'chatgpt-oauth',
                    baseURL: CODEX_BASE_URL,
                    fetch: customFetch
                };
            },
            methods: [
                {
                    label: 'ChatGPT OAuth (Multi-Account)',
                    type: 'oauth',
                    authorize: async () => {
                        const flow = await createAuthorizationFlow();
                        return {
                            url: flow.url,
                            method: 'auto',
                            instructions: 'Login with your ChatGPT account',
                            callback: async () => {
                                try {
                                    const account = await loginAccount(flow);
                                    return {
                                        type: 'success',
                                        provider: PROVIDER_ID,
                                        refresh: account.refreshToken,
                                        access: account.accessToken,
                                        expires: account.expiresAt
                                    };
                                }
                                catch {
                                    return { type: 'failed' };
                                }
                            }
                        };
                    }
                },
                {
                    label: 'ChatGPT OAuth (Headless, Multi-Account)',
                    type: 'oauth',
                    authorize: async () => {
                        const flow = await createDeviceAuthorizationFlow();
                        return {
                            url: flow.url,
                            method: 'auto',
                            instructions: flow.instructions,
                            callback: async () => {
                                try {
                                    const account = await loginAccountHeadless(flow);
                                    return {
                                        type: 'success',
                                        provider: PROVIDER_ID,
                                        refresh: account.refreshToken,
                                        access: account.accessToken,
                                        expires: account.expiresAt
                                    };
                                }
                                catch {
                                    return { type: 'failed' };
                                }
                            }
                        };
                    }
                },
                {
                    label: 'Skip (use existing accounts)',
                    type: 'api'
                }
            ]
        },
        config: async (config) => {
            const patch = config.provider?.[PROVIDER_ID] || {};
            const pluginPatch = patch['multiAuth'] || {};
            pluginConfig = {
                ...DEFAULT_CONFIG,
                ...pluginPatch
            };
        }
    };
};
export default plugin;
//# sourceMappingURL=index.js.map