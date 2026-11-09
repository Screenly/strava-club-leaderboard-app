/**
 * Numbers as the board shows them, in the screen's language and the unit
 * system chosen in the settings. Each value comes back split into the number
 * and its unit, so the number can be set large and the unit small.
 */

import type { Sport } from './leaderboard.js'

export type UnitSystem = 'metric' | 'imperial'

export interface Measure {
  value: string
  unit: string
}

const METRES_PER_MILE = 1609.344
const FEET_PER_METRE = 3.28084
const METRES_PER_YARD = 0.9144

export function resolveUnits(setting: string): UnitSystem {
  return setting.trim().toLowerCase() === 'imperial' ? 'imperial' : 'metric'
}

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(
  locale: string,
  unit: string,
  maximumFractionDigits: number,
): Intl.NumberFormat {
  const key = `${locale}|${unit}|${maximumFractionDigits}`
  let cached = formatters.get(key)
  if (!cached) {
    try {
      cached = new Intl.NumberFormat(locale, {
        style: 'unit',
        unit,
        unitDisplay: 'short',
        maximumFractionDigits,
        minimumFractionDigits: maximumFractionDigits > 0 ? 1 : 0,
      })
    } catch {
      cached = new Intl.NumberFormat('en', {
        style: 'unit',
        unit,
        unitDisplay: 'short',
        maximumFractionDigits,
      })
    }
    formatters.set(key, cached)
  }
  return cached
}

function measure(
  locale: string,
  unit: string,
  amount: number,
  digits: number,
): Measure {
  const parts = formatter(locale, unit, digits).formatToParts(amount)
  const value = parts
    .filter((p) => p.type !== 'unit')
    .map((p) => p.value)
    .join('')
    .trim()
  const unitText = parts
    .filter((p) => p.type === 'unit')
    .map((p) => p.value)
    .join('')
  return { value, unit: unitText }
}

export function joined({ value, unit }: Measure): string {
  return unit ? `${value} ${unit}` : value
}

/** One decimal place until the number is big enough not to need it. */
function digitsFor(amount: number): number {
  return amount === 0 || amount >= 100 ? 0 : 1
}

export function formatDistance(
  metres: number,
  units: UnitSystem,
  locale: string,
): Measure {
  if (units === 'imperial') {
    const miles = metres / METRES_PER_MILE
    if (miles > 0 && miles < 0.1) {
      return measure(locale, 'foot', Math.round(metres * FEET_PER_METRE), 0)
    }
    return measure(locale, 'mile', miles, digitsFor(miles))
  }
  if (metres > 0 && metres < 1000) {
    return measure(locale, 'meter', Math.round(metres), 0)
  }
  const km = metres / 1000
  return measure(locale, 'kilometer', km, digitsFor(km))
}

export function formatElevation(
  metres: number,
  units: UnitSystem,
  locale: string,
): Measure {
  return units === 'imperial'
    ? measure(locale, 'foot', Math.round(metres * FEET_PER_METRE), 0)
    : measure(locale, 'meter', Math.round(metres), 0)
}

/** "12h 05m", or "45m" under an hour. */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(Math.max(0, seconds) / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

function clock(seconds: number): string {
  const rounded = Math.round(seconds)
  const minutes = Math.floor(rounded / 60)
  const rest = rounded % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export interface Rate extends Measure {
  label: string
}

/**
 * The average that suits the sport: pace for running and walking, pace per
 * hundred for swimming, speed for riding. With every sport mixed together
 * none of those mean much, so it is the average distance per activity.
 */
export function formatRate(
  distance: number,
  movingTime: number,
  activities: number,
  sport: Sport,
  units: UnitSystem,
  locale: string,
): Rate {
  const imperial = units === 'imperial'

  if (sport === 'all') {
    const average = activities > 0 ? distance / activities : 0
    return { label: 'Avg', ...formatDistance(average, units, locale) }
  }
  if (distance <= 0 || movingTime <= 0) {
    return { label: sport === 'ride' ? 'Speed' : 'Pace', value: '–', unit: '' }
  }
  if (sport === 'ride') {
    const hours = movingTime / 3600
    const speed =
      (imperial ? distance / METRES_PER_MILE : distance / 1000) / hours
    return {
      label: 'Speed',
      ...measure(
        locale,
        imperial ? 'mile-per-hour' : 'kilometer-per-hour',
        speed,
        1,
      ),
    }
  }
  if (sport === 'swim') {
    const per = imperial ? 100 * METRES_PER_YARD : 100
    return {
      label: 'Pace',
      value: clock((movingTime / distance) * per),
      unit: imperial ? '/100yd' : '/100m',
    }
  }
  const per = imperial ? METRES_PER_MILE : 1000
  return {
    label: 'Pace',
    value: clock((movingTime / distance) * per),
    unit: imperial ? '/mi' : '/km',
  }
}

export function formatCount(count: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(count)
  } catch {
    return String(count)
  }
}
