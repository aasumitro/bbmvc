import type { Feed } from '../../sim/matchMode.ts'
import { ms } from '../../shared/time.ts'
import type { Stats } from '../../sim/scoring.ts'
import { distance, type Point } from '../../shared/math.ts'
import { SUPPLY } from './config.ts'
import {
  chooseErrand,
  EFFECTS,
  ITEMS,
  placeWave,
  rollType,
  wants,
  type Effect,
  type Errand,
  type Holder,
  type Item,
  type ItemType,
  type RarityTable,
} from './items.ts'

// The pickups of one match, for whichever mode plugs them in: the items on
// the ground, the waves on the match clock, their expiry, who picks what up,
// and what each machine has running (repair, speed, armor, damage boost).
// Pure, like the rules that own it: they tick it, ask it how hard a hit
// lands and how fast a machine goes, and shape each drop through hooks —
// free for all's hot zone and comeback pull. It draws from the match's own
// stream, in turn with the mode's other rolls, and reports into the mode's
// event queue.

type Effects = Record<Effect, number> // expiry on the match clock; off once it's past

export type SupplyEvent = { type: 'item'; who: number; item: Item } | { type: 'expired'; item: Item } | { type: 'wave'; count: number }

// What the supply needs of a machine: what an item does to it, and its statistics.
export interface Collector extends Holder {
  stats: Stats
}

// One drop of items, as the mode shapes it.
interface Drop {
  count: number // items anywhere on the map
  zone?: { extras: number; inside(at: Point): boolean; rarity: RarityTable } // a hot area (free for all's hot zone): extra items inside it first, rolled on its own table, marked hot
  weight?: (at: Point) => number // a free spot's weight, 1 unless said
}

export interface SupplyOptions {
  spots: readonly Point[] // where items can appear (validated by the match)
  types: readonly ItemType[] // the ones the match's settings allow (items.ts itemTypes)
  clock: () => number // the rules' match clock
  random: () => number // the match's stream, shared with the mode's own rolls
  report: (event: SupplyEvent) => void // into the mode's event queue
  points: number // combat score for each item picked up
  wave: () => Drop // the next wave, as the mode shapes it
}

export type Supply = ReturnType<typeof createSupply>

const noEffects = (): Effects => ({ repair: 0, speed: 0, armor: 0, damage: 0 })
// A machine's effects on the wire: each timed item's expiry in whole ms, in the catalogue's order.
function shared(effects: Effects) {
  const out = {} as Effects
  for (const effect of EFFECTS) out[effect] = ms(effects[effect])
  return out
}

export function createSupply(machines: readonly Collector[], { spots, types, clock, random, report, points, wave }: SupplyOptions) {
  const n = machines.length
  let nextWave = SUPPLY.firstWave // elapsed
  let nextItem = 1

  const supply = {
    types, // the ones that drop
    items: [] as Item[], // live ones only
    effects: machines.map(noEffects),
    tick,
    drop,
    damageFactor,
    shield,
    speedFactor,
    clear,
    end,
    errand,
    share,
    mirror,
    reset,
  }

  // One fixed step: repairs running, the next wave when it's due (`waves`:
  // the mode lets one come; `elapsed`: its match time since the start; none
  // with every type off), expiry, pickups. True if anything was picked up
  // (the statistics changed).
  function tick(dt: number, elapsed: number, waves: boolean) {
    const now = clock()
    for (let i = 0; i < n; i++) {
      const p = machines[i]
      if (supply.effects[i].repair > now && p.alive) p.health = Math.min(p.maxHealth, p.health + SUPPLY.repair.rate * dt)
    }
    if (waves && types.length && elapsed >= nextWave) {
      report({ type: 'wave', count: drop(wave()) })
      nextWave += SUPPLY.waveInterval
    }
    expire(now)
    return collect(now)
  }

  // Items where the drop says, as many as the map and the cap allow; how many landed.
  function drop({ count, zone, weight }: Drop) {
    if (!types.length) return 0
    let landed = 0
    for (const spot of placeWave(random, { spots, taken, cars: livePositions(), count, extras: zone?.extras, extra: zone?.inside, weight })) {
      if (add(spot, zone)) landed++
    }
    return landed
  }

  const taken = (spot: number) => supply.items.some((item) => item.spot === spot)
  const livePositions = () => machines.filter((p) => p.alive).map((p) => p.position)

  function add(spot: number, zone: Drop['zone']) {
    if (supply.items.length >= SUPPLY.maxActive) return false
    const now = clock()
    const at = spots[spot]
    const hot = !!zone && zone.inside(at)
    const type = rollType(random, hot ? zone.rarity : SUPPLY.rarity, types)
    const [shortest, longest] = SUPPLY.ttl
    supply.items.push({
      id: nextItem++,
      type,
      rarity: ITEMS[type].rarity,
      x: at.x,
      z: at.z,
      spot,
      born: now,
      expires: now + shortest + random() * (longest - shortest),
      state: 'spawned',
      hot,
    })
    return true
  }

  function expire(now: number) {
    for (let k = supply.items.length - 1; k >= 0; k--) {
      const item = supply.items[k]
      if (now < item.expires) continue
      item.state = 'expired'
      supply.items.splice(k, 1)
      report({ type: 'expired', item })
    }
  }

  // Every item goes to the first machine in grid order within reach that wants it.
  function collect(now: number) {
    let collected = false
    for (let k = supply.items.length - 1; k >= 0; k--) {
      const item = supply.items[k]
      for (let i = 0; i < n; i++) {
        const p = machines[i]
        if (!p.alive || distance(p.position, item) > SUPPLY.pickupRadius || !wants(item.type, p)) continue
        item.state = 'consumed'
        supply.items.splice(k, 1)
        apply(i, item.type, now)
        p.stats.itemsCollected++
        p.stats.combatScore += points
        collected = true
        report({ type: 'item', who: i, item })
        break
      }
    }
    return collected
  }

  // Instant items change the machine now; timed ones set (or restart) an
  // expiry — never stacking a strength, never touching a base value.
  function apply(i: number, type: ItemType, now: number) {
    const p = machines[i]
    const effects = supply.effects[i]
    if (type === 'health') p.health = Math.min(p.maxHealth, p.health + SUPPLY.health.amount)
    else if (type === 'ammo') {
      p.weapon.ammo = Math.min(p.weapon.spec.magazine, p.weapon.ammo + SUPPLY.ammo.magazines * p.weapon.spec.magazine)
      p.weapon.reload = 0
    } else effects[type] = Math.max(effects[type], now + SUPPLY[type].duration)
  }

  // A hit's multiplier from the attacker's damage boost; 1 without one.
  function damageFactor(attacker: number) {
    return supply.effects[attacker].damage > clock() ? SUPPLY.damage.factor : 1
  }
  // The share of a hit the victim's armor stops; 0 without it.
  function shield(victim: number) {
    return supply.effects[victim].armor > clock() ? SUPPLY.armor.reduction : 0
  }
  // Engine boost for machine i this step; 1 for none.
  function speedFactor(i: number) {
    return supply.effects[i].speed > clock() ? SUPPLY.speed.factor : 1
  }

  // A machine is wrecked: its effects are over.
  function clear(i: number) {
    Object.assign(supply.effects[i], noEffects())
  }

  // The match is over: every effect and item is gone.
  function end() {
    for (let i = 0; i < n; i++) clear(i)
    supply.items.length = 0
  }

  // The item the bot would drive for (items.ts chooseErrand), seeing
  // `reach` times the sense range; null for none. Writes `out`.
  function errand(bot: number, reach: number, out: Errand) {
    return chooseErrand(machines[bot], supply.items, SUPPLY.senseRange * reach, out)
  }

  // Online: the items and the effects as the HUD and the pickups show them;
  // a mirror's supply takes them in.
  function share() {
    return {
      items: supply.items.map((item) => ({ ...item, born: ms(item.born), expires: ms(item.expires) })),
      effects: supply.effects.map(shared),
    }
  }
  function mirror(state: ReturnType<typeof share>) {
    supply.items = state.items
    state.effects.forEach((effects, i) => Object.assign(supply.effects[i], effects))
  }

  // A fresh match: no items, no effects, the first wave to come.
  function reset() {
    end()
    nextWave = SUPPLY.firstWave
  }

  return supply
}

// A supply's events put in front of the local player: a pickup (theirs
// flashes on the HUD, anyone's is heard), a drop's news; expiry says nothing.
export function announce(event: SupplyEvent, feed: Feed) {
  if (event.type === 'item') feed.pickup(event.who, event.item.x, event.item.z, ITEMS[event.item.type].label, ITEMS[event.item.type].color)
  if (event.type === 'wave' && event.count) feed.news('Supply drop', `${event.count} pickups`)
}
