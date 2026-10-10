import type * as THREE from 'three'
import { buildMinigun } from './turrets/minigun.ts'
import { buildRocketPod } from './turrets/rocketPod.ts'
import type { TurretKey } from './weapons.ts'

// Every turret model by the key a weapon names (WeaponSpec.turret), each
// builder in a file of its own. A weapon naming a turret that isn't here, or
// a turret no key names, is a compile error.
export const TURRETS = {
  minigun: buildMinigun,
  rocketPod: buildRocketPod,
} satisfies Record<TurretKey, () => THREE.Group>
