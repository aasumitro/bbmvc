import { FFA_TRAITS } from './ffa/config.ts'
import type { Mode } from './ids.ts'
import { TDM_TRAITS } from './tdm/config.ts'

// What code outside a mode's folder may know about a mode, in one table:
// the server, the lobby's rules and screens, the match settings read these
// instead of comparing mode ids. Each mode's config declares its own row
// (and never imports this file, which would close a cycle).
interface ModeTraits {
  name: string // in a sentence: "Team deathmatch takes…"
  teams: boolean // two sides, the first half of the seats blue
  sizes: readonly number[] // the machines a custom lobby may choose
  friendlyFire: boolean // whether the option means anything in this mode
  classic: { size: number; duration: number; pickups: boolean } // Classic's and practice's match (matchSettings.ts classic)
}

export const MODE_TRAITS = { tdm: TDM_TRAITS, ffa: FFA_TRAITS } satisfies Record<Mode, ModeTraits>

// The biggest match any mode takes: seats on the wire, bot names, the HUD's pools.
export const MAX_SEATS = Math.max(...Object.values(MODE_TRAITS).flatMap((traits) => traits.sizes))

// A seat's side: its team in a team mode (the first half blue), else its own.
export const sideOf = (mode: Mode, size: number, seat: number) => (MODE_TRAITS[mode].teams ? (seat < size / 2 ? 0 : 1) : seat)
