#!/usr/bin/env node

import http from 'http'
import { loginAccount } from './auth.js'
import { removeAccount, listAccounts, getStorePath, loadStore } from './store.js'

const args = process.argv.slice(2)
const command = args[0]
const alias = args[1]

const readFlag = (name: string): string | undefined => {
  const key = `--${name}`
  const entry = args.find((arg) => arg.startsWith(`${key}=`))
  if (entry) return entry.slice(key.length + 1)
  const index = args.findIndex((arg) => arg === key)
  if (index !== -1) return args[index + 1]
  return undefined
}

const buildAccountSnapshot = () => {
  const store = loadStore()
  const now = Date.now()
  const accounts = Object.values(store.accounts).map((acc) => ({
    alias: acc.alias,
    email: acc.email || 'unknown',
    usageCount: acc.usageCount,
    expiresAt: acc.expiresAt,
    expiresInMs: Math.max(acc.expiresAt - now, 0),
    rateLimitedUntil: acc.rateLimitedUntil || null,
    rateLimitedForMs: acc.rateLimitedUntil
      ? Math.max(acc.rateLimitedUntil - now, 0)
      : 0,
    isActive: acc.alias === store.activeAlias,
  }))

  return {
    now,
    activeAlias: store.activeAlias,
    accounts,
  }
}

const renderPanelHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCode Multi-Auth Panel</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #0b0c10;
        color: #f5f5f5;
      }
      body {
        margin: 0;
        padding: 32px;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
      }
      .title {
        font-size: 20px;
        font-weight: 600;
      }
      .meta {
        font-size: 12px;
        color: #9aa0a6;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
      }
      .card {
        border: 1px solid #1f232b;
        border-radius: 12px;
        padding: 16px;
        background: #12141a;
      }
      .card h3 {
        margin: 0 0 8px;
        font-size: 16px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 12px;
        background: #1f2a3c;
      }
      .badge.active {
        background: #1d3b2a;
        color: #b8f7c3;
      }
      .badge.rate {
        background: #3a1f1f;
        color: #f7b8b8;
      }
      .row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        margin-bottom: 6px;
      }
      .row span {
        color: #9aa0a6;
      }
      .empty {
        color: #9aa0a6;
        border: 1px dashed #2a2f3a;
        border-radius: 12px;
        padding: 24px;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <div class="title">OpenCode Multi-Auth Accounts</div>
        <div class="meta" id="updated">Loading...</div>
      </div>
      <div class="meta">Refresh: 2s</div>
    </header>
    <section id="content"></section>
    <script>
      const fmt = (ms) => {
        if (!ms) return '—';
        const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (minutes === 0) return seconds + 's';
        return minutes + 'm ' + seconds + 's';
      };
      const fmtDate = (epoch) => epoch ? new Date(epoch).toLocaleString() : '—';
      const render = (data) => {
        const content = document.getElementById('content');
        const updated = document.getElementById('updated');
        updated.textContent = 'Updated: ' + new Date(data.now).toLocaleTimeString();
        if (!data.accounts.length) {
          content.innerHTML = '<div class="empty">No accounts configured. Run: opencode-multi-auth add &lt;alias&gt;</div>';
          return;
        }
        content.innerHTML = '<div class="grid">' + data.accounts.map((acc) => (
          '<div class="card">' +
          '<h3>' + acc.alias + '</h3>' +
          '<div class="row"><span>Email</span><strong>' + acc.email + '</strong></div>' +
          '<div class="row"><span>Uses</span><strong>' + acc.usageCount + '</strong></div>' +
          '<div class="row"><span>Token expires</span><strong>' + fmtDate(acc.expiresAt) + '</strong></div>' +
          '<div class="row"><span>Expires in</span><strong>' + fmt(acc.expiresInMs) + '</strong></div>' +
          '<div class="row"><span>Rate limit</span><strong>' + fmt(acc.rateLimitedForMs) + '</strong></div>' +
          '<div style="margin-top: 12px;">' +
          (acc.isActive ? '<span class="badge active">Active</span>' : '') +
          (acc.rateLimitedForMs > 0 ? '<span class="badge rate">Rate limited</span>' : '') +
          '</div>' +
          '</div>'
        )).join('') + '</div>';
      };
      const load = async () => {
        try {
          const res = await fetch('/api/accounts');
          const data = await res.json();
          render(data);
        } catch (err) {
          document.getElementById('content').innerHTML = '<div class="empty">Failed to load account status.</div>';
        }
      };
      load();
      setInterval(load, 2000);
    </script>
  </body>
</html>`

const startPanel = () => {
  const port = Number(readFlag('port') || args[1] || 8797)
  const host = readFlag('host') || '127.0.0.1'
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || host}`)
    if (url.pathname === '/api/accounts') {
      const data = buildAccountSnapshot()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
      return
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(renderPanelHtml())
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })

  server.listen(port, host, () => {
    console.log(`[multi-auth] Panel running at http://${host}:${port}`)
  })
}

async function main(): Promise<void> {
  switch (command) {
    case 'add':
    case 'login': {
      if (!alias) {
        console.error('Usage: opencode-multi-auth add <alias>')
        console.error('Example: opencode-multi-auth add work')
        process.exit(1)
      }
      try {
        const account = await loginAccount(alias)
        console.log(`\nAccount "${alias}" added successfully!`)
        console.log(`Email: ${account.email || 'unknown'}`)
      } catch (err) {
        console.error(`Failed to add account: ${err}`)
        process.exit(1)
      }
      break
    }

    case 'remove':
    case 'rm': {
      if (!alias) {
        console.error('Usage: opencode-multi-auth remove <alias>')
        process.exit(1)
      }
      removeAccount(alias)
      console.log(`Account "${alias}" removed.`)
      break
    }

    case 'list':
    case 'ls': {
      const accounts = listAccounts()
      if (accounts.length === 0) {
        console.log('No accounts configured.')
        console.log('Add one with: opencode-multi-auth add <alias>')
      } else {
        console.log('\nConfigured accounts:\n')
        for (const acc of accounts) {
          console.log(`  ${acc.alias}: ${acc.email || 'unknown email'} (uses: ${acc.usageCount})`)
        }
        console.log()
      }
      break
    }

    case 'status': {
      const store = loadStore()
      const accounts = Object.values(store.accounts)

      console.log('\n[multi-auth] Account Status\n')
      console.log('Strategy: round-robin')
      console.log(`Accounts: ${accounts.length}`)
      console.log(`Active: ${store.activeAlias || 'none'}\n`)

      if (accounts.length === 0) {
        console.log('No accounts configured. Run: opencode-multi-auth add <alias>\n')
        return
      }

      for (const acc of accounts) {
        const isActive = acc.alias === store.activeAlias ? ' (active)' : ''
        const isRateLimited = acc.rateLimitedUntil && acc.rateLimitedUntil > Date.now()
          ? ` [RATE LIMITED until ${new Date(acc.rateLimitedUntil).toLocaleTimeString()}]`
          : ''
        const expiry = new Date(acc.expiresAt).toLocaleString()

        console.log(`  ${acc.alias}${isActive}${isRateLimited}`)
        console.log(`    Email: ${acc.email || 'unknown'}`)
        console.log(`    Uses: ${acc.usageCount}`)
        console.log(`    Token expires: ${expiry}`)
        console.log()
      }
      break
    }

    case 'path': {
      console.log(getStorePath())
      break
    }

    case 'panel':
    case 'serve': {
      startPanel()
      break
    }

    case 'help':
    case '--help':
    case '-h':
    default: {
      console.log(`
opencode-multi-auth - Multi-account OAuth rotation for OpenAI Codex

Commands:
  add <alias>      Add a new account (opens browser for OAuth)
  remove <alias>   Remove an account
  list             List all configured accounts
  status           Show detailed account status
  path             Show config file location
  panel            Start local status panel (web)
  help             Show this help message

Examples:
  opencode-multi-auth add personal
  opencode-multi-auth add work
  opencode-multi-auth add backup
  opencode-multi-auth status
  opencode-multi-auth panel --port 8797 --host 0.0.0.0

After adding accounts, the plugin auto-rotates between them.
`)
      break
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
