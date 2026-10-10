import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { part } from '../../../render/geometry.ts'
import { materials } from '../../../render/materials/library.ts'
import { buildTurret } from '../../parts.ts'

// Six-tube rocket box on the same yoke, a warhead showing in each tube mouth.
export function buildRocketPod() {
  const cradle = new THREE.Group()
  cradle.add(part(new RoundedBoxGeometry(0.34, 0.38, 0.9, 2, 0.04), materials.olive(), [0, 0.03, 0.2]))
  for (const y of [-0.07, 0.13]) {
    for (const x of [-0.1, 0, 0.1]) {
      cradle.add(part(new THREE.CylinderGeometry(0.048, 0.048, 0.08, 14, 1, true), materials.darkSteel(), [x, y, 0.66], [Math.PI / 2, 0, 0]))
      cradle.add(part(new THREE.ConeGeometry(0.036, 0.1, 10), materials.steel(), [x, y, 0.64], [Math.PI / 2, 0, 0]))
    }
  }
  for (const z of [-0.14, 0.52]) cradle.add(part(new THREE.BoxGeometry(0.37, 0.42, 0.04), materials.darkSteel(), [0, 0.03, z])) // strap bands
  cradle.add(part(new THREE.BoxGeometry(0.06, 0.06, 0.3), materials.darkSteel(), [0.09, 0.25, 0.1])) // sight box
  return buildTurret(cradle)
}
