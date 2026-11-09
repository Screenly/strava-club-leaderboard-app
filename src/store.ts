/**
 * What the app keeps on the screen between loads.
 *
 * An Edge App is loaded afresh each time its turn comes round in a playlist,
 * so without this every turn would cost a round of Strava requests and a
 * blank loading screen. With it, a turn shows the last board at once and only
 * asks Strava when that board is older than the refresh interval.
 *
 * Reads and writes go through the functions passed in (the library's
 * `readEdgeAppCache` and `writeEdgeAppCache` in the app), which fail quietly
 * when storage is unavailable or full.
 */

import type { Activity } from './leaderboard.js'
import type { Club, Tokens, TokenStore } from './strava.js'

export const NAMESPACE = 'strava-club-leaderboard'

/** Bump when the shape of anything stored changes. */
const VERSION = 2

export interface Storage {
  read<T>(key: string): T | null
  write(key: string, value: unknown): void
}

export interface ActivitiesSnapshot {
  version: number
  clubId: string
  /** Epoch ms when Strava sent these. */
  fetchedAt: number
  activities: Activity[]
}

export interface ClubSnapshot {
  version: number
  fetchedAt: number
  club: Pick<
    Club,
    'id' | 'name' | 'profile' | 'profile_medium' | 'member_count'
  >
}

interface StoredTokens extends Tokens {
  version: number
  /** The refresh token in the settings when these were issued. */
  seed: string
}

interface Backoff {
  until: number
}

/** A snapshot is fit to show if it has the right shape and is not from the future. */
function usable(
  snapshot: { version?: number; fetchedAt?: number } | null,
  now: number,
): boolean {
  return (
    !!snapshot &&
    snapshot.version === VERSION &&
    typeof snapshot.fetchedAt === 'number' &&
    snapshot.fetchedAt <= now
  )
}

export function createStore(storage: Storage, clubId: string) {
  const activitiesKey = `activities:${clubId}`
  const clubKey = `club:${clubId}`
  const backoffKey = 'backoff'

  return {
    activities(now = Date.now()): ActivitiesSnapshot | null {
      const snapshot = storage.read<ActivitiesSnapshot>(activitiesKey)
      if (!usable(snapshot, now) || !Array.isArray(snapshot?.activities)) {
        return null
      }
      return snapshot
    },

    saveActivities(activities: Activity[], fetchedAt = Date.now()) {
      storage.write(activitiesKey, {
        version: VERSION,
        clubId,
        fetchedAt,
        activities,
      } satisfies ActivitiesSnapshot)
    },

    club(now = Date.now()): ClubSnapshot | null {
      const snapshot = storage.read<ClubSnapshot>(clubKey)
      return usable(snapshot, now) && snapshot?.club ? snapshot : null
    },

    saveClub(club: Club, fetchedAt = Date.now()) {
      storage.write(clubKey, {
        version: VERSION,
        fetchedAt,
        club: {
          id: club.id,
          name: club.name,
          profile: club.profile,
          profile_medium: club.profile_medium,
          member_count: club.member_count,
        },
      } satisfies ClubSnapshot)
    },

    /** Epoch ms before which Strava should not be asked again, or 0. */
    backoffUntil(now = Date.now()): number {
      const until = storage.read<Backoff>(backoffKey)?.until ?? 0
      return until > now ? until : 0
    },

    setBackoff(until: number) {
      storage.write(backoffKey, { until } satisfies Backoff)
    },
  }
}

export type Store = ReturnType<typeof createStore>

/**
 * Keeps the latest tokens Strava issued, so a reload neither starts again from
 * the expired access token in the settings nor loses a rotated refresh token.
 * Tokens issued for a different refresh token than the one now in the
 * settings are ignored: someone has reconnected the app.
 */
export function createTokenStore(
  storage: Storage,
  clientId: string,
  configuredRefreshToken: string,
): TokenStore {
  const key = `tokens:${clientId}`
  return {
    load() {
      const stored = storage.read<StoredTokens>(key)
      if (
        !stored ||
        stored.version !== VERSION ||
        stored.seed !== configuredRefreshToken ||
        !stored.accessToken ||
        !stored.refreshToken
      ) {
        return null
      }
      return {
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        expiresAt: Number(stored.expiresAt) || 0,
      }
    },
    save(tokens) {
      storage.write(key, {
        ...tokens,
        version: VERSION,
        seed: configuredRefreshToken,
      } satisfies StoredTokens)
    },
  }
}

/** The previous version of this app cached under `strava_club_*` keys. */
export function removeLegacyCache(): void {
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('strava_club_')) stale.push(key)
    }
    stale.forEach((key) => localStorage.removeItem(key))
  } catch {
    // No storage, nothing to clean.
  }
}
