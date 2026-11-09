/**
 * How the app behaves against Strava, end to end in a browser: what it shows
 * when things go wrong, and that a reload inside the refresh interval costs
 * no Strava requests at all.
 */

import { expect, test, type Page } from '@playwright/test'
import {
  createMockScreenlyForScreenshots,
  setupScreenlyJsMock,
} from '@screenly/edge-apps/test/screenshots'

import {
  mockSettings,
  setupStravaMock,
  type StravaMockOptions,
} from './strava-mock.js'

async function open(
  page: Page,
  settings: Record<string, string> = {},
  options: StravaMockOptions = {},
) {
  const { screenlyJsContent } = createMockScreenlyForScreenshots(
    { location: 'London' },
    mockSettings(settings),
  )
  await setupScreenlyJsMock(page, screenlyJsContent)
  await setupStravaMock(page, options)

  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('https://www.strava.com/')) {
      requests.push(request.url())
    }
  })
  await page.goto('/')
  return requests
}

const app = (page: Page) => page.locator('#app')

test('ranks the club and reuses the cached board on reload', async ({
  page,
}) => {
  const requests = await open(page)
  await expect(app(page)).toHaveAttribute('data-state', 'board')
  await expect(page.locator('.place-1 .podium-name')).toHaveText('Maya O.')
  await expect(page.locator('[data-total="activities"]')).toHaveText('32')

  // Token, club details, one page of activities.
  expect(requests.filter((u) => u.includes('/oauth/token'))).toHaveLength(1)
  expect(requests.filter((u) => u.includes('/activities'))).toHaveLength(1)
  const before = requests.length

  await page.reload()
  await expect(app(page)).toHaveAttribute('data-state', 'board')
  await expect(page.locator('.place-1 .podium-name')).toHaveText('Maya O.')
  expect(requests.length).toBe(before)
})

test('explains a refused token', async ({ page }) => {
  await open(page, {}, { activitiesStatus: 401 })
  await expect(app(page)).toHaveAttribute('data-state', 'message')
  await expect(page.locator('[data-message-title]')).toHaveText(
    'Strava refused access',
  )
})

test('explains a club that does not exist', async ({ page }) => {
  await open(page, {}, { activitiesStatus: 404 })
  await expect(page.locator('[data-message-title]')).toHaveText(
    'Club not found',
  )
})

test('says when nobody has done the chosen sport', async ({ page }) => {
  await open(page, { activity_type: 'swim' }, { activities: [] })
  await expect(page.locator('[data-message-title]')).toHaveText(
    'No activities yet',
  )
})

test('asks for missing settings without calling Strava', async ({ page }) => {
  const requests = await open(page, { club_id: '' })
  await expect(page.locator('[data-message-title]')).toHaveText(
    'Finish setting up the app',
  )
  expect(requests).toHaveLength(0)
})
