import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { WeaponSpec } from '../content/weapons/weapons.ts'

// A weapon in the match: its rounds, cooldown and reload, the trigger, and
// where a round goes. Its numbers are content (content/weapons/weapons.ts).
export interface WeaponState {
  spec: WeaponSpec
  ammo: number
  cooldown: number // seconds until the next round can fire
  reload: number // seconds of reload left, 0 when ready
  lock: { target: number; time: number } // a missile's: the machine held in its window (-1 none) and for how long, seconds
}

export const armWeapon = (spec: WeaponSpec): WeaponState => ({ spec, ammo: spec.magazine, cooldown: 0, reload: 0, lock: { target: -1, time: 0 } })

// A missile's lock is on once its target has been held long enough.
export const locked = (weapon: Pick<WeaponState, 'spec' | 'lock'>) =>
  weapon.spec.kind === 'missile' && weapon.lock.target >= 0 && weapon.lock.time >= weapon.spec.missile.lock

// Advances the weapon by one step; true when a round leaves the barrel. A
// beam's ammo is its heat left to spend: a pulse a round; overheated (out),
// it cools whole as a gun reloads; with the trigger off it cools a pulse at
// a time, `reloadTime` from hot to cold.
export function pullTrigger(weapon: WeaponState, held: boolean, dt: number) {
  weapon.cooldown = Math.max(0, weapon.cooldown - dt)
  if (weapon.reload > 0) {
    weapon.reload = Math.max(0, weapon.reload - dt)
    if (weapon.reload === 0) weapon.ammo = weapon.spec.magazine
    return false
  }
  const { spec } = weapon
  if (!held && spec.kind === 'beam' && weapon.ammo < spec.magazine && weapon.cooldown <= 1e-6) {
    weapon.ammo++
    weapon.cooldown += spec.reloadTime / spec.magazine
  }
  if (!held || weapon.cooldown > 1e-6) return false
  weapon.cooldown += 1 / weapon.spec.fireRate
  if (--weapon.ammo === 0) weapon.reload = weapon.spec.reloadTime
  return true
}

export interface Shot {
  point: THREE.Vector3 // impact, or the end of the range
  normal: THREE.Vector3
  collider: RAPIER.Collider | null // what was hit
}

const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
const direction = new THREE.Vector3()

// Unit vector from `origin` toward `aim`, scattered inside the spread cone
// (`random`: the match's seeded stream, 0..1).
export function scatterAim(spec: WeaponSpec, origin: THREE.Vector3, aim: THREE.Vector3, out: THREE.Vector3, random: () => number) {
  out.subVectors(aim, origin).normalize()
  out.x += (random() * 2 - 1) * spec.spread
  out.y += (random() * 2 - 1) * spec.spread
  out.z += (random() * 2 - 1) * spec.spread
  return out.normalize()
}

// One hitscan round from `origin` toward `aim`.
export function castRound(
  world: RAPIER.World,
  spec: WeaponSpec,
  origin: THREE.Vector3,
  aim: THREE.Vector3,
  shooter: RAPIER.RigidBody,
  shot: Shot,
  random: () => number,
) {
  scatterAim(spec, origin, aim, direction, random)
  ray.origin = origin
  ray.dir = direction
  const hit = world.castRayAndGetNormal(ray, spec.range, true, undefined, undefined, undefined, shooter)
  shot.point.copy(origin).addScaledVector(direction, hit ? hit.timeOfImpact : spec.range)
  if (hit) shot.normal.set(hit.normal.x, hit.normal.y, hit.normal.z)
  shot.collider = hit ? hit.collider : null
  return shot
}
