/** What the screen says about the time and about failures. */

import type { StravaError } from './strava.js'

export function timeLabel(
  at: number,
  locale: string,
  now = Date.now(),
): string {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString()
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      ...(sameDay ? {} : { weekday: 'short' }),
    }).format(at)
  } catch {
    return new Date(at).toLocaleTimeString()
  }
}

/** A title and a hint for a failure with nothing cached to show instead. */
export function explain(error: StravaError, locale: string): [string, string] {
  if (error.isRateLimit) {
    const at = error.retryAt ? timeLabel(error.retryAt, locale) : 'shortly'
    return [
      'Strava rate limit reached',
      `Too many requests for this Strava app. The leaderboard will try again at ${at}.`,
    ]
  }
  if (error.status === 404) {
    return [
      'Club not found',
      "Check the club ID in the app settings. It is the number in the club's address on strava.com.",
    ]
  }
  if (error.status === 403) {
    return [
      'No access to this club',
      'The Strava account that authorised the app must be a member of the club.',
    ]
  }
  if (error.isAuth) {
    return [
      'Strava refused access',
      'Check the client ID, client secret and tokens in the app settings. The refresh token needs the "read" scope.',
    ]
  }
  return [
    'Could not reach Strava',
    `${error.message}. Trying again in a few minutes.`,
  ]
}
