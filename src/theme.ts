/**
 * Dark suits a gym, a clubhouse or a screen left on all evening; light suits
 * a bright office or lobby.
 */

export const THEMES = ['dark', 'light'] as const

export type Theme = (typeof THEMES)[number]

export function resolveTheme(setting: string): Theme {
  const chosen = setting.trim().toLowerCase()
  return (THEMES as readonly string[]).includes(chosen)
    ? (chosen as Theme)
    : 'dark'
}
