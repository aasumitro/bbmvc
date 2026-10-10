// Weapons are data; the simulation reads these numbers, the garage and HUD
// show them. A weapon's `kind` is how it fires: a gun is hitscan; a rocket
// is a projectile the match flies and detonates. Whatever behaves by kind
// handles every kind (a switch or a Record<WeaponKind, …>), so a new kind
// is a compile error at each place until it's handled there.
export type WeaponId = 'minigun' | 'rocketPod'
export type TurretKey = 'minigun' | 'rocketPod' // a model in TURRETS (turrets.ts)
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
}
export interface RocketSpec extends Armament {
  kind: 'rocket'
  rocket: { speed: number; blast: number } // m/s, blast radius in metres
}
export type WeaponSpec = GunSpec | RocketSpec
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
    damage: 38,
    fireRate: 2,
    magazine: 6,
    reloadTime: 3.5,
    range: 220,
    spread: 0.004,
    rocket: { speed: 95, blast: 5 },
  },
} satisfies { [K in WeaponId]: WeaponSpec & { id: K } }

// Average damage per second over whole magazines, reloads included.
export const sustainedDps = (spec: WeaponSpec) => (spec.damage * spec.magazine) / (spec.magazine / spec.fireRate + spec.reloadTime)
