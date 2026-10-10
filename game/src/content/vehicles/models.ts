import * as THREE from 'three'
import { mergeByMaterial } from '../../render/geometry.ts'
import { buildWheel } from '../parts.ts'
import { TURRETS } from '../weapons/turrets.ts'
import type { TurretKey } from '../weapons/weapons.ts'
import { buildRazor } from './models/razor.ts'
import type { Chassis, ModelParts, VehicleOptions } from './types.ts'
import { VEHICLES, type VehicleId } from './vehicles.ts'

// What every model shares, around the body its own builder makes
// (models/<id>.ts): the body merged into a few meshes, the turret on its
// ring, the wheels at the chassis' hubs. The node names are a contract
// gameplay drives: 'body', 'turret' (yaw) with child 'gun' (pitch),
// wheel_fl/fr/rl/rr.
function assemble({ shell, turretAt, wheelWidth }: ModelParts, { wheelRadius, wheels }: Chassis, turret: TurretKey = 'minigun') {
  const vehicle = new THREE.Group()
  vehicle.name = 'vehicle'
  const body = mergeByMaterial(shell)
  body.name = 'body'
  vehicle.add(body)

  const mount = TURRETS[turret]()
  mount.name = 'turret'
  mount.position.set(...turretAt)
  vehicle.add(mount)

  const wheel = buildWheel(wheelRadius, wheelWidth)
  for (const [id, x, z] of wheels) {
    const instance = wheel.clone()
    instance.name = `wheel_${id}`
    instance.position.set(x, wheelRadius, z)
    if (x < 0) instance.rotation.y = Math.PI // outer face out on the right side too
    vehicle.add(instance)
  }
  return vehicle
}

// Each vehicle's model, by id; a new vehicle adds its builder here.
export const MODELS: Record<VehicleId, (options: VehicleOptions) => THREE.Group> = {
  razor: (options) => assemble(buildRazor(options), VEHICLES.razor.chassis, options.turret),
}
