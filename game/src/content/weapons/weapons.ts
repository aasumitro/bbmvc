// Weapons are data; the simulation reads these numbers, the garage and HUD
// show them. A weapon's `kind` is how it fires: a gun is hitscan; a rocket
// is a projectile the match flies and detonates; a beam is hitscan pulses
// while the trigger is held, with heat in place of a magazine; a missile is
// a rocket that, locked on a target first, turns after it; a mine is laid
// behind the machine and goes off when a hostile comes near. Whatever
// behaves by kind handles every kind (a switch or a Record<WeaponKind, …>),
// so a new kind is a compile error at each place until it's handled there.
export type WeaponId = 'minigun' | 'rocketPod' | 'cannon' | 'shotgun' | 'laser' | 'missiles' | 'mines'
export type TurretKey = 'minigun' | 'rocketPod' | 'cannon' | 'shotgun' | 'laser' | 'missiles' | 'mines' // a model in TURRETS (turrets.ts)
interface Armament {
  id: WeaponId // its key in WEAPONS: who carries it, on the wire and in records
  name: string
  turret: TurretKey // the turret built for it
  icon: string // the HUD's weapon panel: SVG path data in a 64 × 28 box
  blurb: string
  damage: number // per round; rockets: a direct hit, falling off to 0 at the blast edge
  fireRate: number // rounds per second
  magazine: number
  reloadTime: number // seconds
  range: number // metres
  spread: number // radians, cone half-angle
}
interface GunSpec extends Armament {
  kind: 'gun'
  pellets?: number // rays a shot casts, each its own spread and `damage`; absent, one
}
export interface RocketSpec extends Armament {
  kind: 'rocket'
  rocket: { speed: number; blast: number } // m/s, blast radius in metres
}
// A beam pulses at `fireRate` while the trigger is held, each pulse a ray of
// `damage` (a hitscan round). Its heat: `magazine` pulses take it from cold
// to overheated, and `reloadTime` takes it back from hot to cold, cooling
// whenever the trigger is off; overheated, it can't fire until it's cold.
export interface BeamSpec extends Armament {
  kind: 'beam'
}
// A missile flies as a rocket does, at `missile.speed`, and bursts with
// `missile.blast`. Fired with a lock (a hostile held in the window for
// `missile.lock` seconds: sim/simulation.ts), it turns after that machine,
// `missile.turn` radians a second; without one it flies straight.
export interface MissileSpec extends Armament {
  kind: 'missile'
  missile: { speed: number; blast: number; turn: number; lock: number }
}
// A mine isn't fired but laid: it goes down behind the machine, arms after
// `mine.arm` seconds and goes off when a hostile machine's hull comes within
// `mine.trigger` metres, bursting with `mine.blast` (the machine that set it
// off takes the whole of `damage`, the rest less towards the edge). At most
// `mine.down` of a machine's lie at once (another laid clears its oldest),
// each for `mine.life` seconds. Its `range` is only how far off the
// crosshair marks a rival.
export interface MineSpec extends Armament {
  kind: 'mine'
  mine: { arm: number; trigger: number; blast: number; down: number; life: number }
}
export type WeaponSpec = GunSpec | RocketSpec | BeamSpec | MissileSpec | MineSpec
export type WeaponKind = WeaponSpec['kind']

// The roster the garage offers, by id: a loadout names its weapon by key,
// and each row its own (the compiler holds them equal).
export const WEAPONS = {
  minigun: {
    id: 'minigun',
    kind: 'gun',
    name: 'Minigun',
    turret: 'minigun',
    icon: 'M20 8h18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM40 9h20v2.2H40zM40 12.9h22v2.2H40zM40 16.8h20v2.2H40zM56 7.5h1a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM18 11H7l-3 7h6l2-3h6zM26 20h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z',
    blurb: 'Six spinning barrels. Chews through armour at close range and never gives the target a moment to breathe.',
    damage: 4,
    fireRate: 12,
    magazine: 60,
    reloadTime: 2.2,
    range: 160,
    spread: 0.012,
  },
  rocketPod: {
    id: 'rocketPod',
    kind: 'rocket',
    name: 'Rocket Pod',
    turret: 'rocketPod',
    icon: 'M10 4h30a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM42 6h11l6 3.5-6 3.5H42zM42 13.5h11l6 3.5-6 3.5H42zM22 21h4a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z',
    blurb: 'Six unguided rockets. Slow to reload and they need leading, but one blast shoves a car sideways and cooks anything near it.',
    damage: 34,
    fireRate: 2,
    magazine: 6,
    reloadTime: 3.5,
    range: 220,
    spread: 0.004,
    rocket: { speed: 95, blast: 5 },
  },
  cannon: {
    id: 'cannon',
    kind: 'gun',
    name: 'Cannon',
    turret: 'cannon',
    icon: 'M8 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM22 10h8v8h-8zM30 12.2h28v3.6H30zM54 10h2.4v8H54zM57.6 10H60v8h-2.4zM11 20h6v5h-6zM12 5h4v3h-4z',
    blurb: 'One heavy shell at a time, four to a clip. Slow to fire and slow to reload, but it hits where you point it, near or far.',
    damage: 40,
    fireRate: 1,
    magazine: 4,
    reloadTime: 2.5,
    range: 260,
    spread: 0.002,
  },
  shotgun: {
    id: 'shotgun',
    kind: 'gun',
    name: 'Shotgun',
    turret: 'shotgun',
    icon: 'M8 8h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM24 9.5h33v3.4H24zM24 14.5h26v2.6H24zM31 13.4h11v4.8H31zM57 8.4h3v5.6h-3zM11 19h6v6h-6zM3 10h3v5H3z',
    blurb: 'Eight pellets a shell, six shells a load. Up close every pellet lands and it tears a car apart; past forty metres most of them miss.',
    damage: 4,
    pellets: 8,
    fireRate: 1.2,
    magazine: 6,
    reloadTime: 2.5,
    range: 45,
    spread: 0.035,
  },
  laser: {
    id: 'laser',
    kind: 'beam',
    name: 'Laser',
    turret: 'laser',
    icon: 'M8 9h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM26 11.2h24v5.6H26zM50 10h5v8h-5zM55 12.6h6v2.8h-6zM30 8h2v12h-2zM35 8h2v12h-2zM40 8h2v12h-2zM12 19h6v6h-6z',
    blurb:
      'A beam, not bullets: held on a target it burns 40 a second, dead straight out to 120 m. Four seconds of fire and it overheats; let go and it cools.',
    damage: 4,
    fireRate: 10,
    magazine: 40,
    reloadTime: 2,
    range: 120,
    spread: 0.001,
  },
  missiles: {
    id: 'missiles',
    kind: 'missile',
    name: 'Homing Missiles',
    turret: 'missiles',
    icon: 'M8 6h30a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM40 7.5h12l7 3-7 3H40zM40 14.5h12l7 3-7 3H40zM20 22h6v4h-6z',
    blurb:
      'Four missiles a load. Hold a rival in your sights until the lock takes and every one you fire turns after it; fired without a lock, they fly straight.',
    damage: 30,
    fireRate: 2,
    magazine: 4,
    reloadTime: 4,
    range: 200,
    spread: 0.004,
    missile: { speed: 70, blast: 3, turn: 2.5, lock: 0.8 },
  },
  mines: {
    id: 'mines',
    kind: 'mine',
    name: 'Mines',
    turret: 'mines',
    icon: 'M10 17a22 6 0 1 0 44 0a22 6 0 1 0-44 0zM22 9h20v8H22zM30 4h4v5h-4zM6 16h5v3H6zM53 16h5v3h-5z',
    blurb:
      'Three mines a load, dropped behind you. Each arms after a second and blows under the first rival to come within five metres of it: whoever chases you drives into them.',
    damage: 80,
    fireRate: 1,
    magazine: 3,
    reloadTime: 6,
    range: 30,
    spread: 0,
    mine: { arm: 1, trigger: 5, blast: 7, down: 3, life: 30 },
  },
} satisfies { [K in WeaponId]: WeaponSpec & { id: K } }

// Rays a round casts: a gun's pellets, one for anything else.
export const pelletsOf = (spec: WeaponSpec) => (spec.kind === 'gun' && spec.pellets) || 1

// How far round where it bursts a round hurts: a rocket's, a missile's or a
// mine's blast; a gun's round or a beam's pulse hurts only what it hits.
export function blastOf(spec: WeaponSpec) {
  switch (spec.kind) {
    case 'gun':
    case 'beam':
      return 0
    case 'rocket':
      return spec.rocket.blast
    case 'missile':
      return spec.missile.blast
    case 'mine':
      return spec.mine.blast
  }
}

// Average damage per second over whole magazines, reloads included, every pellet landing.
export const sustainedDps = (spec: WeaponSpec) => (spec.damage * pelletsOf(spec) * spec.magazine) / (spec.magazine / spec.fireRate + spec.reloadTime)
