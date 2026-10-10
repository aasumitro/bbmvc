import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { WeaponSpec } from '../../content/weapons/weapons.ts'
import { distance as flat } from '../../shared/math.ts'
import { AI, type Agent } from './brain.ts'

// What a bot can tell of the world (sim/ai/): feelers off its nose, a clear
// line to a target, teammates in its line of fire, open road between two
// points, somewhere out of a rival's sight. Rays share one scratch origin
// and direction: each finishes before the next starts.

// How far round where it lands a round hurts: a rocket's blast; a gun's
// round hurts only what it hits.
function blastRadius(spec: WeaponSpec): number {
  switch (spec.kind) {
    case 'gun':
      return 0
    case 'rocket':
      return spec.rocket.blast
  }
}

const from = new THREE.Vector3()
const along = new THREE.Vector3()
const ray = new RAPIER.Ray(from, along)

// Clear fraction (0..1) of a horizontal feeler from the bot's nose: walls, junk, other cars.
export function feel(world: RAPIER.World, bot: Agent, heading: number, angle: number, reach: number) {
  from.set(bot.position.x + Math.sin(heading) * 2.3, bot.position.y + 0.7, bot.position.z + Math.cos(heading) * 2.3)
  along.set(Math.sin(heading + angle), 0, Math.cos(heading + angle))
  const hit = world.castRay(ray, reach, true, undefined, undefined, undefined, bot.car.body)
  return hit ? hit.timeOfImpact / reach : 1
}

// Nothing solid between the bot's gun and the target's body.
export function canSee(world: RAPIER.World, bot: Agent, target: Agent) {
  from.copy(bot.position).y += 2.4
  along.copy(target.position).y += 1
  along.sub(from)
  const distance = along.length()
  along.divideScalar(distance)
  const hit = world.castRay(ray, distance, true, undefined, undefined, undefined, bot.car.body)
  return !hit || hit.collider.parent()?.handle === target.car.body.handle
}

// No live teammate within mateGap of the line from the bot to where its gun
// is laid, nor — firing rockets — inside the blast round that point. Flat
// distances: every machine drives on the ground.
export function clearOfMates(bot: Agent, everyone: readonly Agent[]) {
  const aim = bot.control.aim
  const blast = blastRadius(bot.weapon.spec)
  const dx = aim.x - bot.position.x
  const dz = aim.z - bot.position.z
  const length = dx * dx + dz * dz || 1
  for (const mate of everyone) {
    if (mate === bot || !mate.alive || mate.team !== bot.team) continue
    if (blast && flat(mate.position, aim) < blast) return false
    const along = THREE.MathUtils.clamp(((mate.position.x - bot.position.x) * dx + (mate.position.z - bot.position.z) * dz) / length, 0, 1)
    if (Math.hypot(bot.position.x + dx * along - mate.position.x, bot.position.z + dz * along - mate.position.z) < AI.mateGap) return false
  }
  return true
}

// Open road from a to b: nothing static across a car's width, kerbs
// included, so routes keep to the streets. Three rays at wheel height,
// centre and both sides; from on top of a sidewalk nothing counts as open.
export function open(world: RAPIER.World, a: THREE.Vector3, b: THREE.Vector3) {
  const distance = flat(a, b)
  if (distance < 0.5) return true
  const ux = (b.x - a.x) / distance
  const uz = (b.z - a.z) / distance
  for (const side of [0, -1.1, 1.1]) {
    from.set(a.x - uz * side, 0.08, a.z + ux * side)
    along.set(ux, 0, uz)
    if (world.castRay(ray, distance, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)) return false
  }
  return true
}

// Out of `watcher`'s sight: something static between its gun and a car at `at`.
function hiddenFrom(world: RAPIER.World, watcher: THREE.Vector3, at: THREE.Vector3) {
  from.set(watcher.x, watcher.y + 2.4, watcher.z)
  along.set(at.x, 1.2, at.z).sub(from)
  const distance = along.length()
  along.divideScalar(distance)
  return !!world.castRay(ray, distance, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
}

// A hideout for the bot: the nearest point round it (AI.hideouts, twelve ways)
// with open road straight to it that `target` can't see and that isn't on top
// of it, written to `out`; false when there's none.
const spot = new THREE.Vector3()
export function pickHideout(world: RAPIER.World, bot: Agent, target: Agent, out: THREE.Vector3) {
  for (const radius of AI.hideouts) {
    for (let k = 0; k < 12; k++) {
      const angle = (k / 12) * Math.PI * 2
      spot.set(bot.position.x + Math.sin(angle) * radius, 0, bot.position.z + Math.cos(angle) * radius)
      if (flat(spot, target.position) > 12 && open(world, bot.position, spot) && hiddenFrom(world, target.position, spot)) {
        out.copy(spot)
        return true
      }
    }
  }
  return false
}
