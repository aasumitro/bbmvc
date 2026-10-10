import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { scatterAim, type Shot } from '../src/sim/combat.ts'
import type { Combatant } from '../src/sim/simulation.ts'
import { VEHICLES } from '../src/content/vehicles/vehicles.ts'

// Lag compensation for hitscan: a player aims at the others as their page
// draws them — a little in the past (net/snapshots.ts) — so the server
// tests that player's round against the others where they stood at the
// tick the player saw, not where they are now. It keeps a second of every
// machine's pose and life; a rewound round meets the static arena (Rapier)
// and every other machine's chassis boxes at that tick (a ray against
// oriented boxes, plain maths), the nearest hit taking it. A machine that was
// a wreck then, or has died since, still stops the round but takes no hit:
// that life is over, and the one it lives now is somewhere else. An empty
// seat's machine (out of play then) stops nothing. Rockets fly in the
// present and are never rewound.

const SPAN = 60 // ticks of poses kept (a second)
const ABSENT = -2 // a life: out of play

export function createRewind(world: RAPIER.World, combatants: readonly Combatant[]) {
  const poses = new Float64Array(SPAN * combatants.length * 7) // per tick and machine: position, rotation
  const lives = new Int32Array(SPAN * combatants.length) // per tick and machine: its life (deaths so far), -1 a wreck, ABSENT out of play
  const deaths = new Int32Array(combatants.length) // each machine's, so far
  const alive = combatants.map((c) => c.alive) // as last recorded
  const kept = new Int32Array(SPAN).fill(-1) // the tick each slot holds
  const at = (tick: number, id: number) => ((tick % SPAN) * combatants.length + id) * 7
  const life = (tick: number, id: number) => (tick % SPAN) * combatants.length + id
  // Something solid that isn't a machine: what a round stopped by a machine's past life strikes.
  let solid: RAPIER.Collider | null = null
  world.forEachCollider((collider) => void (solid ??= collider.parent()?.isFixed() ? collider : null))

  // Every machine's pose and life after step `tick`.
  function record(tick: number) {
    kept[tick % SPAN] = tick
    for (const c of combatants) {
      const i = at(tick, c.id)
      poses.set([c.position.x, c.position.y, c.position.z, c.rotation.x, c.rotation.y, c.rotation.z, c.rotation.w], i)
      if (alive[c.id] && !c.alive) deaths[c.id]++
      alive[c.id] = c.alive
      lives[life(tick, c.id)] = !c.present ? ABSENT : c.alive ? deaths[c.id] : -1
    }
  }

  const direction = new THREE.Vector3()
  const ray = new RAPIER.Ray(new THREE.Vector3(), new THREE.Vector3())
  const place = new THREE.Vector3()
  const turn = new THREE.Quaternion()
  const back = new THREE.Quaternion()
  const origin = new THREE.Vector3()
  const along = new THREE.Vector3()
  const centre = new THREE.Vector3()
  const face = new THREE.Vector3()

  // `shooter`'s round from `muzzle` toward its aim, spread as castRound
  // spreads it, cast against the arena now and the other machines as they
  // were at `tick`: into `shot` (a machine struck is named by its first
  // collider, if it's the life it lives now). False if `tick`'s poses aren't kept.
  function cast(shooter: Combatant, muzzle: THREE.Vector3, tick: number, shot: Shot, random: () => number) {
    if (kept[tick % SPAN] !== tick) return false
    const { spec } = shooter.weapon
    scatterAim(spec, muzzle, shooter.control.aim, direction, random)
    ray.origin = muzzle
    ray.dir = direction
    const wall = world.castRayAndGetNormal(ray, spec.range, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
    let nearest = wall ? wall.timeOfImpact : spec.range
    let struck: RAPIER.Collider | null = wall ? wall.collider : null
    if (wall) shot.normal.set(wall.normal.x, wall.normal.y, wall.normal.z)
    for (const c of combatants) {
      if (c === shooter || lives[life(tick, c.id)] === ABSENT) continue
      const i = at(tick, c.id)
      place.set(poses[i], poses[i + 1], poses[i + 2])
      turn.set(poses[i + 3], poses[i + 4], poses[i + 5], poses[i + 6])
      back.copy(turn).invert()
      for (const [hx, hy, hz, y, z] of VEHICLES[c.vehicle].chassis.shells) {
        centre.set(0, y, z).applyQuaternion(turn).add(place)
        origin.subVectors(muzzle, centre).applyQuaternion(back)
        along.copy(direction).applyQuaternion(back)
        const hit = rayBox(origin, along, hx, hy, hz, face)
        if (hit < 0 || hit >= nearest) continue
        nearest = hit
        struck = lives[life(tick, c.id)] === deaths[c.id] && c.alive ? c.car.body.collider(0) : solid
        shot.normal.copy(face).applyQuaternion(turn)
      }
    }
    shot.point.copy(muzzle).addScaledVector(direction, nearest)
    shot.collider = struck
    return true
  }

  // Where machine `id` stood after step `tick` (into `out`); false if that tick isn't kept.
  function where(id: number, tick: number, out: THREE.Vector3) {
    if (kept[tick % SPAN] !== tick) return false
    const i = at(tick, id)
    out.set(poses[i], poses[i + 1], poses[i + 2])
    return true
  }

  return { record, cast, where }
}

// Distance along a unit ray (`o` + t `d`, in the box's own frame) to where it
// enters a box of half extents (hx, hy, hz) at the origin, with the face's
// outward normal in `normal`; -1 for a miss. From inside, 0.
function rayBox(o: THREE.Vector3, d: THREE.Vector3, hx: number, hy: number, hz: number, normal: THREE.Vector3) {
  let near = -Infinity
  let far = Infinity
  let axis = 0
  let sign = 0
  const half = [hx, hy, hz]
  for (let a = 0; a < 3; a++) {
    const from = o.getComponent(a)
    const step = d.getComponent(a)
    if (Math.abs(step) < 1e-9) {
      if (Math.abs(from) > half[a]) return -1
      continue
    }
    let t1 = (-half[a] - from) / step
    let t2 = (half[a] - from) / step
    let s = -1 // entering through the -a face
    if (t1 > t2) {
      ;[t1, t2] = [t2, t1]
      s = 1
    }
    if (t1 > near) {
      near = t1
      axis = a
      sign = s
    }
    far = Math.min(far, t2)
    if (near > far) return -1
  }
  if (far < 0) return -1
  normal.set(0, 0, 0).setComponent(axis, sign)
  return Math.max(near, 0)
}
