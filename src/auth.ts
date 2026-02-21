import { generatePKCE } from '@openauthjs/openauth/pkce'
import { randomBytes } from 'node:crypto'
import * as http from 'http'
import * as url from 'url'
import { addAccount, updateAccount, loadStore } from './store.js'
import {
  decodeJwtPayload,
  getAccountIdFromClaims,
  getEmailFromClaims,
  getExpiryFromClaims
} from './codex-auth.js'
import type { AccountCredentials } from './types.js'

// OpenAI OAuth endpoints (same as official Codex CLI)
const OPENAI_ISSUER = 'https://auth.openai.com'
const AUTHORIZE_URL = `${OPENAI_ISSUER}/oauth/authorize`
const TOKEN_URL = `${OPENAI_ISSUER}/oauth/token`
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OAUTH_PORT = 1455
const DEVICE_CODE_URL = `${OPENAI_ISSUER}/api/accounts/deviceauth/usercode`
const DEVICE_TOKEN_URL = `${OPENAI_ISSUER}/api/accounts/deviceauth/token`
const DEVICE_REDIRECT_URI = `${OPENAI_ISSUER}/deviceauth/callback`
const DEVICE_VERIFY_URL = `${OPENAI_ISSUER}/codex/device`
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000
const SCOPES = ['openid', 'profile', 'email', 'offline_access']

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in: number
  token_type: string
}

export interface AuthorizationFlow {
  pkce: { verifier: string; challenge: string }
  state: string
  url: string
  redirectUri: string
  redirectPort: number
}

export interface DeviceAuthorizationFlow {
  deviceAuthId: string
  userCode: string
  intervalMs: number
  url: string
  instructions: string
}

interface DeviceAuthCodeResponse {
  device_auth_id: string
  user_code: string
  interval?: string
}

interface DeviceAuthTokenResponse {
  authorization_code: string
  code_verifier: string
}

function generateState(): string {
  return randomBytes(32).toString('base64url')
}

export async function createAuthorizationFlow(): Promise<AuthorizationFlow> {
  const pkce = await generatePKCE()
  const state = generateState()
  const redirectPort = OAUTH_PORT
  const redirectUri = `http://localhost:${redirectPort}/auth/callback`
  const authUrl = new URL(AUTHORIZE_URL)
  authUrl.searchParams.set('client_id', CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPES.join(' '))
  authUrl.searchParams.set('code_challenge', pkce.challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('id_token_add_organizations', 'true')
  authUrl.searchParams.set('codex_cli_simplified_flow', 'true')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('originator', 'opencode')

  return { pkce, state, url: authUrl.toString(), redirectUri, redirectPort }
}

export async function createDeviceAuthorizationFlow(): Promise<DeviceAuthorizationFlow> {
  const response = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'opencode-multi-auth-codex'
    },
    body: JSON.stringify({ client_id: CLIENT_ID })
  })

  if (!response.ok) {
    throw new Error(`Failed to initiate device authorization: ${response.status}`)
  }

  const data = (await response.json()) as DeviceAuthCodeResponse
  const intervalSeconds = Math.max(Number.parseInt(data.interval || '5', 10) || 5, 1)

  return {
    deviceAuthId: data.device_auth_id,
    userCode: data.user_code,
    intervalMs: intervalSeconds * 1000,
    url: DEVICE_VERIFY_URL,
    instructions: `Enter code: ${data.user_code}`
  }
}

async function exchangeCodeForTokens(code: string, redirectUri: string, codeVerifier: string): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier
    }).toString()
  })

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }

  return response.json() as Promise<TokenResponse>
}

async function storeTokensAsAccount(tokens: TokenResponse): Promise<AccountCredentials> {
  if (!tokens.refresh_token) {
    throw new Error('Token response did not return a refresh_token')
  }

  const now = Date.now()
  const accessClaims = decodeJwtPayload(tokens.access_token)
  const idClaims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null
  const expiresAt = getExpiryFromClaims(accessClaims) || getExpiryFromClaims(idClaims) || now + tokens.expires_in * 1000

  let email: string | undefined = getEmailFromClaims(idClaims) || getEmailFromClaims(accessClaims)
  try {
    const userRes = await fetch(`${OPENAI_ISSUER}/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    if (userRes.ok) {
      const user = (await userRes.json()) as { email?: string }
      email = user.email || email
    }
  } catch {
    // user info fetch is non-critical
  }

  const accountId =
    getAccountIdFromClaims(idClaims) ||
    getAccountIdFromClaims(accessClaims)

  const { store, index } = addAccount({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    accountId,
    expiresAt,
    email,
    lastRefresh: new Date(now).toISOString(),
    lastSeenAt: now,
    addedAt: now,
    source: 'opencode',
    authInvalid: false,
    authInvalidatedAt: undefined
  })

  const stored = store.accounts[index]
  return {
    ...stored,
    alias: email?.split('@')[0] || `account-${index}`,
    usageCount: stored.usageCount ?? 0
  }
}

export async function loginAccountHeadless(flow: DeviceAuthorizationFlow): Promise<AccountCredentials> {
  while (true) {
    const response = await fetch(DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'opencode-multi-auth-codex'
      },
      body: JSON.stringify({
        device_auth_id: flow.deviceAuthId,
        user_code: flow.userCode
      })
    })

    if (response.ok) {
      const deviceToken = (await response.json()) as DeviceAuthTokenResponse
      const tokens = await exchangeCodeForTokens(
        deviceToken.authorization_code,
        DEVICE_REDIRECT_URI,
        deviceToken.code_verifier
      )
      return storeTokensAsAccount(tokens)
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`Device authorization failed: ${response.status}`)
    }

    await new Promise((resolve) => setTimeout(resolve, flow.intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS))
  }
}

/**
 * Login a new account via OAuth. No alias required — accounts are identified by email.
 * Deduplicates by email automatically (if same email logs in again, updates existing).
 */
export async function loginAccount(
  flow?: AuthorizationFlow
): Promise<AccountCredentials> {
  const activeFlow = flow ?? await createAuthorizationFlow()
  const { pkce, state, redirectUri, redirectPort } = activeFlow

  return new Promise((resolve, reject) => {
    let server: http.Server | null = null

    const cleanup = () => {
      if (server) {
        server.close()
        server = null
      }
    }

    server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/auth/callback')) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const parsedUrl = url.parse(req.url, true)
      const code = parsedUrl.query.code as string
      const returnedState = parsedUrl.query.state as string | undefined
      const error = parsedUrl.query.error as string | undefined
      const errorDescription = parsedUrl.query.error_description as string | undefined

      if (error) {
        res.writeHead(400)
        res.end(`Authorization failed: ${errorDescription || error}`)
        cleanup()
        reject(new Error(errorDescription || error))
        return
      }

      if (!code) {
        res.writeHead(400)
        res.end('No authorization code received')
        cleanup()
        reject(new Error('No authorization code'))
        return
      }
      if (returnedState && returnedState !== state) {
        res.writeHead(400)
        res.end('Invalid state')
        cleanup()
        reject(new Error('Invalid state'))
        return
      }

      try {
        const tokens = await exchangeCodeForTokens(code, redirectUri, pkce.verifier)
        const account = await storeTokensAsAccount(tokens)

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>Account authenticated!</h1>
              <p>${account.email || 'Unknown email'}</p>
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

    server.listen(redirectPort, () => {
      // When called from plugin authorize() with a pre-created flow,
      // don't print URL again (OpenCode UI already shows it).
      if (flow) return
      console.log(`\n[multi-auth] Login — open this URL in your browser:\n`)
      console.log(`  ${activeFlow.url}\n`)
      console.log(`[multi-auth] Waiting for callback on port ${redirectPort}...`)
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${redirectPort} is in use. Stop conflicting process and retry (same as OpenCode oauth callback).`))
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

export async function refreshToken(index: number): Promise<AccountCredentials | null> {
  const store = loadStore()
  if (index < 0 || index >= store.accounts.length) {
    console.error(`[multi-auth] Invalid account index ${index}`)
    return null
  }
  const account = store.accounts[index]

  if (!account?.refreshToken) {
    console.error(`[multi-auth] No refresh token for account #${index} (${account?.email || 'unknown'})`)
    return null
  }

  const label = account.email || `#${index}`

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: account.refreshToken
      })
    })

    if (!tokenRes.ok) {
      console.error(`[multi-auth] Refresh failed for ${label}: ${tokenRes.status}`)

      // If the refresh token is invalid/expired, mark this account invalid so
      // rotation can keep working without repeatedly selecting a broken account.
      if (tokenRes.status === 401 || tokenRes.status === 403) {
        try {
          updateAccount(index, {
            authInvalid: true,
            authInvalidatedAt: Date.now()
          })
        } catch {
          // ignore
        }
      }
      return null
    }

    const tokens = (await tokenRes.json()) as TokenResponse
    const accessClaims = decodeJwtPayload(tokens.access_token)
    const idClaims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null
    const expiresAt = getExpiryFromClaims(accessClaims) || getExpiryFromClaims(idClaims) || Date.now() + tokens.expires_in * 1000

    const updates: Partial<AccountCredentials> = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || account.refreshToken,
      expiresAt,
      lastRefresh: new Date().toISOString(),
      idToken: tokens.id_token || account.idToken,
      accountId:
        getAccountIdFromClaims(idClaims) ||
        getAccountIdFromClaims(accessClaims) ||
        account.accountId,
      authInvalid: false,
      authInvalidatedAt: undefined
    }

    const updatedStore = updateAccount(index, updates)
    const stored = updatedStore.accounts[index]
    if (!stored) return null

    return {
      ...stored,
      alias: stored.email?.split('@')[0] || `account-${index}`,
      usageCount: stored.usageCount ?? 0
    }
  } catch (err) {
    console.error(`[multi-auth] Refresh error for ${label}:`, err)
    return null
  }
}

export async function ensureValidToken(index: number): Promise<string | null> {
  const store = loadStore()
  if (index < 0 || index >= store.accounts.length) return null
  const account = store.accounts[index]

  if (!account) return null

  // Refresh if expiring within 5 minutes
  const bufferMs = 5 * 60 * 1000
  if (account.expiresAt < Date.now() + bufferMs) {
    const label = account.email || `#${index}`
    if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
      console.log(`[multi-auth] Refreshing token for ${label}`)
    }
    const refreshed = await refreshToken(index)
    return refreshed?.accessToken || null
  }

  return account.accessToken
}
