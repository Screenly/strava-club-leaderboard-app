import { test } from '@playwright/test'
import {
  captureScreenshot,
  createMockScreenlyForScreenshots,
  RESOLUTIONS,
} from '@screenly/edge-apps/test/screenshots'

import { THEMES } from '../src/theme.js'
import { mockSettings, setupStravaMock } from './strava-mock.js'

function screenlyJs(settings: Record<string, string>): string {
  return createMockScreenlyForScreenshots(
    { location: 'London' },
    mockSettings(settings),
  ).screenlyJsContent
}

for (const { width, height } of RESOLUTIONS) {
  test(`screenshot ${width}x${height}`, async ({ browser }) => {
    await captureScreenshot(browser, {
      width,
      height,
      filenamePrefix: 'strava-club-leaderboard-app',
      screenlyJsContent: screenlyJs({}),
      setupMocks: (page) => setupStravaMock(page),
    })
  })
}

for (const theme of THEMES) {
  for (const { width, height } of [
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
  ]) {
    test(`screenshot ${theme} ${width}x${height}`, async ({ browser }) => {
      await captureScreenshot(browser, {
        width,
        height,
        filenamePrefix: `strava-club-leaderboard-app-${theme}`,
        screenlyJsContent: screenlyJs({ theme, activity_type: 'all' }),
        setupMocks: (page) => setupStravaMock(page),
      })
    })
  }
}
