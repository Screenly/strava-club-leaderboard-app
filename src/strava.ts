/**
 * The Strava API, as this app uses it: one club, its details and its recent
 * activities, with the access token kept alive by the refresh token.
 *
 * Nothing here touches the DOM or the Screenly library, so it can be tested
 * outside a browser. Storage and `fetch` are passed in.
 */

export const API_BASE = 'https://www.strava.com/api/v3'
export const TOKEN_URL = 'https://www.strava.com/oauth/token'

/** The most Strava returns in one page of club activities. */
export const PAGE_SIZE = 200

/** Refresh this long before Strava says the access token expires. */
const EXPIRY_MARGIN_S = 5 * 60

const REQUEST_TIMEOUT_MS = 15 * 1000

/**
 * One activity as `GET /clubs/{id}/activities` returns it. Strava leaves out
 * the activity's date and the athlete's ID here, and gives only the initial
 * of the athlete's last name.
 */
export interface ClubActivity {
  athlete?: { firstname?: string; lastname?: string }
  name?: string
  distance?: number
  moving_time?: number
  elapsed_time?: number
  total_elevation_gain?: number
  type?: string
  sport_type?: string
}

export interface Club {
  id: number
  name: string
  profile_medium?: string
  profile?: string
  member_count?: number
  sport_type?: string
}

export interface Tokens {
  accessToken: string
  refreshToken: string
  /** Epoch seconds; 0 when nobody has told us yet. */
  expiresAt: number
}

export interface TokenStore {
  load(): Tokens | null
  save(tokens: Tokens): void
}

export class StravaError extends Error {
  readonly status: number
  /** For a rate limit: epoch ms when it is worth asking again. */
  readonly retryAt: number | null

  constructor(message: string, status: number, retryAt: number | null = null) {
    super(message)
    this.name = 'StravaError'
    this.status = status
    this.retryAt = retryAt
  }

  get isAuth(): boolean {
    return this.status === 401 || this.status === 403
  }

  get isRateLimit(): boolean {
    return this.status === 429
  }
}

export interface Credentials {
  clientId: string
  clientSecret: string
  accessToken: string
  refreshToken: string
}

type Fetch = typeof fetch

const QUARTER_HOUR_MS = 15 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * When a rate limit lifts. Strava's short window resets on the quarter hour
 * and its daily one at midnight UTC. The usage headers say which was hit,
 * when the browser is allowed to read them; otherwise assume the short one.
 */
export function rateLimitResetAt(headers: Headers, now: number): number {
  const nextQuarter = Math.floor(now / QUARTER_HOUR_MS + 1) * QUARTER_HOUR_MS
  const nextMidnight = Math.floor(now / DAY_MS + 1) * DAY_MS

  const pairs: Array<[string | null, string | null]> = [
    [headers.get('x-ratelimit-limit'), headers.get('x-ratelimit-usage')],
    [
      headers.get('x-readratelimit-limit'),
      headers.get('x-readratelimit-usage'),
    ],
  ]
  for (const [limit, usage] of pairs) {
    if (!limit || !usage) continue
    const [, dailyLimit] = limit.split(',').map(Number)
    const [, dailyUsage] = usage.split(',').map(Number)
    if (dailyLimit && dailyUsage >= dailyLimit) return nextMidnight
  }
  return nextQuarter
}

async function messageOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string }
    if (body?.message) return body.message
  } catch {
    // Not JSON; the status text will do.
  }
  return response.statusText || `HTTP ${response.status}`
}

export class StravaClient {
  private tokens: Tokens
  private refreshing: Promise<Tokens> | null = null

  constructor(
    private readonly credentials: Credentials,
    private readonly store: TokenStore,
    private readonly fetchImpl: Fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = store.load() ?? {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: 0,
    }
  }

  private async request(url: string, init: RequestInit = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new StravaError('Strava took too long to answer', 0)
      }
      throw new StravaError(
        `Could not reach Strava (${(error as Error).message})`,
        0,
      )
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Swap the refresh token for a fresh access token. Strava hands back the
   * current one if it still has an hour left, so this is cheap. Only one
   * refresh runs at a time; anyone else waits for it.
   */
  refresh(): Promise<Tokens> {
    if (this.refreshing) return this.refreshing

    const { clientId, clientSecret } = this.credentials
    const run = async (): Promise<Tokens> => {
      if (!clientId || !clientSecret || !this.tokens.refreshToken) {
        throw new StravaError(
          'The client ID, client secret and refresh token are all needed to renew access',
          401,
        )
      }
      const response = await this.request(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: this.tokens.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      })
      if (!response.ok) {
        // Strava answers a bad client or refresh token with 400.
        const status = response.status === 400 ? 401 : response.status
        throw new StravaError(
          `Strava refused to renew access: ${await messageOf(response)}`,
          status,
          status === 429
            ? rateLimitResetAt(response.headers, this.now())
            : null,
        )
      }
      const body = (await response.json()) as {
        access_token: string
        refresh_token?: string
        expires_at: number
      }
      this.tokens = {
        accessToken: body.access_token,
        // Strava may rotate the refresh token; the newest one is the one to keep.
        refreshToken: body.refresh_token || this.tokens.refreshToken,
        expiresAt: Number(body.expires_at) || 0,
      }
      this.store.save(this.tokens)
      return this.tokens
    }

    this.refreshing = run().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private needsRefresh(): boolean {
    const nowS = Math.floor(this.now() / 1000)
    return this.tokens.expiresAt - EXPIRY_MARGIN_S <= nowS
  }

  /**
   * A token worth sending. With no known expiry (first run on this screen) a
   * refresh tells us one; if that fails, the configured access token may
   * still work, and a 401 from the API will say so if it does not.
   */
  private async accessToken(): Promise<string> {
    if (!this.needsRefresh()) return this.tokens.accessToken
    try {
      return (await this.refresh()).accessToken
    } catch (error) {
      if (this.tokens.expiresAt === 0 && this.tokens.accessToken) {
        return this.tokens.accessToken
      }
      throw error
    }
  }

  async get<T>(path: string, retried = false): Promise<T> {
    const token = await this.accessToken()
    const response = await this.request(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (response.status === 401 && !retried) {
      await this.refresh()
      return this.get<T>(path, true)
    }
    if (response.status === 429) {
      throw new StravaError(
        'Strava rate limit reached',
        429,
        rateLimitResetAt(response.headers, this.now()),
      )
    }
    if (!response.ok) {
      throw new StravaError(await messageOf(response), response.status)
    }
    return (await response.json()) as T
  }

  club(clubId: string): Promise<Club> {
    return this.get<Club>(`/clubs/${encodeURIComponent(clubId)}`)
  }

  /**
   * The club's most recent activities, newest first, a page at a time until
   * a short page says there are no more or `maxPages` is reached.
   */
  async clubActivities(clubId: string, maxPages: number) {
    const all: ClubActivity[] = []
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(PAGE_SIZE),
      })
      const batch = await this.get<ClubActivity[]>(
        `/clubs/${encodeURIComponent(clubId)}/activities?${params}`,
      )
      if (!Array.isArray(batch)) {
        throw new StravaError('Strava sent an unexpected answer', 502)
      }
      all.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }
    return all
  }
}
