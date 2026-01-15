import * as fs from 'node:fs';
import * as http from 'node:http';
import { URL } from 'node:url';
import { getCodexAuthPath, syncCodexAuthFile, writeCodexAuthForAlias } from './codex-auth.js';
import { refreshRateLimits } from './limits-refresh.js';
import { listAccounts, loadStore, removeAccount } from './store.js';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3434;
const SYNC_INTERVAL_MS = 3000;
let lastSyncAt = 0;
let lastSyncError = null;
const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex Token Dashboard</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap');

      :root {
        --bg: #0f1116;
        --panel: #1a1e27;
        --panel-2: #222836;
        --accent: #ffb547;
        --accent-2: #6ee7ff;
        --text: #eef1f6;
        --muted: #9aa4b2;
        --danger: #ff6b6b;
        --success: #37d399;
        --shadow: rgba(15, 17, 22, 0.45);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: 'Space Grotesk', sans-serif;
        background:
          radial-gradient(1200px 600px at 10% 0%, rgba(110, 231, 255, 0.08), transparent 60%),
          radial-gradient(1200px 600px at 90% 10%, rgba(255, 181, 71, 0.1), transparent 55%),
          var(--bg);
        color: var(--text);
        min-height: 100vh;
      }
      header {
        padding: 32px 28px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .subtitle {
        color: var(--muted);
        font-size: 14px;
      }
      .container {
        padding: 0 24px 40px;
        display: grid;
        gap: 18px;
      }
      .panel {
        background: linear-gradient(180deg, rgba(26, 30, 39, 0.98), rgba(22, 26, 34, 0.98));
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 18px;
        box-shadow: 0 18px 40px var(--shadow);
        padding: 18px;
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
      }
      .meta-item {
        background: var(--panel-2);
        border-radius: 14px;
        padding: 12px 14px;
      }
      .meta-item span {
        display: block;
        color: var(--muted);
        font-size: 12px;
      }
      .meta-item strong {
        display: block;
        margin-top: 6px;
        font-size: 16px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      button {
        cursor: pointer;
        border: none;
        border-radius: 10px;
        padding: 10px 14px;
        font-weight: 600;
        font-family: 'Space Grotesk', sans-serif;
        color: #0b0f14;
        background: var(--accent);
        transition: transform 120ms ease, box-shadow 120ms ease;
      }
      button.secondary {
        background: transparent;
        color: var(--text);
        border: 1px solid rgba(255,255,255,0.1);
      }
      button.danger {
        background: var(--danger);
      }
      button:active { transform: translateY(1px); }
      .accounts {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      }
      .account-card {
        background: var(--panel);
        border-radius: 16px;
        padding: 16px;
        border: 1px solid rgba(255,255,255,0.06);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .account-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .badge {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(55, 211, 153, 0.15);
        color: var(--success);
      }
      .badge.inactive {
        background: rgba(255,255,255,0.08);
        color: var(--muted);
      }
      .account-meta {
        display: grid;
        gap: 6px;
        font-size: 13px;
        color: var(--muted);
      }
      .limit-grid {
        display: grid;
        gap: 8px;
      }
      .limit-card {
        background: #121620;
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 13px;
      }
      .limit-card strong {
        display: block;
        font-size: 14px;
        color: var(--text);
      }
      .limit-card span {
        color: var(--muted);
        font-size: 12px;
      }
      .card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .notice {
        font-size: 12px;
        color: var(--muted);
      }
      .toast {
        position: fixed;
        right: 18px;
        bottom: 18px;
        background: #11151e;
        border: 1px solid rgba(255,255,255,0.1);
        padding: 12px 16px;
        border-radius: 12px;
        box-shadow: 0 14px 30px var(--shadow);
        display: none;
      }
      .toast.show { display: block; }
      @media (max-width: 640px) {
        header { padding: 26px 18px 10px; }
        .container { padding: 0 16px 28px; }
        .actions { flex-direction: column; align-items: stretch; }
        button { width: 100%; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Codex Token Dashboard</h1>
      <div class="subtitle">Local console for ~/.codex/auth.json with manual limit refresh.</div>
    </header>
    <div class="container">
      <section class="panel">
        <div class="meta" id="meta"></div>
      </section>
      <section class="panel">
        <div class="actions">
          <button id="syncBtn">Sync auth.json</button>
          <button class="secondary" id="refreshLimitsBtn">Refresh limits (all)</button>
          <button class="secondary" id="refreshBtn">Refresh UI</button>
        </div>
        <div class="notice" id="notice"></div>
      </section>
      <section class="accounts" id="accounts"></section>
    </div>
    <div class="toast" id="toast"></div>
    <script>
      const metaEl = document.getElementById('meta')
      const accountsEl = document.getElementById('accounts')
      const syncBtn = document.getElementById('syncBtn')
      const refreshLimitsBtn = document.getElementById('refreshLimitsBtn')
      const refreshBtn = document.getElementById('refreshBtn')
      const notice = document.getElementById('notice')
      const toast = document.getElementById('toast')

      function showToast(text) {
        toast.textContent = text
        toast.classList.add('show')
        setTimeout(() => toast.classList.remove('show'), 2200)
      }

      async function api(path, options) {
        const res = await fetch(path, {
          headers: { 'Content-Type': 'application/json' },
          ...options
        })
        if (!res.ok) {
          const msg = await res.text()
          throw new Error(msg || 'Request failed')
        }
        return res.json()
      }

      function formatDate(value) {
        if (!value) return 'unknown'
        return new Date(value).toLocaleString()
      }

      function renderLimit(window, label) {
        if (!window) return ''
        const remaining = window.remaining ?? '-'
        const limit = window.limit ?? '-'
        const isPercent = typeof remaining === 'number' && limit === 100
        const remainingText = isPercent ? remaining + '%' : remaining + ' / ' + limit
        const reset = window.resetAt ? formatDate(window.resetAt) : 'unknown'
        const updated = window.updatedAt ? formatDate(window.updatedAt) : 'unknown'
        return \`
          <div class="limit-card">
            <strong>\${label}</strong>
            <span>Remaining: \${remainingText}</span><br />
            <span>Reset: \${reset}</span><br />
            <span>Updated: \${updated}</span>
          </div>
        \`
      }

      function renderAccounts(state) {
        const cards = state.accounts.map((acc) => {
          const active = acc.alias === state.currentAlias
          const badge = active ? 'On device' : 'Stored'
          const badgeClass = active ? 'badge' : 'badge inactive'
          const limitBlocks = [
            renderLimit(acc.rateLimits?.fiveHour, '5h limit'),
            renderLimit(acc.rateLimits?.weekly, 'Weekly limit')
          ].join('')

          return \`
            <div class="account-card">
              <div class="account-title">
                <div>
                  <div style="font-size: 18px; font-weight: 600;">\${acc.alias}</div>
                  <div style="color: var(--muted); font-size: 12px;">\${acc.email || acc.accountId || 'unknown account'}</div>
                </div>
                <span class="\${badgeClass}">\${badge}</span>
              </div>
              <div class="account-meta">
                <div>Token expires: \${formatDate(acc.expiresAt)}</div>
                <div>Last seen: \${acc.lastSeenAt ? formatDate(acc.lastSeenAt) : 'never'}</div>
                <div>Last refresh: \${acc.lastRefresh ? formatDate(acc.lastRefresh) : 'unknown'}</div>
                <div>Usage count: \${acc.usageCount ?? 0}</div>
              </div>
              <div class="limit-grid">\${limitBlocks || '<span class="notice">No rate-limit data yet.</span>'}</div>
              <div class="card-actions">
                <button data-action="switch" data-alias="\${acc.alias}">Use on device</button>
                <button class="secondary" data-action="refresh" data-alias="\${acc.alias}">Refresh limits</button>
                <button class="danger" data-action="remove" data-alias="\${acc.alias}">Remove</button>
              </div>
            </div>
          \`
        }).join('')

        accountsEl.innerHTML = cards || '<div class="notice">No accounts yet. Sync auth.json first.</div>'
      }

      function renderMeta(state) {
        metaEl.innerHTML = \`
          <div class="meta-item">
            <span>Accounts</span>
            <strong>\${state.accounts.length}</strong>
          </div>
          <div class="meta-item">
            <span>Current token</span>
            <strong>\${state.currentAlias || 'none'}</strong>
          </div>
          <div class="meta-item">
            <span>auth.json path</span>
            <strong style="font-size: 13px;">\${state.authPath}</strong>
          </div>
          <div class="meta-item">
            <span>Last sync</span>
            <strong>\${state.lastSyncAt ? formatDate(state.lastSyncAt) : 'never'}</strong>
          </div>
        \`
        notice.textContent = state.lastSyncError ? state.lastSyncError : ''
      }

      async function refreshState() {
        const state = await api('/api/state')
        renderMeta(state)
        renderAccounts(state)
      }

      accountsEl.addEventListener('click', async (event) => {
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        const alias = target.dataset.alias
        const action = target.dataset.action
        if (!alias || !action) return

        if (action === 'switch') {
          await api('/api/switch', { method: 'POST', body: JSON.stringify({ alias }) })
          showToast('Switched auth.json')
          await refreshState()
          return
        }
        if (action === 'refresh') {
          const result = await api('/api/limits/refresh', { method: 'POST', body: JSON.stringify({ alias }) })
          const error = result.results?.find((item) => item.error)?.error
          showToast(error ? 'Limits: ' + error : 'Limits refreshed')
          await refreshState()
          return
        }
        if (action === 'remove') {
          await api('/api/remove', { method: 'POST', body: JSON.stringify({ alias }) })
          showToast('Account removed')
          await refreshState()
        }
      })

      syncBtn.addEventListener('click', async () => {
        await api('/api/sync', { method: 'POST', body: '{}' })
        showToast('Synced auth.json')
        await refreshState()
      })

      refreshLimitsBtn.addEventListener('click', async () => {
        const result = await api('/api/limits/refresh', { method: 'POST', body: '{}' })
        const failures = result.results?.filter((item) => item.error) || []
        if (failures.length === 0) {
          showToast('Limits refreshed')
        } else {
          showToast('Limits: ' + failures.length + ' failed')
        }
        await refreshState()
      })

      refreshBtn.addEventListener('click', async () => {
        await refreshState()
        showToast('Refreshed')
      })

      refreshState().catch((err) => {
        console.error(err)
        notice.textContent = 'Failed to load state.'
      })
    </script>
  </body>
</html>`;
function sendJson(res, status, payload) {
    const data = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data)
    });
    res.end(data);
}
function scrubAccount(account) {
    const { accessToken, refreshToken, idToken, ...rest } = account;
    return rest;
}
async function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
            if (data.length > 1_000_000) {
                req.destroy();
                reject(new Error('Payload too large'));
            }
        });
        req.on('end', () => {
            if (!data) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(data));
            }
            catch (err) {
                reject(err);
            }
        });
    });
}
function runSync() {
    try {
        syncCodexAuthFile();
        lastSyncAt = Date.now();
        lastSyncError = null;
    }
    catch (err) {
        lastSyncError = String(err);
    }
}
function startAuthWatcher() {
    const authPath = getCodexAuthPath();
    fs.watchFile(authPath, { interval: SYNC_INTERVAL_MS }, () => {
        runSync();
    });
}
export function startWebConsole(options) {
    const host = options?.host || DEFAULT_HOST;
    const port = options?.port || DEFAULT_PORT;
    runSync();
    startAuthWatcher();
    const server = http.createServer(async (req, res) => {
        const requestUrl = new URL(req.url || '/', `http://${host}:${port}`);
        const path = requestUrl.pathname;
        if (req.method === 'GET' && path === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(HTML);
            return;
        }
        if (req.method === 'GET' && path === '/api/state') {
            runSync();
            const store = loadStore();
            const accounts = listAccounts()
                .filter((acc) => acc.source === 'codex' || acc.idToken || acc.accountId)
                .map(scrubAccount);
            sendJson(res, 200, {
                authPath: getCodexAuthPath(),
                currentAlias: store.activeAlias,
                accounts,
                lastSyncAt,
                lastSyncError
            });
            return;
        }
        if (req.method === 'POST' && path === '/api/sync') {
            try {
                runSync();
                sendJson(res, 200, { ok: true });
            }
            catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }
        if (req.method === 'POST' && path === '/api/switch') {
            const body = await readJsonBody(req);
            if (!body.alias) {
                sendJson(res, 400, { error: 'Missing alias' });
                return;
            }
            try {
                writeCodexAuthForAlias(body.alias);
                sendJson(res, 200, { ok: true });
            }
            catch (err) {
                sendJson(res, 400, { error: String(err) });
            }
            return;
        }
        if (req.method === 'POST' && path === '/api/remove') {
            const body = await readJsonBody(req);
            if (!body.alias) {
                sendJson(res, 400, { error: 'Missing alias' });
                return;
            }
            removeAccount(body.alias);
            sendJson(res, 200, { ok: true });
            return;
        }
        if (req.method === 'POST' && path === '/api/limits/refresh') {
            const body = await readJsonBody(req);
            const accounts = listAccounts();
            const results = await refreshRateLimits(accounts, body.alias);
            sendJson(res, 200, { ok: true, results });
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    });
    server.listen(port, host, () => {
        console.log(`[multi-auth] Codex dashboard running at http://${host}:${port}`);
    });
    return server;
}
//# sourceMappingURL=web.js.map