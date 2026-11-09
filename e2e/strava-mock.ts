/**
 * Strava, answered from here, so a screenshot is the same picture every run
 * and never depends on real credentials or the network.
 */

import type { Page } from '@playwright/test'

import type { Club, ClubActivity } from '../src/strava.js'

export const CLUB_ID = '231407'

type Row = [string, string, string, number, number, number]

/** First name, last initial, sport, km, minutes, elevation in metres. */
const ROWS: Row[] = [
  ['Maya', 'O.', 'Run', 21.1, 104, 180],
  ['Maya', 'O.', 'Run', 12.4, 61, 95],
  ['Maya', 'O.', 'TrailRun', 18.2, 118, 640],
  ['Maya', 'O.', 'Run', 8.0, 39, 40],
  ['Jonas', 'K.', 'Run', 15.3, 78, 110],
  ['Jonas', 'K.', 'Run', 10.0, 48, 60],
  ['Jonas', 'K.', 'Run', 25.6, 132, 220],
  ['Priya', 'S.', 'Run', 9.8, 51, 70],
  ['Priya', 'S.', 'Run', 14.2, 74, 120],
  ['Priya', 'S.', 'Run', 16.0, 85, 140],
  ['Priya', 'S.', 'Run', 5.1, 27, 20],
  ['Tom', 'R.', 'Run', 30.2, 165, 410],
  ['Tom', 'R.', 'Run', 6.3, 34, 30],
  ['Lucía', 'M.', 'Run', 12.0, 66, 85],
  ['Lucía', 'M.', 'Run', 13.7, 74, 100],
  ['Lucía', 'M.', 'Run', 7.9, 43, 35],
  ['Kenji', 'T.', 'Run', 21.1, 98, 90],
  ['Kenji', 'T.', 'Run', 5.0, 21, 15],
  ['Amara', 'N.', 'Run', 10.5, 58, 75],
  ['Amara', 'N.', 'Run', 11.2, 61, 80],
  ['Oliver', 'B.', 'Run', 18.0, 101, 160],
  ['Sofia', 'L.', 'Run', 8.4, 47, 50],
  ['Sofia', 'L.', 'Run', 9.1, 50, 55],
  ['Ethan', 'W.', 'VirtualRun', 15.0, 80, 0],
  ['Noor', 'A.', 'Run', 7.2, 41, 25],
  ['Noor', 'A.', 'Run', 6.8, 39, 30],
  ['Liam', 'G.', 'Run', 12.9, 69, 95],
  ['Chloe', 'D.', 'Run', 4.8, 29, 10],
  ['Chloe', 'D.', 'Run', 6.1, 35, 20],
  ['Mateo', 'F.', 'Run', 9.9, 55, 60],
  ['Hannah', 'P.', 'Run', 5.5, 33, 15],
  ['Ravi', 'J.', 'Run', 3.2, 19, 5],
  ['Grace', 'H.', 'Ride', 62.4, 141, 820],
  ['Grace', 'H.', 'Ride', 48.0, 102, 510],
  ['Tom', 'R.', 'Ride', 35.5, 80, 300],
  ['Kenji', 'T.', 'Swim', 2.4, 44, 0],
  ['Amara', 'N.', 'Walk', 4.1, 52, 30],
  ['Oliver', 'B.', 'WeightTraining', 0, 45, 0],
]

export function activities(): ClubActivity[] {
  return ROWS.map(([firstname, lastname, sport, km, minutes, elevation]) => ({
    resource_state: 2,
    athlete: { resource_state: 2, firstname, lastname },
    name: `${sport} session`,
    distance: km * 1000,
    moving_time: minutes * 60,
    elapsed_time: minutes * 60 + 120,
    total_elevation_gain: elevation,
    type: sport,
    sport_type: sport,
  }))
}

export const CLUB_LOGO_URL =
  'https://dgalywyr863hv.cloudfront.net/clubs/logo.png'

export const club: Club = {
  id: Number(CLUB_ID),
  name: 'Riverside Runners',
  profile: CLUB_LOGO_URL,
  profile_medium: CLUB_LOGO_URL,
  member_count: 48,
  sport_type: 'running',
}

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<rect width="120" height="120" fill="#1d3b53"/>
<path d="M18 82 Q40 58 60 74 T102 64" stroke="#5fd3c6" stroke-width="8" fill="none" stroke-linecap="round"/>
<path d="M18 96 Q40 72 60 88 T102 78" stroke="#2f8f9d" stroke-width="6" fill="none" stroke-linecap="round"/>
<text x="60" y="52" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">RR</text>
</svg>`

export interface StravaMockOptions {
  activities?: ClubActivity[]
  /** Answer the activities request with this status instead. */
  activitiesStatus?: number
}

export async function setupStravaMock(
  page: Page,
  options: StravaMockOptions = {},
): Promise<void> {
  const cors = { 'Access-Control-Allow-Origin': '*' }

  await page.route('https://www.strava.com/oauth/token', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        token_type: 'Bearer',
        access_token: 'mock-access',
        refresh_token: 'mock-refresh',
        expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
        expires_in: 6 * 3600,
      },
    }),
  )

  await page.route(
    /https:\/\/www\.strava\.com\/api\/v3\/clubs\/[^/]+\/activities.*/,
    (route) => {
      if (options.activitiesStatus) {
        return route.fulfill({
          status: options.activitiesStatus,
          headers: cors,
          json: { message: 'Mocked failure' },
        })
      }
      const page = Number(
        new URL(route.request().url()).searchParams.get('page'),
      )
      return route.fulfill({
        headers: cors,
        json: page === 1 ? (options.activities ?? activities()) : [],
      })
    },
  )

  await page.route(
    /https:\/\/www\.strava\.com\/api\/v3\/clubs\/[^/?]+$/,
    (route) => route.fulfill({ headers: cors, json: club }),
  )

  await page.route(CLUB_LOGO_URL, (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: LOGO_SVG }),
  )
}

export function mockSettings(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    access_token: 'mock-access',
    activity_type: 'run',
    client_id: '12345',
    client_secret: 'mock-secret',
    club_id: CLUB_ID,
    refresh_token: 'mock-refresh',
    theme: 'dark',
    unit_type: 'metric',
    ...overrides,
  }
}
