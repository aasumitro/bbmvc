import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { part, tube } from '../../../render/geometry.ts'
import { materials } from '../../../render/materials/library.ts'
import { buildTurret } from '../../parts.ts'

// One heavy barrel on the same yoke: breech block, recoil sleeve, the barrel
// with a slotted muzzle brake, a counterweight behind and a sight on top.
export function buildCannon() {
  const cradle = new THREE.Group()
  cradle.add(part(new RoundedBoxGeometry(0.34, 0.3, 0.58, 2, 0.04), materials.olive(), [0, 0, -0.06]))
  cradle.add(part(new THREE.CylinderGeometry(0.11, 0.125, 0.4, 18), materials.darkSteel(), [0, 0.02, 0.42], [Math.PI / 2, 0, 0]))
  cradle.add(part(tube([0, 0.02, 0.6], [0, 0.02, 1.06], 0.06, 16), materials.darkSteel()))
  cradle.add(part(new THREE.BoxGeometry(0.17, 0.13, 0.17), materials.steel(), [0, 0.02, 1.12]))
  for (const z of [1.08, 1.15]) cradle.add(part(new THREE.BoxGeometry(0.19, 0.035, 0.025), materials.darkSteel(), [0, 0.02, z]))
  cradle.add(part(new THREE.BoxGeometry(0.26, 0.2, 0.14), materials.darkSteel(), [0, -0.02, -0.42]))
  cradle.add(part(new THREE.BoxGeometry(0.07, 0.07, 0.22), materials.darkSteel(), [0.13, 0.2, 0.04]))
  return buildTurret(cradle)
}
