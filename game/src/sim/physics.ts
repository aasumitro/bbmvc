import RAPIER from '@dimforge/rapier3d-compat'
import type { ArenaCollider } from '../content/arenas/arena.ts'

// Rapier's WASM module must finish initialising before any physics call.
// Started once, by the loading screen (loading.ts); a failed start is
// forgotten so a retry starts it again.
let physics: Promise<void> | undefined
export function initPhysics() {
  physics ??= RAPIER.init().catch((error: unknown) => {
    physics = undefined
    throw error
  })
  return physics
}

// Fixed simulation step, decoupled from the render rate.
export const PHYSICS_STEP = 1 / 60
export const GRAVITY = 14.7 // ~1.5 g: arcade cars land instead of floating

// Static world: a ground slab plus the arena's collision footprint, all on
// one fixed body (the wheel ray-casts expect every collider to have a parent).
export function createWorld(colliders: ArenaCollider[]) {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 })
  world.timestep = PHYSICS_STEP
  const yard = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  const add = (desc: RAPIER.ColliderDesc, friction = 0.4) => world.createCollider(desc.setFriction(friction), yard)

  add(RAPIER.ColliderDesc.cuboid(450, 10, 450).setTranslation(0, -10, 0), 0.8) // thick, so deep overlaps push cars up, not through
  for (const shape of colliders) {
    if ('box' in shape) {
      const { box, position: p } = shape
      add(RAPIER.ColliderDesc.cuboid(box.x, box.y, box.z).setTranslation(p.x, p.y, p.z).setRotation(shape.rotation))
    } else if ('cylinder' in shape) {
      const {
        cylinder: [radius, halfHeight],
        position: p,
      } = shape
      add(RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(p.x, p.y, p.z))
    } else {
      const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(shape.hull.flatMap((p) => [p.x, p.y, p.z])))
      if (hull) add(hull)
    }
  }
  world.step() // builds the scene-query structures, so ray casts see the yard at once
  return world
}
