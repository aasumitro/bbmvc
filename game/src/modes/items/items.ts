import RAPIER from '@dimforge/rapier3d-compat'
import type { Arena, SpawnPoint } from '../../content/arenas/arena.ts'
import { distance, type Point } from '../../shared/math.ts'
import type { MatchSettings } from '../matchSettings.ts'
import { SUPPLY } from './config.ts'

// Pickups, whichever mode plugs them in: the catalogue, rarity rolls, where
// a drop lands, and what a bot knows and wants. Stateless helpers — the
// supply (supply.ts) owns the live items and calls these; a mode shapes a
// drop through its hooks (free for all: its hot zone and comeback pull).

export type ItemType = 'health' | 'repair' | 'ammo' | 'speed' | 'armor' | 'damage'
export type Rarity = 'common' | 'rare' | 'epic'
export type RarityTable = Record<Rarity, number> // relative weights

// `timed`: its effect runs for a while (supply.ts Effects; a chip on the HUD) rather than at once.
export const ITEMS = {
  health: { label: 'Health', rarity: 'common', color: '#4dff7c', timed: false },
  repair: { label: 'Repair', rarity: 'common', color: '#3fd7ff', timed: true },
  ammo: { label: 'Ammo', rarity: 'common', color: '#ffae3d', timed: false },
  speed: { label: 'Speed boost', rarity: 'rare', color: '#ffe23d', timed: true },
  armor: { label: 'Armor', rarity: 'rare', color: '#5b8cff', timed: true },
  damage: { label: 'Damage boost', rarity: 'epic', color: '#ff2f5f', timed: true },
} as const satisfies Record<ItemType, { label: string; rarity: Rarity; color: string; timed: boolean }>
// The timed items, as the type the supply keeps an expiry for each of.
export type Effect = { [K in ItemType]: (typeof ITEMS)[K]['timed'] extends true ? K : never }[ItemType]
export const RARITY_COLORS: Record<Rarity, string> = { common: '#f2ece0', rare: '#4f8cff', epic: '#b84bff' }

const RARITIES: Rarity[] = ['common', 'rare', 'epic']
const TYPES = Object.keys(ITEMS) as ItemType[]
export const EFFECTS = TYPES.filter((type): type is Effect => ITEMS[type].timed) // in the catalogue's order
const OF_RARITY = Object.fromEntries(RARITIES.map((rarity) => [rarity, TYPES.filter((type) => ITEMS[type].rarity === rarity)])) as Record<Rarity, ItemType[]>

// The pickups a match's settings turn on, by group: health (health and
// repair), ammo, power-ups (speed, armor, damage).
const GROUPS: Record<keyof MatchSettings['items'], ItemType[]> = { health: ['health', 'repair'], ammo: ['ammo'], powerups: ['speed', 'armor', 'damage'] }
export const itemTypes = (groups: MatchSettings['items']) =>
  TYPES.filter((type) => (Object.keys(GROUPS) as Array<keyof typeof GROUPS>).some((group) => groups[group] && GROUPS[group].includes(type)))

export interface Item extends Point {
  id: number
  type: ItemType
  rarity: Rarity
  spot: number // index into the spot list: one item per spot
  born: number // match clock
  expires: number
  state: 'spawned' | 'consumed' | 'expired'
  hot: boolean // landed inside the mode's hot area (free for all's hot zone)
}

// What an item needs to know about a machine.
export interface Holder {
  alive: boolean
  health: number
  maxHealth: number
  position: Point
  weapon: { ammo: number; reload: number; spec: { magazine: number } }
}

// Index picked with probability proportional to its weight; -1 when every weight is 0.
export function weighted(random: () => number, weights: readonly number[]) {
  let total = 0
  for (const weight of weights) total += weight
  if (total <= 0) return -1
  let roll = random() * total
  let last = -1
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] <= 0) continue
    roll -= weights[i]
    last = i
    if (roll < 0) return i
  }
  return last // rounding at the very top of the range
}

// Rarity by the table's weights, then any type of that rarity — of the
// `allowed` types only: a rarity with none of them never comes up.
export function rollType(random: () => number, table: RarityTable, allowed: readonly ItemType[] = TYPES): ItemType {
  const of = (rarity: Rarity) => OF_RARITY[rarity].filter((type) => allowed.includes(type))
  const types = of(
    RARITIES[
      weighted(
        random,
        RARITIES.map((rarity) => (of(rarity).length ? table[rarity] : 0)),
      )
    ],
  )
  return types[Math.floor(random() * types.length)]
}

// A machine takes an item only if it does something for it: health and
// repair need a damaged hull, ammo a magazine that isn't full; boosts always.
export function wants(type: ItemType, holder: Holder) {
  if (type === 'health' || type === 'repair') return holder.health < holder.maxHealth
  if (type === 'ammo') return holder.weapon.ammo < holder.weapon.spec.magazine
  return true
}

// Where items can appear: the bots' road nodes (drivable and reachable),
// kept when nothing solid is close and none of `starts` is near.
export function itemSpots(arena: Arena, world: RAPIER.World, starts: readonly SpawnPoint[]) {
  const room = new RAPIER.Ball(SUPPLY.clearance)
  const centre = { x: 0, y: SUPPLY.clearance + 0.2, z: 0 } // clears the kerbs, reaches into anything taller
  const level = { x: 0, y: 0, z: 0, w: 1 }
  return arena.nav.nodes.filter((node) => {
    centre.x = node.x
    centre.z = node.z
    return (
      starts.every((start) => start.position.distanceTo(node) >= SUPPLY.clearOfStarts) &&
      !world.intersectionWithShape(centre, level, room, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
    )
  })
}

export interface WaveInput {
  spots: readonly Point[]
  taken: (spot: number) => boolean // holds a live item already
  cars: readonly Point[] // live machines
  count: number // items anywhere
  extras?: number // items placed first, only where `extra` says
  extra?: (at: Point) => boolean
  weight?: (at: Point) => number // a free spot's weight; 1 unless said
}

// Spots for one drop, the extras first. Weighted random over free spots
// (the mode's weights: free for all pulls items into its hot zone and
// toward trailing machines). Never within clearOfCars of a live machine;
// spacing between the drop's own items is dropped only when nothing else is
// left. Fewer spots than asked when the map runs out.
export function placeWave(random: () => number, { spots, taken, cars, count, extras = 0, extra, weight }: WaveInput) {
  const picked: number[] = []
  const weights = new Array<number>(spots.length)
  const place = (only: boolean) => {
    for (const spaced of [true, false]) {
      for (let i = 0; i < spots.length; i++) {
        const spot = spots[i]
        const free =
          !taken(i) &&
          !picked.includes(i) &&
          (!only || !!extra?.(spot)) &&
          cars.every((car) => distance(car, spot) >= SUPPLY.clearOfCars) &&
          (!spaced || picked.every((other) => distance(spots[other], spot) >= SUPPLY.spacing))
        weights[i] = free ? (weight ? weight(spot) : 1) : 0
      }
      const choice = weighted(random, weights)
      if (choice >= 0) return picked.push(choice)
    }
  }
  for (let k = 0; k < extras; k++) place(true)
  for (let k = 0; k < count; k++) place(false)
  return picked
}

// Somewhere a bot would drive when it isn't busy fighting (`urgent`: go even mid-fight).
export interface Errand extends Point {
  urgent: boolean
}

// The item a bot would drive for, from what it knows: items within `reach`
// only (the sense range: the radius the player's minimap shows). Low on
// hull, health it knows about comes first, even mid-fight; otherwise the
// nearest item it wants. Writes `out`; null for none.
export function chooseErrand(bot: Holder, items: readonly Item[], reach: number, out: Errand): Errand | null {
  const low = bot.health < bot.maxHealth * SUPPLY.lowHealth
  let best: Item | null = null
  let bestDistance = reach
  let urgent = false
  for (const item of items) {
    if (!wants(item.type, bot)) continue
    const healing = item.type === 'health' || item.type === 'repair'
    const d = distance(bot.position, item)
    if (d > reach || (urgent && !healing)) continue
    if ((low && healing && !urgent) || d < bestDistance) {
      best = item
      bestDistance = d
      urgent = low && healing
    }
  }
  if (!best) return null
  out.x = best.x
  out.z = best.z
  out.urgent = urgent
  return out
}
