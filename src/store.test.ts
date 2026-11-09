import { describe, expect, test } from 'bun:test'

import { createStore, createTokenStore, type Storage } from './store.js'

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    read: <T>(key: string) => {
      const raw = data.get(key)
      return raw ? (JSON.parse(raw) as T) : null
    },
    write: (key, value) => {
      data.set(key, JSON.stringify(value))
    },
  }
}

const activity = {
  athlete: 'Ada L.',
  sport: 'Run',
  distance: 1,
  movingTime: 1,
  elevation: 0,
}

describe('store', () => {
  test('round-trips activities per club', () => {
    const storage = memory()
    createStore(storage, '1').saveActivities([activity], 1000)
    expect(createStore(storage, '1').activities(2000)?.activities).toEqual([
      activity,
    ])
    expect(createStore(storage, '2').activities(2000)).toBeNull()
  })

  test('ignores a snapshot from the future or an older version', () => {
    const storage = memory()
    const store = createStore(storage, '1')
    store.saveActivities([activity], 5000)
    expect(store.activities(4000)).toBeNull()

    storage.write('activities:1', { version: 1, fetchedAt: 1, activities: [] })
    expect(store.activities(2000)).toBeNull()
  })

  test('backoff only while it lasts', () => {
    const store = createStore(memory(), '1')
    store.setBackoff(5000)
    expect(store.backoffUntil(4000)).toBe(5000)
    expect(store.backoffUntil(6000)).toBe(0)
  })
})

describe('token store', () => {
  const tokens = { accessToken: 'a', refreshToken: 'b', expiresAt: 9 }

  test('returns tokens issued for the configured refresh token', () => {
    const storage = memory()
    createTokenStore(storage, 'c', 'seed').save(tokens)
    expect(createTokenStore(storage, 'c', 'seed').load()).toEqual(tokens)
  })

  test('ignores them once the settings carry a new refresh token', () => {
    const storage = memory()
    createTokenStore(storage, 'c', 'seed').save(tokens)
    expect(createTokenStore(storage, 'c', 'reconnected').load()).toBeNull()
  })
})
