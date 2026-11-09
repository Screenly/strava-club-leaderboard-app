import './style.css'
import '@screenly/edge-apps/components'
import {
  getSettingWithDefault,
  readEdgeAppCache,
  reportError,
  setupErrorHandling,
  setupSentry,
  signalReady,
  writeEdgeAppCache,
} from '@screenly/edge-apps'

import { formatCount, resolveUnits } from './format.js'
import { buildLeaderboard, compact, resolveSport } from './leaderboard.js'
import {
  renderBoard,
  renderClub,
  renderMessage,
  renderScope,
  renderStatic,
  renderStatus,
  renderTotals,
  setState,
  type View,
} from './render.js'
import {
  createStore,
  createTokenStore,
  NAMESPACE,
  removeLegacyCache,
  type ActivitiesSnapshot,
  type ClubSnapshot,
  type Storage,
  type Store,
} from './store.js'
import { explain, timeLabel } from './messages.js'
import { StravaClient, StravaError } from './strava.js'
import { resolveTheme } from './theme.js'

/**
 * How old the board may get before Strava is asked again. Strava allows an
 * app 100 reads every 15 minutes across every screen it runs on, and one
 * refresh costs one to five of them.
 */
const REFRESH_MS = 15 * 60 * 1000
/** A club's name and picture hardly ever change. */
const CLUB_TTL_MS = 24 * 60 * 60 * 1000
/** After a failure that is not a rate limit. */
const RETRY_MS = 5 * 60 * 1000
/** Pages of 200; the club's latest 1,000 activities at most. */
const MAX_PAGES = 5

const storage: Storage = {
  read: <T>(key: string) => readEdgeAppCache<T>(NAMESPACE, key),
  write: (key, value) => writeEdgeAppCache(NAMESPACE, key, value),
}

interface Settings {
  clubId: string
  clientId: string
  clientSecret: string
  accessToken: string
  refreshToken: string
}

function readSettings(): Settings {
  const text = (key: string) => getSettingWithDefault<string>(key, '').trim()
  return {
    clubId: text('club_id'),
    clientId: text('client_id'),
    clientSecret: text('client_secret'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
  }
}

function missingSettings(settings: Settings): string[] {
  const missing: string[] = []
  if (!settings.clubId) missing.push('club ID')
  if (!settings.accessToken && !settings.refreshToken) {
    missing.push('access or refresh token')
  }
  if (settings.refreshToken && (!settings.clientId || !settings.clientSecret)) {
    missing.push('client ID and secret')
  }
  return missing
}

interface State {
  activities: ActivitiesSnapshot | null
  club: ClubSnapshot | null
  error: StravaError | null
  /** Set while the first ever load for this club is still under way. */
  loading: boolean
}

/** Draws whatever the state holds: the board, or why there is none. */
function drawBoard(state: State, view: View) {
  renderClub(state.club, 'Strava club')

  const snapshot = state.activities
  if (!snapshot) {
    if (state.loading || !state.error) {
      setState('loading')
      renderStatus('Connecting to Strava', 'live')
      return
    }
    renderMessage(...explain(state.error, view.locale))
    renderStatus('Not connected', 'error')
    return
  }

  const at = timeLabel(snapshot.fetchedAt, view.locale)
  const stale = Date.now() - snapshot.fetchedAt > 3 * REFRESH_MS
  if (state.error?.isRateLimit) {
    renderStatus(`Strava rate limit · showing ${at}`, 'stale')
  } else if (state.error || stale) {
    renderStatus(`Offline · last updated ${at}`, 'stale')
  } else {
    renderStatus(`Updated ${at}`, 'live')
  }
  renderScope(
    `From the club's latest ${formatCount(snapshot.activities.length, view.locale)} activities`,
  )

  const board = buildLeaderboard(snapshot.activities, view.sport)
  renderTotals(board, view)
  if (board.athletes.length === 0) {
    renderMessage(
      'No activities yet',
      view.sport === 'all'
        ? "Nobody in the club has shared an activity recently. They'll appear here as they do."
        : 'None of the club\'s latest activities are of this sport. Choose "All sports" in the settings to see everyone.',
    )
    return
  }
  setState('board')
  renderBoard(board, view)
}

async function fetchActivities(
  client: StravaClient,
  store: Store,
  settings: Settings,
  state: State,
) {
  try {
    const raw = await client.clubActivities(settings.clubId, MAX_PAGES)
    const fetchedAt = Date.now()
    const activities = compact(raw)
    store.saveActivities(activities, fetchedAt)
    state.activities = {
      version: 0,
      clubId: settings.clubId,
      fetchedAt,
      activities,
    }
    state.error = null
  } catch (error) {
    const failure =
      error instanceof StravaError
        ? error
        : new StravaError((error as Error).message, 0)
    state.error = failure
    if (failure.isRateLimit && failure.retryAt) {
      store.setBackoff(failure.retryAt)
    }
    console.warn('Could not fetch club activities', failure)
    if (!failure.isRateLimit) {
      reportError(failure, {
        clubId: settings.clubId,
        status: failure.status,
      })
    }
  }
}

function createApp(settings: Settings, view: View, store: Store) {
  const client = new StravaClient(
    settings,
    createTokenStore(storage, settings.clientId, settings.refreshToken),
  )
  const state: State = {
    activities: store.activities(),
    club: store.club(),
    error: null,
    loading: false,
  }

  const draw = () => drawBoard(state, view)

  async function loadClub() {
    const cached = state.club
    if (cached && Date.now() - cached.fetchedAt < CLUB_TTL_MS) return
    try {
      const club = await client.club(settings.clubId)
      store.saveClub(club)
      state.club = store.club()
    } catch (error) {
      // The name and picture are a nicety; the board works without them.
      console.warn('Could not fetch the club', error)
    }
  }

  const loadActivities = () => fetchActivities(client, store, settings, state)

  /** When Strava should next be asked, in epoch ms. */
  function nextDue(): number {
    const now = Date.now()
    const backoff = store.backoffUntil(now)
    if (backoff) return backoff
    if (state.error) {
      return now + (state.error.isAuth ? REFRESH_MS : RETRY_MS)
    }
    return (state.activities?.fetchedAt ?? now) + REFRESH_MS
  }

  let timer: number | undefined
  let running: Promise<void> | null = null

  function schedule() {
    window.clearTimeout(timer)
    const delay = Math.max(30 * 1000, nextDue() - Date.now())
    timer = window.setTimeout(() => void refresh(), delay)
  }

  /** One refresh at a time; a second caller waits for the first. */
  function refresh(): Promise<void> {
    if (running) return running
    running = (async () => {
      const backoff = store.backoffUntil()
      if (backoff) {
        state.error = new StravaError('Strava rate limit reached', 429, backoff)
        return
      }
      state.loading = !state.activities
      draw()
      await Promise.all([loadClub(), loadActivities()])
      state.loading = false
    })().finally(() => {
      running = null
      draw()
      schedule()
    })
    return running
  }

  function isDue(): boolean {
    return nextDue() <= Date.now()
  }

  return { state, draw, refresh, schedule, isDue }
}

function applyTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(
    getSettingWithDefault<string>('theme', 'dark'),
  )
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

document.addEventListener('DOMContentLoaded', async () => {
  setupErrorHandling()
  setupSentry('strava-club-leaderboard-app')
  applyTheme()
  removeLegacyCache()

  const view: View = {
    locale: navigator.languages?.[0] || navigator.language || 'en',
    units: resolveUnits(getSettingWithDefault<string>('unit_type', 'metric')),
    sport: resolveSport(getSettingWithDefault<string>('activity_type', 'all')),
  }
  renderStatic(view)

  const settings = readSettings()
  const missing = missingSettings(settings)
  if (missing.length > 0) {
    renderClub(null, 'Strava club')
    renderStatus('Not connected', 'error')
    renderMessage(
      'Finish setting up the app',
      `Add the Strava ${missing.join(', ')} in the app settings.`,
    )
    signalReady()
    return
  }

  const store = createStore(storage, settings.clubId)
  const app = createApp(settings, view, store)

  // Whatever this screen saw last goes up straight away. Strava is only
  // asked when that is older than the refresh interval.
  await nextFrame()
  app.draw()

  if (app.state.activities) {
    signalReady()
    if (app.isDue()) void app.refresh()
    else app.schedule()
  } else {
    await app.refresh()
    signalReady()
  }

  let resizeTimer: number | undefined
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(app.draw, 150)
  })
})
