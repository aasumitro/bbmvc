import { DIFFICULTIES, type Difficulty } from './ai.ts'
import { WEAPONS, type WeaponId } from './combat.ts'
import { FFA } from './ffa/config.ts'
import type { Mode } from './modes.ts'
import { TDM } from './tdm/config.ts'

// How a match is played: what its line-up and its mode's rules read in place
// of the mode's config. Classic and practice play classic(mode), the mode's
// own numbers; a custom lobby's room plays its owner's
// (.claude/work/custom/PLAN.md §4). (Imports carry .ts: the self-checks run
// this under plain node.)
export interface MatchSettings {
  size: number // machines in the line-up; team deathmatch: an even number, half a side
  duration: number // seconds on the match clock
  respawn: Respawn // how long a wreck waits to come back
  friendlyFire: boolean // team deathmatch: teammates' rounds and rockets hurt; a team kill costs the team a point
  items: { health: boolean; ammo: boolean; powerups: boolean } // pickups by group: health and repair; ammo; speed, armor and damage
  weapons: 'all' | WeaponId // one gun for everyone, bots too
  killLimit: number // the first machine (team deathmatch: team) to this many kills wins at once; 0: none
}

export type Respawn = 'fast' | 'normal' | 'slow'
export const RESPAWN: Record<Respawn, number> = { fast: 0.5, normal: 1, slow: 1.5 } // every wait scaled

export const classic = (mode: Mode): MatchSettings => ({
  size: mode === 'ffa' ? FFA.grid : 2 * TDM.teamSize,
  duration: mode === 'ffa' ? FFA.duration : TDM.duration,
  respawn: 'normal',
  friendlyFire: false,
  items: { health: mode === 'ffa', ammo: mode === 'ffa', powerups: mode === 'ffa' }, // free for all has pickups, team deathmatch none
  weapons: 'all',
  killLimit: 0,
})

// A mode's respawn waits (its config): each phase's wait until that share of
// the match clock has gone, overtime's own.
export interface RespawnWaits {
  phases: ReadonlyArray<{ share: number; delay: number }>
  overtime: number
}

// How long a machine wrecked now waits to come back: by how far the match
// has gone (`elapsed` of the clock), or overtime's wait; scaled by the settings.
export const respawnWait = (waits: RespawnWaits, settings: MatchSettings, elapsed: number, overtime: boolean) =>
  (overtime ? waits.overtime : waits.phases.find((phase) => elapsed < phase.share * settings.duration)!.delay) * RESPAWN[settings.respawn]

// What a custom lobby's owner may choose from (.claude/work/custom/PLAN.md
// §2): the form offers exactly these, and the server takes nothing else.
export const CUSTOM = {
  modes: ['tdm', 'ffa'] as const satisfies readonly Mode[],
  sizes: { ffa: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tdm: [2, 4, 6, 8, 10, 12] } satisfies Record<Mode, number[]>, // team deathmatch: 1v1 to 6v6
  durations: [5, 10, 15, 20, 30].map((minutes) => minutes * 60),
  respawns: ['fast', 'normal', 'slow'] as const satisfies readonly Respawn[],
  killLimits: [0, 10, 25, 50],
  weapons: ['all', ...(Object.keys(WEAPONS) as WeaponId[])] as const,
  skills: Object.keys(DIFFICULTIES) as Difficulty[], // a bot's, one each
}

// What the screens call them (the lobby form, the waiting room).
export const RESPAWN_LABELS: Record<Respawn, string> = { fast: 'Fast', normal: 'Normal', slow: 'Slow' }
export const ITEM_GROUPS = [
  { id: 'health', label: 'Health' },
  { id: 'ammo', label: 'Ammo' },
  { id: 'powerups', label: 'Power-ups' },
] as const satisfies ReadonlyArray<{ id: keyof MatchSettings['items']; label: string }>
export const weaponsLabel = (weapons: MatchSettings['weapons']) => (weapons === 'all' ? 'All' : `${WEAPONS[weapons].name} only`)
export const killLimitLabel = (limit: number) => (limit ? String(limit) : 'None')
export const minutes = (seconds: number) => `${seconds / 60} min`

export type SettingsCheck = { ok: true; settings: MatchSettings } | { ok: false; errors: Partial<Record<keyof MatchSettings, string>> }

const flag = (value: unknown): value is boolean => typeof value === 'boolean'

// A lobby form's settings for `mode`, checked field by field against CUSTOM:
// the drawer shows the errors beside their fields, and the server runs the
// same check and trusts nothing else. A fresh object: nothing unnamed gets
// through.
export function checkSettings(mode: Mode, input: unknown): SettingsCheck {
  const s = (typeof input === 'object' && input !== null ? input : {}) as Record<keyof MatchSettings, unknown>
  const errors: Partial<Record<keyof MatchSettings, string>> = {}
  const items = (typeof s.items === 'object' && s.items !== null ? s.items : {}) as Record<string, unknown>
  if (!CUSTOM.sizes[mode].includes(s.size as number)) errors.size = mode === 'tdm' ? 'Team deathmatch takes 2 to 12 machines, an even number' : 'Free for all takes 2 to 12 machines'
  if (!CUSTOM.durations.includes(s.duration as number)) errors.duration = 'Pick a match length'
  if (!CUSTOM.respawns.includes(s.respawn as Respawn)) errors.respawn = 'Pick a respawn speed'
  if (!flag(s.friendlyFire) || (mode === 'ffa' && s.friendlyFire)) errors.friendlyFire = 'Friendly fire is for team deathmatch'
  if (!flag(items.health) || !flag(items.ammo) || !flag(items.powerups)) errors.items = 'Pick which pickups drop'
  if (!(CUSTOM.weapons as readonly unknown[]).includes(s.weapons)) errors.weapons = 'Pick the guns'
  if (!CUSTOM.killLimits.includes(s.killLimit as number)) errors.killLimit = 'Pick a kill limit'
  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    settings: {
      size: s.size as number,
      duration: s.duration as number,
      respawn: s.respawn as Respawn,
      friendlyFire: s.friendlyFire as boolean,
      items: { health: items.health as boolean, ammo: items.ammo as boolean, powerups: items.powerups as boolean },
      weapons: s.weapons as MatchSettings['weapons'],
      killLimit: s.killLimit as number,
    },
  }
}
