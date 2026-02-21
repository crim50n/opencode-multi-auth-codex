#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { createDeviceAuthorizationFlow, loginAccount, loginAccountHeadless } from './auth.js'
import { removeAccount, listAccounts, getStorePath, loadStore } from './store.js'
import { startWebConsole } from './web.js'
import { disableService, installService, serviceStatus } from './systemd.js'

const args = process.argv.slice(2)
const command = args[0]

function getFlagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  return args[idx + 1]
}

async function main(): Promise<void> {
  switch (command) {
    case 'add':
    case 'login': {
      try {
        const headless = args.includes('--headless')
        if (headless) {
          const flow = await createDeviceAuthorizationFlow()
          console.log(`\nOpen: ${flow.url}`)
          console.log(flow.instructions)
          console.log('Waiting for authorization...')
          const account = await loginAccountHeadless(flow)
          console.log(`\nAccount added successfully!`)
          console.log(`Email: ${account.email || 'unknown'}`)
          break
        }

        const account = await loginAccount()
        console.log(`\nAccount added successfully!`)
        console.log(`Email: ${account.email || 'unknown'}`)
      } catch (err) {
        console.error(`Failed to add account: ${err}`)
        process.exit(1)
      }
      break
    }

    case 'remove':
    case 'rm': {
      const target = args[1]
      if (!target) {
        console.error('Usage: opencode-multi-auth remove <index|email>')
        process.exit(1)
      }

      const store = loadStore()
      // Try as index first
      const asNumber = Number(target)
      if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber < store.accounts.length) {
        const acc = store.accounts[asNumber]
        removeAccount(asNumber)
        console.log(`Account #${asNumber} (${acc.email || 'unknown'}) removed.`)
      } else {
        // Try as email
        const idx = store.accounts.findIndex((acc) => acc.email === target)
        if (idx >= 0) {
          removeAccount(idx)
          console.log(`Account "${target}" removed.`)
        } else {
          console.error(`Account "${target}" not found.`)
          process.exit(1)
        }
      }
      break
    }

    case 'list':
    case 'ls': {
      const accounts = listAccounts()
      if (accounts.length === 0) {
        console.log('No accounts configured.')
        console.log('Add one with: opencode-multi-auth add')
      } else {
        const store = loadStore()
        console.log('\nConfigured accounts:\n')
        accounts.forEach((acc, idx) => {
          const active = idx === store.activeIndex ? ' (active)' : ''
          console.log(`  #${idx}: ${acc.email || 'unknown email'}${active} (uses: ${acc.usageCount})`)
        })
        console.log()
      }
      break
    }

    case 'status': {
      const store = loadStore()
      const accounts = listAccounts()

      console.log('\n[multi-auth] Account Status\n')
      console.log('Strategy: round-robin')
      console.log(`Accounts: ${accounts.length}`)
      console.log(`Active: ${store.activeIndex >= 0 ? `#${store.activeIndex} (${store.accounts[store.activeIndex]?.email || 'unknown'})` : 'none'}\n`)

      if (accounts.length === 0) {
        console.log('No accounts configured. Run: opencode-multi-auth add\n')
        return
      }

      accounts.forEach((acc, idx) => {
        const isActive = idx === store.activeIndex ? ' (active)' : ''
        const isRateLimited = acc.rateLimitedUntil && acc.rateLimitedUntil > Date.now()
          ? ` [RATE LIMITED until ${new Date(acc.rateLimitedUntil).toLocaleTimeString()}]`
          : ''
        const isInvalid = acc.authInvalid ? ' [AUTH INVALID]' : ''
        const expiry = new Date(acc.expiresAt).toLocaleString()

        console.log(`  #${idx}${isActive}${isRateLimited}${isInvalid}`)
        console.log(`    Email: ${acc.email || 'unknown'}`)
        console.log(`    Uses: ${acc.usageCount}`)
        console.log(`    Token expires: ${expiry}`)
        console.log()
      })
      break
    }

    case 'path': {
      console.log(getStorePath())
      break
    }

    case 'web': {
      const portArg = getFlagValue('--port')
      const hostArg = getFlagValue('--host')
      const port = portArg ? Number(portArg) : undefined
      if (portArg && Number.isNaN(port)) {
        console.error('Invalid --port value')
        process.exit(1)
      }
      startWebConsole({ port, host: hostArg })
      break
    }

    case 'service': {
      const action = args[1] || 'status'
      const portArg = getFlagValue('--port')
      const hostArg = getFlagValue('--host')
      const port = portArg ? Number(portArg) : undefined
      if (portArg && Number.isNaN(port)) {
        console.error('Invalid --port value')
        process.exit(1)
      }
      const cliPath = fileURLToPath(import.meta.url)
      if (action === 'install') {
        const file = installService({ cliPath, host: hostArg, port })
        console.log(`Installed systemd user service at ${file}`)
        break
      }
      if (action === 'disable') {
        disableService()
        console.log('Disabled codex-soft systemd user service.')
        break
      }
      serviceStatus()
      break
    }

    case 'help':
    case '--help':
    case '-h':
    default: {
      console.log(`
opencode-multi-auth - Multi-account OAuth rotation for OpenAI Codex

Commands:
  add              Add a new account (opens browser for OAuth)
  add --headless   Add a new account via device-code flow
  remove <idx|email>  Remove an account by index or email
  list             List all configured accounts
  status           Show detailed account status
  path             Show config file location
  web              Launch local dashboard (use --port/--host)
  service          Install/disable systemd user service (install|disable|status)
  help             Show this help message

Examples:
  opencode-multi-auth add
  opencode-multi-auth remove 0
  opencode-multi-auth remove user@example.com
  opencode-multi-auth status
  opencode-multi-auth web --port 3434 --host 127.0.0.1
  opencode-multi-auth service install --port 3434 --host 127.0.0.1

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
