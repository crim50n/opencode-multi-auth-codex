import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { findLatestSessionRateLimits } from './sessions-limits.js';
const CODEX_HOME_ROOT = path.join(os.homedir(), '.codex-multi');
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');
const DEFAULT_PROMPT = 'Reply ONLY with OK. Do not run any commands.';
const EXEC_TIMEOUT_MS = 120_000;
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
}
function sanitizeAlias(alias) {
    return alias.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function getAliasHome(alias) {
    return path.join(CODEX_HOME_ROOT, sanitizeAlias(alias));
}
function writeAuthJson(dir, account) {
    if (!account.accessToken || !account.refreshToken || !account.idToken) {
        throw new Error('Missing tokens for alias');
    }
    const auth = {
        OPENAI_API_KEY: null,
        tokens: {
            id_token: account.idToken,
            access_token: account.accessToken,
            refresh_token: account.refreshToken,
            account_id: account.accountId
        },
        last_refresh: new Date().toISOString()
    };
    const authPath = path.join(dir, 'auth.json');
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 });
}
function copyConfigToml(dir) {
    if (!fs.existsSync(CODEX_CONFIG_PATH))
        return;
    const target = path.join(dir, 'config.toml');
    try {
        fs.copyFileSync(CODEX_CONFIG_PATH, target);
    }
    catch {
        // ignore config copy errors
    }
}
async function runCodexExec(codexHome) {
    return new Promise((resolve) => {
        const args = [
            'exec',
            '--skip-git-repo-check',
            '--cd',
            codexHome,
            '--sandbox',
            'read-only',
            DEFAULT_PROMPT
        ];
        let stderr = '';
        let stdout = '';
        const child = spawn('codex', args, {
            env: { ...process.env, CODEX_HOME: codexHome },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            resolve({ ok: false, error: 'codex exec timed out' });
        }, EXEC_TIMEOUT_MS);
        child.stdout.on('data', (data) => {
            stdout += data.toString();
            if (stdout.length > 4000)
                stdout = stdout.slice(-4000);
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString();
            if (stderr.length > 4000)
                stderr = stderr.slice(-4000);
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            resolve({ ok: false, error: String(err) });
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve({ ok: true });
            }
            else {
                const message = stderr.trim() || stdout.trim() || `codex exec failed (code ${code})`;
                resolve({ ok: false, error: message });
            }
        });
    });
}
export async function probeRateLimitsForAccount(account) {
    const codexHome = getAliasHome(account.alias);
    ensureDir(codexHome);
    writeAuthJson(codexHome, account);
    copyConfigToml(codexHome);
    const startedAt = Date.now();
    const execResult = await runCodexExec(codexHome);
    const sessionsDir = path.join(codexHome, 'sessions');
    const latest = findLatestSessionRateLimits({
        sessionsDir,
        sinceMs: startedAt - 5_000
    });
    if (latest?.rateLimits) {
        return {
            rateLimits: latest.rateLimits,
            eventTs: latest.eventTs,
            sourceFile: latest.sourceFile
        };
    }
    return { error: execResult.error || 'No token_count events found in alias sessions' };
}
export function getProbeHomeRoot() {
    return CODEX_HOME_ROOT;
}
//# sourceMappingURL=probe-limits.js.map