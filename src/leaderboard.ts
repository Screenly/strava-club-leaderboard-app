/**
 * Turns a club's recent activities into a ranked leaderboard.
 *
 * Strava's club activity feed has no activity dates and no athlete IDs, so
 * the board covers "the club's latest activities" rather than a calendar week,
 * and athletes are told apart by first name and last initial, the only name
 * Strava gives.
 */

import type { ClubActivity } from './strava.js'

export const SPORTS = ['all', 'run', 'ride', 'swim', 'walk'] as const
export type Sport = (typeof SPORTS)[number]

/** Strava `sport_type` values (and legacy `type` values) in each group. */
const SPORT_TYPES: Record<Exclude<Sport, 'all'>, readonly string[]> = {
  run: ['Run', 'TrailRun', 'VirtualRun'],
  ride: [
    'Ride',
    'MountainBikeRide',
    'GravelRide',
    'EBikeRide',
    'EMountainBikeRide',
    'VirtualRide',
    'Velomobile',
    'Handcycle',
  ],
  swim: ['Swim'],
  walk: ['Walk', 'Hike'],
}

export function resolveSport(setting: string): Sport {
  const value = setting.trim().toLowerCase()
  return (SPORTS as readonly string[]).includes(value)
    ? (value as Sport)
    : 'all'
}

/** The fields the board needs, small enough to keep a thousand in storage. */
export interface Activity {
  /** First name and last initial, as Strava gives them. */
  athlete: string
  sport: string
  /** Metres. */
  distance: number
  /** Seconds. */
  movingTime: number
  /** Metres. */
  elevation: number
}

function finite(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Drops anything without an athlete; keeps only what the board shows. */
export function compact(activities: ClubActivity[]): Activity[] {
  const out: Activity[] = []
  for (const activity of activities) {
    const first = activity?.athlete?.firstname?.trim() ?? ''
    const last = activity?.athlete?.lastname?.trim() ?? ''
    const athlete = `${first} ${last}`.trim()
    if (!athlete) continue
    out.push({
      athlete,
      sport: activity.sport_type || activity.type || '',
      distance: finite(activity.distance),
      movingTime: finite(activity.moving_time),
      elevation: finite(activity.total_elevation_gain),
    })
  }
  return out
}

export function matchesSport(activity: Activity, sport: Sport): boolean {
  if (sport === 'all') return true
  return SPORT_TYPES[sport].includes(activity.sport)
}

export interface AthleteStats {
  name: string
  initials: string
  activities: number
  distance: number
  movingTime: number
  elevation: number
  /** The longest single activity, in metres. */
  longest: number
}

export interface Totals {
  athletes: number
  activities: number
  distance: number
  movingTime: number
  elevation: number
}

export interface Leaderboard {
  athletes: AthleteStats[]
  totals: Totals
}

export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
  return letters.slice(0, 2).toUpperCase()
}

/**
 * Ranked by distance, as Strava ranks its own club leaderboard. A tie goes to
 * whoever covered it in less moving time, then to more elevation, then
 * alphabetically, so the order never shuffles between refreshes.
 */
export function compareAthletes(a: AthleteStats, b: AthleteStats): number {
  return (
    b.distance - a.distance ||
    a.movingTime - b.movingTime ||
    b.elevation - a.elevation ||
    a.name.localeCompare(b.name)
  )
}

export function buildLeaderboard(
  activities: Activity[],
  sport: Sport,
): Leaderboard {
  const byName = new Map<string, AthleteStats>()
  const totals: Totals = {
    athletes: 0,
    activities: 0,
    distance: 0,
    movingTime: 0,
    elevation: 0,
  }

  for (const activity of activities) {
    if (!matchesSport(activity, sport)) continue

    const key = activity.athlete.toLocaleLowerCase()
    let stats = byName.get(key)
    if (!stats) {
      stats = {
        name: activity.athlete,
        initials: initialsOf(activity.athlete),
        activities: 0,
        distance: 0,
        movingTime: 0,
        elevation: 0,
        longest: 0,
      }
      byName.set(key, stats)
    }

    stats.activities += 1
    stats.distance += activity.distance
    stats.movingTime += activity.movingTime
    stats.elevation += activity.elevation
    stats.longest = Math.max(stats.longest, activity.distance)

    totals.activities += 1
    totals.distance += activity.distance
    totals.movingTime += activity.movingTime
    totals.elevation += activity.elevation
  }

  const athletes = Array.from(byName.values()).sort(compareAthletes)
  totals.athletes = athletes.length
  return { athletes, totals }
}
