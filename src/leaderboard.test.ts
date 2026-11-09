import { describe, expect, test } from 'bun:test'

import {
  buildLeaderboard,
  compact,
  initialsOf,
  resolveSport,
  type Activity,
} from './leaderboard.js'
import type { ClubActivity } from './strava.js'

function activity(
  firstname: string,
  lastname: string,
  distance: number,
  moving_time: number,
  sport_type = 'Run',
  total_elevation_gain = 0,
): ClubActivity {
  return {
    athlete: { firstname, lastname },
    distance,
    moving_time,
    total_elevation_gain,
    sport_type,
    type: sport_type,
  }
}

describe('compact', () => {
  test('keeps the fields the board needs and drops nameless entries', () => {
    const result = compact([
      activity('Ada', 'L.', 5000, 1500, 'TrailRun', 120),
      { distance: 1000 } as ClubActivity,
      { athlete: { firstname: '  ', lastname: '' }, distance: 10 },
    ])
    expect(result).toEqual([
      {
        athlete: 'Ada L.',
        sport: 'TrailRun',
        distance: 5000,
        movingTime: 1500,
        elevation: 120,
      },
    ])
  })

  test('treats missing or bad numbers as zero', () => {
    const [a] = compact([
      {
        athlete: { firstname: 'Bo', lastname: 'K.' },
        distance: Number.NaN,
        moving_time: -5,
        type: 'Yoga',
      },
    ])
    expect(a.distance).toBe(0)
    expect(a.movingTime).toBe(0)
    expect(a.elevation).toBe(0)
    expect(a.sport).toBe('Yoga')
  })
})

describe('buildLeaderboard', () => {
  const activities: Activity[] = compact([
    activity('Ada', 'L.', 10000, 3000),
    activity('Ada', 'L.', 5000, 1500),
    activity('Grace', 'H.', 20000, 2400, 'Ride', 300),
    activity('Alan', 'T.', 15000, 4500),
    activity('ada', 'l.', 1000, 400, 'Walk'),
  ])

  test('sums each athlete and ranks by distance', () => {
    const { athletes, totals } = buildLeaderboard(activities, 'all')
    expect(athletes.map((a) => a.name)).toEqual([
      'Grace H.',
      'Ada L.',
      'Alan T.',
    ])
    const ada = athletes[1]
    expect(ada.activities).toBe(3)
    expect(ada.distance).toBe(16000)
    expect(ada.movingTime).toBe(4900)
    expect(ada.longest).toBe(10000)
    expect(totals).toEqual({
      athletes: 3,
      activities: 5,
      distance: 51000,
      movingTime: 11800,
      elevation: 300,
    })
  })

  test('filters to one sport, counting its sub-types', () => {
    const { athletes, totals } = buildLeaderboard(activities, 'run')
    expect(athletes.map((a) => [a.name, a.distance])).toEqual([
      ['Ada L.', 15000],
      ['Alan T.', 15000],
    ])
    expect(totals.activities).toBe(3)
  })

  test('breaks a distance tie on moving time, then elevation, then name', () => {
    const tied = compact([
      activity('Zed', 'A.', 5000, 1500),
      activity('Amy', 'B.', 5000, 1500),
      activity('Max', 'C.', 5000, 1400),
      activity('Kim', 'D.', 5000, 1500, 'Run', 50),
    ])
    const names = buildLeaderboard(tied, 'run').athletes.map((a) => a.name)
    expect(names).toEqual(['Max C.', 'Kim D.', 'Amy B.', 'Zed A.'])
  })

  test('is empty for no activities', () => {
    expect(buildLeaderboard([], 'all').athletes).toEqual([])
  })
})

describe('helpers', () => {
  test('initials', () => {
    expect(initialsOf('Ada L.')).toBe('AL')
    expect(initialsOf('Émile')).toBe('É')
    expect(initialsOf('Anna Maria B.')).toBe('AM')
  })

  test('resolveSport falls back to all', () => {
    expect(resolveSport('Ride')).toBe('ride')
    expect(resolveSport('ski')).toBe('all')
  })
})
