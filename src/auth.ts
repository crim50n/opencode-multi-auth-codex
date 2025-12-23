import { createClient } from '@openauthjs/openauth/client'
import * as http from 'http'
import * as url from 'url'
import { addAccount, updateAccount, loadStore, saveStore } from './store.js'
import type { AccountCredentials } from './types.js'

// OpenAI OAuth endpoints (same as official Codex CLI)
const OPENAI_ISSUER = 'https://auth.openai.com'
const CLIENT_ID = 'pdlLIX2Y72MIl2rhLhTE9VV9bN905kBh' // Public client ID
const REDIRECT_PORT = 1455
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`
const SCOPES = ['openid', 'profile', 'email', 'offline_access']

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

export async function loginAccount(alias: string): Promise<AccountCredentials> {
  return new Promise((resolve, reject) => {
    const client = createClient({
      clientID: CLIENT_ID,
      issuer: OPENAI_ISSUER
    })

    let server: http.Server | null = null

    const cleanup = () => {
      if (server) {
        server.close()
        server = null
      }
    }

    server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const parsedUrl = url.parse(req.url, true)
      const code = parsedUrl.query.code as string

      if (!code) {
        res.writeHead(400)
        res.end('No authorization code received')
        cleanup()
        reject(new Error('No authorization code'))
        return
      }

      try {
        // Exchange code for tokens
        const tokenRes = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code,
            redirect_uri: REDIRECT_URI
          })
        })

        if (!tokenRes.ok) {
          throw new Error(`Token exchange failed: ${tokenRes.status}`)
        }

        const tokens = (await tokenRes.json()) as TokenResponse
        const expiresAt = Date.now() + tokens.expires_in * 1000

        let email: string | undefined
        try {
          const userRes = await fetch(`${OPENAI_ISSUER}/userinfo`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
          })
          if (userRes.ok) {
            const user = (await userRes.json()) as { email?: string }
            email = user.email
          }
        } catch {
          /* user info fetch is non-critical */
        }

        const store = addAccount(alias, {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt,
          email
        })

        const account = store.accounts[alias]

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>Account "${alias}" authenticated!</h1>
              <p>${email || 'Unknown email'}</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `)

        cleanup()
        resolve(account)
      } catch (err) {
        res.writeHead(500)
        res.end('Authentication failed')
        cleanup()
        reject(err)
      }
    })

    server.listen(REDIRECT_PORT, () => {
      const authUrl = new URL(`${OPENAI_ISSUER}/authorize`)
      authUrl.searchParams.set('client_id', CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', SCOPES.join(' '))
      authUrl.searchParams.set('audience', 'https://api.openai.com/v1')

      console.log(`\n[multi-auth] Login for account "${alias}"`)
      console.log(`[multi-auth] Open this URL in your browser:\n`)
      console.log(`  ${authUrl.toString()}\n`)
      console.log(`[multi-auth] Waiting for callback on port ${REDIRECT_PORT}...`)
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${REDIRECT_PORT} is in use. Stop Codex CLI if running.`))
      } else {
        reject(err)
      }
    })

    // Timeout after 5 minutes
    setTimeout(() => {
      cleanup()
      reject(new Error('Login timeout - no callback received'))
    }, 5 * 60 * 1000)
  })
}

export async function refreshToken(alias: string): Promise<AccountCredentials | null> {
  const store = loadStore()
  const account = store.accounts[alias]

  if (!account?.refreshToken) {
    console.error(`[multi-auth] No refresh token for ${alias}`)
    return null
  }

  try {
    const tokenRes = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: account.refreshToken
      })
    })

    if (!tokenRes.ok) {
      console.error(`[multi-auth] Refresh failed for ${alias}: ${tokenRes.status}`)
      return null
    }

    const tokens = (await tokenRes.json()) as TokenResponse
    const expiresAt = Date.now() + tokens.expires_in * 1000

    const updatedStore = updateAccount(alias, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || account.refreshToken,
      expiresAt
    })

    return updatedStore.accounts[alias]
  } catch (err) {
    console.error(`[multi-auth] Refresh error for ${alias}:`, err)
    return null
  }
}

export async function ensureValidToken(alias: string): Promise<string | null> {
  const store = loadStore()
  const account = store.accounts[alias]

  if (!account) return null

  // Refresh if expiring within 5 minutes
  const bufferMs = 5 * 60 * 1000
  if (account.expiresAt < Date.now() + bufferMs) {
    console.log(`[multi-auth] Refreshing token for ${alias}`)
    const refreshed = await refreshToken(alias)
    return refreshed?.accessToken || null
  }

  return account.accessToken
}
