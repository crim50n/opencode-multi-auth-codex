import type { Plugin, PluginInput } from '@opencode-ai/plugin'
import { syncAuthFromOpenCode } from './auth-sync.js'
import { createAuthorizationFlow, loginAccount } from './auth.js'
import { extractRateLimitUpdate, mergeRateLimits } from './rate-limits.js'
import { getNextAccount, markRateLimited } from './rotation.js'
import { listAccounts, updateAccount } from './store.js'
import { DEFAULT_CONFIG, type PluginConfig } from './types.js'

const PROVIDER_ID = 'openai'
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'
const REDIRECT_PORT = 1455
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`
const URL_PATHS = {
  RESPONSES: '/responses',
  CODEX_RESPONSES: '/codex/responses'
}
const OPENAI_HEADERS = {
  BETA: 'OpenAI-Beta',
  ACCOUNT_ID: 'chatgpt-account-id',
  ORIGINATOR: 'originator',
  SESSION_ID: 'session_id',
  CONVERSATION_ID: 'conversation_id'
}
const OPENAI_HEADER_VALUES = {
  BETA_RESPONSES: 'responses=experimental',
  ORIGINATOR_CODEX: 'codex_cli_rs'
}
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'

let pluginConfig: PluginConfig = { ...DEFAULT_CONFIG }

function configure(config: Partial<PluginConfig>): void {
  pluginConfig = { ...pluginConfig, ...config }
}

function decodeJWT(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1]
    const decoded = Buffer.from(payload, 'base64').toString('utf-8')
    return JSON.parse(decoded) as Record<string, any>
  } catch {
    return null
  }
}

function extractRequestUrl(input: Request | string | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function rewriteUrlForCodex(url: string): string {
  return url.replace(URL_PATHS.RESPONSES, URL_PATHS.CODEX_RESPONSES)
}

function filterInput(input: unknown): unknown {
  if (!Array.isArray(input)) return input
  return input
    .filter((item) => item?.type !== 'item_reference')
    .map((item) => {
      if (item && typeof item === 'object' && 'id' in item) {
        const { id, ...rest } = item as Record<string, unknown>
        return rest
      }
      return item
    })
}

function normalizeModel(model: string | undefined): string {
  if (!model) return 'gpt-5.1'
  const modelId = model.includes('/') ? model.split('/').pop()! : model
  return modelId.replace(/-(?:none|low|medium|high|xhigh)$/, '')
}

function ensureContentType(headers: Headers): Headers {
  const responseHeaders = new Headers(headers)
  if (!responseHeaders.has('content-type')) {
    responseHeaders.set('content-type', 'text/event-stream; charset=utf-8')
  }
  return responseHeaders
}

function parseSseStream(sseText: string): unknown | null {
  const lines = sseText.split('\n')
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    try {
      const data = JSON.parse(line.substring(6)) as { type?: string; response?: unknown }
      if (data?.type === 'response.done' || data?.type === 'response.completed') {
        return data.response
      }
    } catch {
      // ignore malformed chunks
    }
  }
  return null
}

async function convertSseToJson(response: Response, headers: Headers): Promise<Response> {
  if (!response.body) {
    throw new Error('[multi-auth] Response has no body')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    fullText += decoder.decode(value, { stream: true })
  }

  const finalResponse = parseSseStream(fullText)
  if (!finalResponse) {
    return new Response(fullText, {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  }

  const jsonHeaders = new Headers(headers)
  jsonHeaders.set('content-type', 'application/json; charset=utf-8')

  return new Response(JSON.stringify(finalResponse), {
    status: response.status,
    statusText: response.statusText,
    headers: jsonHeaders
  })
}

/**
 * Multi-account OAuth plugin for OpenCode
 *
 * Rotates between multiple ChatGPT Plus/Pro accounts for rate limit resilience.
 */
const MultiAuthPlugin: Plugin = async ({ client }: PluginInput) => {
  return {
    auth: {
      provider: PROVIDER_ID,

      /**
       * Loader configures the SDK with multi-account rotation
       */
      async loader(getAuth, provider) {
        await syncAuthFromOpenCode(getAuth)
        const accounts = listAccounts()

        if (accounts.length === 0) {
          console.log('[multi-auth] No accounts configured. Run: opencode-multi-auth add <alias>')
          return {}
        }

        // Custom fetch with multi-account rotation
        const customFetch = async (
          input: Request | string | URL,
          init?: RequestInit
        ): Promise<Response> => {
          await syncAuthFromOpenCode(getAuth)
          const rotation = await getNextAccount(pluginConfig)

          if (!rotation) {
            return new Response(
              JSON.stringify({ error: { message: 'No available accounts' } }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const { account, token } = rotation
          const decoded = decodeJWT(token)
          const accountId = decoded?.[JWT_CLAIM_PATH]?.chatgpt_account_id
          if (!accountId) {
            return new Response(
              JSON.stringify({ error: { message: '[multi-auth] Failed to extract accountId from token' } }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const originalUrl = extractRequestUrl(input)
          const url = rewriteUrlForCodex(originalUrl)

          let body: Record<string, any> = {}
          try {
            body = init?.body ? JSON.parse(init.body as string) : {}
          } catch {
            body = {}
          }

          const isStreaming = body?.stream === true
          const normalizedModel = normalizeModel(body.model)
          const reasoningMatch = body.model?.match(/-(none|low|medium|high|xhigh)$/)

          const payload: Record<string, any> = {
            ...body,
            model: normalizedModel,
            store: false
          }

          if (payload.input) {
            payload.input = filterInput(payload.input)
          }

          if (reasoningMatch?.[1]) {
            payload.reasoning = {
              ...(payload.reasoning || {}),
              effort: reasoningMatch[1],
              summary: payload.reasoning?.summary || 'auto'
            }
          }

          delete payload.reasoning_effort

          try {
            const headers = new Headers(init?.headers || {})
            headers.delete('x-api-key')
            headers.set('Content-Type', 'application/json')
            headers.set('Authorization', `Bearer ${token}`)
            headers.set(OPENAI_HEADERS.ACCOUNT_ID, accountId)
            headers.set(OPENAI_HEADERS.BETA, OPENAI_HEADER_VALUES.BETA_RESPONSES)
            headers.set(OPENAI_HEADERS.ORIGINATOR, OPENAI_HEADER_VALUES.ORIGINATOR_CODEX)

            const cacheKey = payload?.prompt_cache_key
            if (cacheKey) {
              headers.set(OPENAI_HEADERS.CONVERSATION_ID, cacheKey)
              headers.set(OPENAI_HEADERS.SESSION_ID, cacheKey)
            } else {
              headers.delete(OPENAI_HEADERS.CONVERSATION_ID)
              headers.delete(OPENAI_HEADERS.SESSION_ID)
            }

            headers.set('accept', 'text/event-stream')

            const res = await fetch(url, {
              method: init?.method || 'POST',
              headers,
              body: JSON.stringify(payload)
            })

            const limitUpdate = extractRateLimitUpdate(res.headers)
            if (limitUpdate) {
              updateAccount(account.alias, {
                rateLimits: mergeRateLimits(account.rateLimits, limitUpdate)
              })
            }

            // Handle rate limiting with automatic rotation
            if (res.status === 429) {
              markRateLimited(account.alias, pluginConfig.rateLimitCooldownMs)

              // Try another account
              const retryRotation = await getNextAccount(pluginConfig)
              if (retryRotation && retryRotation.account.alias !== account.alias) {
                return customFetch(input, init)
              }

              // All accounts exhausted
              const errorData = await res.json().catch(() => ({})) as { error?: { message?: string } }
              return new Response(
                JSON.stringify({
                  error: {
                    message: `[multi-auth] Rate limited on all accounts. ${errorData.error?.message || ''}`
                  }
                }),
                { status: 429, headers: { 'Content-Type': 'application/json' } }
              )
            }

            if (!res.ok) {
              return res
            }

            const responseHeaders = ensureContentType(res.headers)
            if (!isStreaming && responseHeaders.get('content-type')?.includes('text/event-stream')) {
              return await convertSseToJson(res, responseHeaders)
            }

            return res
          } catch (err) {
            return new Response(
              JSON.stringify({ error: { message: `[multi-auth] Request failed: ${err}` } }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            )
          }
        }

        // Return SDK configuration with custom fetch for rotation
        return {
          apiKey: 'chatgpt-oauth',
          baseURL: CODEX_BASE_URL,
          fetch: customFetch
        }
      },

      methods: [
        {
          label: 'ChatGPT OAuth (Multi-Account)',
          type: 'oauth' as const,

          prompts: [
            {
              type: 'text' as const,
              key: 'alias',
              message: 'Account alias (e.g., personal, work)',
              placeholder: 'personal'
            }
          ],

          /**
           * OAuth flow - opens browser for ChatGPT login
           */
          authorize: async (inputs?: Record<string, string>) => {
            const alias = inputs?.alias || `account-${Date.now()}`
            const flow = await createAuthorizationFlow()

            return {
              url: flow.url,
              method: 'auto' as const,
              instructions: `Login with your ChatGPT Plus/Pro account for "${alias}"`,

              callback: async () => {
                try {
                  const account = await loginAccount(alias, flow)
                  return {
                    type: 'success' as const,
                    provider: PROVIDER_ID,
                    refresh: account.refreshToken,
                    access: account.accessToken,
                    expires: account.expiresAt
                  }
                } catch {
                  return { type: 'failed' as const }
                }
              }
            }
          }
        },
        {
          label: 'Skip (use existing accounts)',
          type: 'api' as const
        }
      ]
    }
  }
}

export default MultiAuthPlugin
