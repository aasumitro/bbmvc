import type { Match } from '../runtime/match.ts'
import type { Combatant } from '../sim/simulation.ts'

// What the HUD (Hud.tsx) and the modes' panels (modes/<mode>/HudPanel.tsx)
// share: the DOM writes, skipped when the value is unchanged (inline styles
// and text read back without forcing layout), a few class names, and what
// the HUD asks of the running mode's panel.

type Styled = HTMLElement | SVGElement

export function setText(el: Element, value: string) {
  if (el.textContent !== value) el.textContent = value
}
export function setStyle(el: Styled, property: 'opacity' | 'transform' | 'width' | 'display', value: string) {
  if (el.style[property] !== value) el.style[property] = value
}
export const fade = (el: Styled, value: number) => setStyle(el, 'opacity', value < 0.01 ? '0' : String(Math.round(value * 100) / 100))

export const caption = 'text-[0.62rem] font-bold tracking-[0.3em] uppercase'
export const label = `${caption} text-white/60`
// Under the score: the rule, and the line about the lead (free for all) or momentum (team deathmatch).
export const SCORE_RULE = 'mt-2 h-px w-14 bg-red-500/80'
export const SCORE_DETAIL =
  'mt-2 text-[0.7rem] font-extrabold tracking-[0.2em] text-red-400 uppercase data-[tone=ally]:text-sky-300 data-[tone=level]:text-white/70'

// The running mode's panel: its own block at the top left (the score),
// written every frame, and what the shared HUD shows of the mode. Each
// method reads the match and allocates nothing.
export interface HudPanelHandle {
  update(match: Match): void
  leader(match: Match): number // crowned over its marker, ringed on the map: the sole leader; -1 none
  zone(match: Match): { x: number; z: number; radius: number } | null // a ring on the map (free for all's hot zone)
  objective(match: Match): string // a line over the feed; '' none
  overtimeClock(match: Match): number // seconds the clock shows in overtime
  // The scoreboard (held Tab, or while the player is down):
  readonly words: { down: string; by: string; back: string } // its title while down; before the killer; before the wait
  rank(match: Match, out: Combatant[]): void // every machine in order
  readonly grouped: boolean // a header over each team's rows
  groupName(team: number): string
  groupNote(match: Match, team: number): string
  scoreLine(match: Match): string // after the arena's name: the teams' score
  teamKills(match: Match): boolean // the TK column
  nemesis(match: Match): number // marked on the scoreboard; -1 none
}
