import type * as THREE from 'three'
import { buildCannon } from './turrets/cannon.ts'
import { buildLaser } from './turrets/laser.ts'
import { buildMinigun } from './turrets/minigun.ts'
import { buildMines } from './turrets/mines.ts'
import { buildMissiles } from './turrets/missiles.ts'
import { buildRocketPod } from './turrets/rocketPod.ts'
import { buildShotgun } from './turrets/shotgun.ts'
import type { TurretKey } from './weapons.ts'

// Every turret model by the key a weapon names (WeaponSpec.turret), each
// builder in a file of its own. A weapon naming a turret that isn't here, or
// a turret no key names, is a compile error.
export const TURRETS = {
  minigun: buildMinigun,
  rocketPod: buildRocketPod,
  cannon: buildCannon,
  shotgun: buildShotgun,
  laser: buildLaser,
  missiles: buildMissiles,
  mines: buildMines,
} satisfies Record<TurretKey, () => THREE.Group>
