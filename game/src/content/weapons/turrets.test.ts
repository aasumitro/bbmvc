import '../../../server/headless.ts'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { TURRETS } from './turrets.ts'
import type { TurretKey } from './weapons.ts'

// Every turret model, built headless (server/headless.ts): a group that
// yaws, with the 'gun' that pitches as its child, something to draw in it.
function gunOf(turret: THREE.Group) {
  const gun = turret.getObjectByName('gun')
  let meshes = 0
  gun?.traverse((part) => void (part instanceof THREE.Mesh && meshes++))
  return { child: gun?.parent === turret, drawn: meshes > 0 }
}

describe('TURRETS', () => {
  it.each(Object.keys(TURRETS) as TurretKey[])('%s carries its gun', (key) => {
    expect(gunOf(TURRETS[key]())).toEqual({ child: true, drawn: true })
  })
})
