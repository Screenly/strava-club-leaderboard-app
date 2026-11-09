import { describe, expect, test } from 'bun:test'

import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatRate,
  joined,
} from './format.js'

const en = 'en-US'

describe('formatDistance', () => {
  test('metric', () => {
    expect(joined(formatDistance(42195, 'metric', en))).toBe('42.2 km')
    expect(joined(formatDistance(123456, 'metric', en))).toBe('123 km')
    expect(joined(formatDistance(850, 'metric', en))).toBe('850 m')
    expect(joined(formatDistance(0, 'metric', en))).toBe('0 km')
  })

  test('imperial', () => {
    expect(joined(formatDistance(1609.344 * 26.2, 'imperial', en))).toBe(
      '26.2 mi',
    )
    expect(joined(formatDistance(100, 'imperial', en))).toBe('328 ft')
  })

  test('splits number from unit', () => {
    expect(formatDistance(5000, 'metric', en)).toEqual({
      value: '5.0',
      unit: 'km',
    })
  })
})

test('formatElevation', () => {
  expect(joined(formatElevation(1234.4, 'metric', en))).toBe('1,234 m')
  expect(joined(formatElevation(1000, 'imperial', en))).toBe('3,281 ft')
})

test('formatDuration', () => {
  expect(formatDuration(0)).toBe('0m')
  expect(formatDuration(45 * 60)).toBe('45m')
  expect(formatDuration(3600 + 5 * 60)).toBe('1h 05m')
  expect(formatDuration(100 * 3600)).toBe('100h 00m')
})

describe('formatRate', () => {
  test('running pace per km and per mile', () => {
    // 10 km in 50 minutes is 5:00 /km, 8:03 /mi
    expect(joined(formatRate(10000, 3000, 2, 'run', 'metric', en))).toBe(
      '5:00 /km',
    )
    expect(joined(formatRate(10000, 3000, 2, 'run', 'imperial', en))).toBe(
      '8:03 /mi',
    )
  })

  test('cycling speed', () => {
    expect(joined(formatRate(30000, 3600, 1, 'ride', 'metric', en))).toBe(
      '30.0 km/h',
    )
    expect(joined(formatRate(30000, 3600, 1, 'ride', 'imperial', en))).toBe(
      '18.6 mph',
    )
  })

  test('swim pace per 100', () => {
    expect(joined(formatRate(2000, 2400, 1, 'swim', 'metric', en))).toBe(
      '2:00 /100m',
    )
  })

  test('average distance across all sports', () => {
    const rate = formatRate(30000, 9999, 3, 'all', 'metric', en)
    expect(rate.label).toBe('Avg')
    expect(joined(rate)).toBe('10.0 km')
  })

  test('no distance gives a dash, not Infinity', () => {
    expect(formatRate(0, 600, 1, 'run', 'metric', en).value).toBe('–')
  })
})
