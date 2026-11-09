import { describe, expect, test } from 'bun:test'

import {
  PAGE_SIZE,
  rateLimitResetAt,
  StravaClient,
  StravaError,
  TOKEN_URL,
  type Tokens,
  type TokenStore,
} from './strava.js'

const NOW = Date.UTC(2026, 10, 10, 12, 7, 0)
const NOW_S = Math.floor(NOW / 1000)

const credentials = {
  clientId: '123',
  clientSecret: 'secret',
  accessToken: 'configured-access',
  refreshToken: 'configured-refresh',
}

function memoryStore(initial: Tokens | null = null) {
  let saved = initial
  const store: TokenStore & { saved: () => Tokens | null } = {
    load: () => saved,
    save: (tokens) => {
      saved = tokens
    },
    saved: () => saved,
  }
  return store
}

type Handler = (url: string, init: RequestInit) => Response

function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    return handler(url, init)
  }) as typeof fetch
  return { impl, calls }
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const tokenResponse = (access = 'fresh-access', refresh = 'rotated-refresh') =>
  json({
    access_token: access,
    refresh_token: refresh,
    expires_at: NOW_S + 6 * 3600,
  })

describe('StravaClient tokens', () => {
  test('refreshes first when the expiry is unknown, and keeps the new tokens', async () => {
    const store = memoryStore()
    const { impl, calls } = fakeFetch((url) =>
      url === TOKEN_URL ? tokenResponse() : json({ id: 1, name: 'Club' }),
    )
    const client = new StravaClient(credentials, store, impl, () => NOW)

    await client.club('42')

    expect(calls.map((c) => c.url)).toEqual([
      TOKEN_URL,
      'https://www.strava.com/api/v3/clubs/42',
    ])
    const body = new URLSearchParams(String(calls[0].init.body))
    expect(body.get('refresh_token')).toBe('configured-refresh')
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(
      (calls[1].init.headers as Record<string, string>).Authorization,
    ).toBe('Bearer fresh-access')
    expect(store.saved()).toEqual({
      accessToken: 'fresh-access',
      refreshToken: 'rotated-refresh',
      expiresAt: NOW_S + 6 * 3600,
    })
  })

  test('uses a stored token that is still valid without refreshing', async () => {
    const store = memoryStore({
      accessToken: 'stored',
      refreshToken: 'r',
      expiresAt: NOW_S + 3600,
    })
    const { impl, calls } = fakeFetch(() => json({ id: 1, name: 'Club' }))
    await new StravaClient(credentials, store, impl, () => NOW).club('42')
    expect(calls).toHaveLength(1)
  })

  test('refreshes a token about to expire', async () => {
    const store = memoryStore({
      accessToken: 'old',
      refreshToken: 'r',
      expiresAt: NOW_S + 60,
    })
    const { impl, calls } = fakeFetch((url) =>
      url === TOKEN_URL ? tokenResponse() : json({}),
    )
    await new StravaClient(credentials, store, impl, () => NOW).club('42')
    expect(calls[0].url).toBe(TOKEN_URL)
    expect(
      new URLSearchParams(String(calls[0].init.body)).get('refresh_token'),
    ).toBe('r')
  })
})

describe('StravaClient token failures', () => {
  test('on a 401 refreshes once and retries', async () => {
    const store = memoryStore({
      accessToken: 'revoked',
      refreshToken: 'r',
      expiresAt: NOW_S + 3600,
    })
    let apiCalls = 0
    const { impl, calls } = fakeFetch((url) => {
      if (url === TOKEN_URL) return tokenResponse()
      apiCalls += 1
      return apiCalls === 1
        ? json({ message: 'Authorization Error' }, 401)
        : json({})
    })
    await new StravaClient(credentials, store, impl, () => NOW).club('42')
    expect(calls.map((c) => c.url === TOKEN_URL)).toEqual([false, true, false])
  })

  test('a refused refresh is an auth error', async () => {
    const { impl } = fakeFetch((url) =>
      url === TOKEN_URL
        ? json({ message: 'Bad Request' }, 400)
        : json({ message: 'Authorization Error' }, 401),
    )
    const client = new StravaClient(credentials, memoryStore(), impl, () => NOW)
    const error = (await client.club('42').catch((e) => e)) as StravaError
    expect(error).toBeInstanceOf(StravaError)
    expect(error.isAuth).toBe(true)
  })

  test('concurrent requests share one refresh', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url === TOKEN_URL ? tokenResponse() : json([]),
    )
    const client = new StravaClient(credentials, memoryStore(), impl, () => NOW)
    await Promise.all([client.club('1'), client.clubActivities('1', 5)])
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1)
  })
})

describe('StravaClient activities', () => {
  const valid = () =>
    memoryStore({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: NOW_S + 3600,
    })

  test('stops paging at a short page', async () => {
    const full = Array.from({ length: PAGE_SIZE }, () => ({ distance: 1 }))
    const { impl, calls } = fakeFetch((url) =>
      url.includes('page=1&') ? json(full) : json([{ distance: 2 }]),
    )
    const all = await new StravaClient(
      credentials,
      valid(),
      impl,
      () => NOW,
    ).clubActivities('7', 5)
    expect(all).toHaveLength(PAGE_SIZE + 1)
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain('/clubs/7/activities?page=1&per_page=200')
  })

  test('stops at the page limit', async () => {
    const full = Array.from({ length: PAGE_SIZE }, () => ({ distance: 1 }))
    const { impl, calls } = fakeFetch(() => json(full))
    await new StravaClient(
      credentials,
      valid(),
      impl,
      () => NOW,
    ).clubActivities('7', 3)
    expect(calls).toHaveLength(3)
  })

  test('a 429 fails fast with when to try again', async () => {
    const { impl, calls } = fakeFetch(() => json({}, 429))
    const error = (await new StravaClient(credentials, valid(), impl, () => NOW)
      .clubActivities('7', 5)
      .catch((e) => e)) as StravaError
    expect(error.isRateLimit).toBe(true)
    expect(error.retryAt).toBe(Date.UTC(2026, 10, 10, 12, 15, 0))
    expect(calls).toHaveLength(1)
  })

  test('a 404 is passed on', async () => {
    const { impl } = fakeFetch(() => json({ message: 'Record Not Found' }, 404))
    const error = (await new StravaClient(credentials, valid(), impl, () => NOW)
      .club('nope')
      .catch((e) => e)) as StravaError
    expect(error.status).toBe(404)
    expect(error.message).toBe('Record Not Found')
  })
})

describe('rateLimitResetAt', () => {
  test('next quarter hour by default', () => {
    expect(rateLimitResetAt(new Headers(), NOW)).toBe(
      Date.UTC(2026, 10, 10, 12, 15, 0),
    )
  })

  test('midnight UTC when the daily limit is spent', () => {
    const headers = new Headers({
      'X-ReadRateLimit-Limit': '100,1000',
      'X-ReadRateLimit-Usage': '12,1000',
    })
    expect(rateLimitResetAt(headers, NOW)).toBe(Date.UTC(2026, 10, 11))
  })
})
