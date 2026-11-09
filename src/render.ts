/**
 * Draws the board. Everything here writes to the DOM; what to write is
 * decided in `leaderboard.ts` and `format.ts`.
 */

import poweredByStrava from './assets/powered-by-strava.svg?raw'
import {
  formatCount,
  formatDistance,
  formatDuration,
  formatElevation,
  formatRate,
  joined,
  type Measure,
  type UnitSystem,
} from './format.js'
import type { AthleteStats, Leaderboard, Sport } from './leaderboard.js'
import { initialsOf } from './leaderboard.js'
import type { ClubSnapshot } from './store.js'

export interface View {
  locale: string
  units: UnitSystem
  sport: Sport
}

const SPORT_LABEL: Record<Sport, string> = {
  all: 'All sports',
  run: 'Running',
  ride: 'Cycling',
  swim: 'Swimming',
  walk: 'Walking & hiking',
}

function $(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  return element
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

/** A stable hue per name, so an athlete keeps their colour between loads. */
export function hueOf(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) | 0
  return Math.abs(hash) % 360
}

function avatar(athlete: AthleteStats, className: string): HTMLElement {
  const node = el('span', `avatar ${className}`, athlete.initials)
  node.style.setProperty('--hue', String(hueOf(athlete.name)))
  node.setAttribute('aria-hidden', 'true')
  return node
}

function measureNode(m: Measure, className: string): HTMLElement {
  const node = el('span', className)
  node.append(el('span', 'num', m.value))
  if (m.unit) node.append(el('span', 'unit', m.unit))
  return node
}

function stat(label: string, value: string): HTMLElement {
  const wrap = el('div', 'stat')
  wrap.append(el('dt', '', label), el('dd', '', value))
  return wrap
}

function activitiesLabel(count: number, locale: string): string {
  return `${formatCount(count, locale)} ${count === 1 ? 'activity' : 'activities'}`
}

export function renderStatic(view: View): void {
  const powered = $('[data-powered]')
  if (!powered.firstElementChild) powered.innerHTML = poweredByStrava
  $('[data-eyebrow]').textContent =
    `Club leaderboard · ${SPORT_LABEL[view.sport]}`
}

export function renderClub(
  snapshot: ClubSnapshot | null,
  fallbackName: string,
) {
  const name = snapshot?.club.name || fallbackName
  $('[data-club-name]').textContent = name
  $('[data-club-initials]').textContent = initialsOf(name)

  const logo = $('[data-club-logo]') as HTMLImageElement
  const src = snapshot?.club.profile || snapshot?.club.profile_medium
  // Strava's placeholder for clubs without a picture is a relative path.
  if (!src || !/^https?:\/\//.test(src)) {
    logo.hidden = true
    return
  }
  if (logo.getAttribute('src') === src) return
  logo.onload = () => {
    logo.hidden = false
  }
  logo.onerror = () => {
    logo.hidden = true
  }
  logo.src = src
}

export function renderTotals(board: Leaderboard, view: View): void {
  const { totals } = board
  const set = (key: string, node: Node | string) => {
    const target = $(`[data-total="${key}"]`)
    target.replaceChildren(node)
  }
  set('athletes', formatCount(totals.athletes, view.locale))
  set('activities', formatCount(totals.activities, view.locale))
  set(
    'distance',
    measureNode(formatDistance(totals.distance, view.units, view.locale), 'm'),
  )
  set('time', formatDuration(totals.movingTime))
}

function podiumCard(
  athlete: AthleteStats,
  rank: number,
  view: View,
): HTMLElement {
  const card = el('article', `podium-card place-${rank}`)

  const top = el('div', 'podium-top')
  top.append(
    el('span', `medal medal-${rank}`, String(rank)),
    avatar(athlete, 'avatar-lg'),
    el('div', 'podium-name', athlete.name),
  )

  const distance = measureNode(
    formatDistance(athlete.distance, view.units, view.locale),
    'podium-distance',
  )

  const rate = formatRate(
    athlete.distance,
    athlete.movingTime,
    athlete.activities,
    view.sport,
    view.units,
    view.locale,
  )
  const stats = el('dl', 'podium-stats')
  stats.append(
    stat('Activities', formatCount(athlete.activities, view.locale)),
    stat('Time', formatDuration(athlete.movingTime)),
    stat(
      'Elev',
      joined(formatElevation(athlete.elevation, view.units, view.locale)),
    ),
    stat(rate.label, joined(rate)),
  )

  card.append(top, distance, stats)
  return card
}

function rankRow(
  athlete: AthleteStats,
  rank: number,
  leader: number,
  view: View,
): HTMLElement {
  const row = el('li', 'rank-row')
  const body = el('div', 'rank-body')

  const line = el('div', 'rank-line')
  line.append(
    el('span', 'rank-name', athlete.name),
    measureNode(
      formatDistance(athlete.distance, view.units, view.locale),
      'rank-distance',
    ),
  )

  const rate = formatRate(
    athlete.distance,
    athlete.movingTime,
    athlete.activities,
    view.sport,
    view.units,
    view.locale,
  )
  const meta = el(
    'div',
    'rank-meta',
    [
      activitiesLabel(athlete.activities, view.locale),
      formatDuration(athlete.movingTime),
      `${joined(formatElevation(athlete.elevation, view.units, view.locale))} elev`,
      `${joined(rate)}${rate.label === 'Avg' ? ' avg' : ''}`,
    ].join('  ·  '),
  )

  const bar = el('div', 'bar')
  const fill = el('span')
  const share = leader > 0 ? athlete.distance / leader : 0
  fill.style.setProperty('--share', share.toFixed(4))
  bar.append(fill)

  body.append(line, meta, bar)
  row.append(
    el('span', 'rank-num', String(rank)),
    avatar(athlete, 'avatar-sm'),
    body,
  )
  return row
}

function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth
}

/** A length from the stylesheet, in pixels. */
function lengthOf(value: string, fallback: number): number {
  const amount = Number.parseFloat(value)
  if (!Number.isFinite(amount)) return fallback
  if (value.trim().endsWith('rem')) {
    const root = Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    )
    return amount * (root || 16)
  }
  return amount
}

/**
 * How many rows fit under the podium. Sizes are read in reference pixels:
 * <auto-scaler> scales with a transform, which layout measurements ignore.
 */
function rowsThatFit(list: HTMLElement): {
  perColumn: number
  columns: number
} {
  const style = getComputedStyle(list)
  const rowHeight = lengthOf(style.getPropertyValue('--row-h'), 88)
  const ROW_GAP = lengthOf(style.rowGap, 14)
  const columns = isPortrait() ? 1 : 2
  const perColumn = Math.max(
    0,
    Math.floor((list.clientHeight + ROW_GAP) / (rowHeight + ROW_GAP)),
  )
  return { perColumn, columns }
}

export function renderBoard(board: Leaderboard, view: View): void {
  const podium = $('[data-podium]')
  const list = $('[data-ranks]')
  const { athletes } = board

  // Second, first, third: the winner stands in the middle.
  const places = [1, 0, 2].filter((i) => i < athletes.length)
  podium.replaceChildren(
    ...places.map((i) => podiumCard(athletes[i], i + 1, view)),
  )
  podium.dataset.count = String(places.length)

  // Measured with the list empty, so its height is the room it is given.
  list.replaceChildren()
  list.style.removeProperty('grid-template-rows')
  const { perColumn, columns } = rowsThatFit(list)
  const rest = athletes.slice(3, 3 + perColumn * columns)
  const rows = Math.min(perColumn, Math.ceil(rest.length / columns))
  list.style.gridTemplateRows = `repeat(${Math.max(rows, 1)}, var(--row-h))`
  list.dataset.columns = String(columns)

  const leader = athletes[0]?.distance ?? 0
  list.replaceChildren(
    ...rest.map((athlete, i) => rankRow(athlete, i + 4, leader, view)),
  )
}

export type AppState = 'loading' | 'board' | 'message'

export function setState(state: AppState): void {
  $('#app').dataset.state = state
}

export function renderMessage(title: string, hint: string): void {
  $('[data-message-title]').textContent = title
  $('[data-message-hint]').textContent = hint
  setState('message')
}

export type StatusTone = 'live' | 'stale' | 'error'

export function renderStatus(text: string, tone: StatusTone): void {
  $('[data-status]').textContent = text
  ;($('[data-status]').parentElement as HTMLElement).dataset.statusTone = tone
}

export function renderScope(text: string): void {
  $('[data-scope]').textContent = text
}
