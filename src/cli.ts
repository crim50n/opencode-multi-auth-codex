#!/usr/bin/env node

import { loginAccount } from './auth.js'
import { removeAccount, listAccounts, getStorePath } from './store.js'
import { status } from './index.js'

const args = process.argv.slice(2)
const command = args[0]
const alias = args[1]

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
      status()
      break
    }

    case 'path': {
      console.log(getStorePath())
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
  help             Show this help message

Examples:
  opencode-multi-auth add personal
  opencode-multi-auth add work
  opencode-multi-auth add backup
  opencode-multi-auth status

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
