import '../../../server/headless.ts'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { TURRETS } from '../weapons/turrets.ts'
import type { TurretKey } from '../weapons/weapons.ts'
import { MODELS } from './models.ts'
import { VEHICLES, type VehicleId } from './vehicles.ts'

// Every vehicle's model, built headless as the game server builds the arenas
// (server/headless.ts fakes the canvases its materials paint): the nodes the
// view drives by name, each wheel on its chassis hub, and the gun's
// trunnion where the spec mounts it (where its rounds leave from) whichever
// turret it carries.

const IDS = Object.keys(MODELS) as VehicleId[]
const KEYS = Object.keys(TURRETS) as TurretKey[]

describe.each(IDS)('MODELS.%s', (id) => {
  const { chassis, turret } = VEHICLES[id]
  const model = MODELS[id]({ seed: 1 })

  it("names 'body', 'turret' > 'gun' and a wheel for each hub, each where the view looks for it", () => {
    const yaw = model.getObjectByName('turret')
    expect(model.getObjectByName('body')?.parent).toBe(model)
    expect(yaw?.parent).toBe(model)
    expect(yaw?.getObjectByName('gun')?.parent).toBe(yaw)
    const wheels = model.children.filter((child) => child.name.startsWith('wheel_')).map((wheel) => wheel.name)
    expect(wheels.sort()).toEqual(chassis.wheels.map(([hub]) => `wheel_${hub}`).sort())
  })

  it.each(chassis.wheels)('puts wheel_%s on its hub', (hub, x, z) => {
    expect(model.getObjectByName(`wheel_${hub}`)?.position.toArray()).toEqual([x, chassis.wheelRadius, z])
  })

  it.each(KEYS)("lays the %s's trunnion at the spec's mount", (key) => {
    const gun = MODELS[id]({ seed: 1, turret: key }).getObjectByName('gun')!
    gun.updateWorldMatrix(true, false)
    expect(gun.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...turret.mount))).toBeLessThan(1e-9)
  })
})
