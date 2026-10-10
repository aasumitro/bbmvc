import { DIFFICULTIES, type Difficulty } from '../sim/difficulty.ts'
import { WEAPONS, type WeaponId } from '../content/weapons/weapons.ts'
import { MODE_IDS, type Mode } from './ids.ts'
import { MODE_TRAITS } from './traits.ts'

// How a match is played: what its line-up and its mode's rules read in place
// of the mode's config. Classic and practice play classic(mode), the mode's
// own numbers; a custom lobby's room plays its owner's
// (.claude/work/custom/PLAN.md §4).
export interface MatchSettings {
  size: number // machines in the line-up; team deathmatch: an even number, half a side
  duration: number // seconds on the match clock
  respawn: Respawn // how long a wreck waits to come back
  friendlyFire: boolean // team deathmatch: teammates' rounds and rockets hurt; a team kill costs the team a point
  items: { health: boolean; ammo: boolean; powerups: boolean } // pickups by group: health and repair; ammo; speed, armor and damage
  weapons: 'all' | WeaponId // one gun for everyone, bots too
  killLimit: number // the first machine (team deathmatch: team) to this many kills wins at once; 0: none
}

type Respawn = 'fast' | 'normal' | 'slow'
const RESPAWN: Record<Respawn, number> = { fast: 0.5, normal: 1, slow: 1.5 } // every wait scaled

export function classic(mode: Mode): MatchSettings {
  const { size, duration, pickups } = MODE_TRAITS[mode].classic
  return {
    size,
    duration,
    respawn: 'normal',
    friendlyFire: false,
    items: { health: pickups, ammo: pickups, powerups: pickups },
    weapons: 'all',
    killLimit: 0,
  }
}

// A mode's respawn waits (its config): each phase's wait until that share of
// the match clock has gone, overtime's own.
interface RespawnWaits {
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
  modes: MODE_IDS,
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

type SettingsCheck = { ok: true; settings: MatchSettings } | { ok: false; errors: Partial<Record<keyof MatchSettings, string>> }

const flag = (value: unknown): value is boolean => typeof value === 'boolean'

// "Team deathmatch takes 2 to 12 machines, an even number": the sizes a lobby may choose, said.
function sizeRule(mode: Mode) {
  const { name, sizes, teams } = MODE_TRAITS[mode]
  return `${name} takes ${sizes[0]} to ${sizes.at(-1)} machines${teams ? ', an even number' : ''}`
}

// A lobby form's settings for `mode`, checked field by field against CUSTOM and the mode's traits:
// the drawer shows the errors beside their fields, and the server runs the
// same check and trusts nothing else. A fresh object: nothing unnamed gets
// through.
export function checkSettings(mode: Mode, input: unknown): SettingsCheck {
  const s = (typeof input === 'object' && input !== null ? input : {}) as Record<keyof MatchSettings, unknown>
  const errors: Partial<Record<keyof MatchSettings, string>> = {}
  const items = (typeof s.items === 'object' && s.items !== null ? s.items : {}) as Record<string, unknown>
  if (!MODE_TRAITS[mode].sizes.includes(s.size as number)) errors.size = sizeRule(mode)
  if (!CUSTOM.durations.includes(s.duration as number)) errors.duration = 'Pick a match length'
  if (!CUSTOM.respawns.includes(s.respawn as Respawn)) errors.respawn = 'Pick a respawn speed'
  if (!flag(s.friendlyFire) || (!MODE_TRAITS[mode].friendlyFire && s.friendlyFire)) errors.friendlyFire = 'Friendly fire is for team deathmatch'
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
