import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { part } from '../../../render/geometry.ts'
import { materials } from '../../../render/materials/library.ts'
import { buildTurret } from '../../parts.ts'

// A four-cell missile box on the same yoke: a seeker head on top that the
// lock looks through, a missile's red nose in each cell mouth, strap bands.
export function buildMissiles() {
  const cradle = new THREE.Group()
  cradle.add(part(new RoundedBoxGeometry(0.38, 0.36, 0.86, 2, 0.04), materials.olive(), [0, 0.03, 0.22]))
  for (const y of [-0.05, 0.11]) {
    for (const x of [-0.085, 0.085]) {
      cradle.add(part(new THREE.CylinderGeometry(0.062, 0.062, 0.08, 16, 1, true), materials.darkSteel(), [x, y, 0.66], [Math.PI / 2, 0, 0]))
      cradle.add(part(new THREE.ConeGeometry(0.05, 0.13, 12), materials.bodywork('#a3261b'), [x, y, 0.66], [Math.PI / 2, 0, 0]))
    }
  }
  for (const z of [-0.12, 0.5]) cradle.add(part(new THREE.BoxGeometry(0.41, 0.4, 0.04), materials.darkSteel(), [0, 0.03, z])) // strap bands
  cradle.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 16), materials.darkSteel(), [0, 0.28, 0.3], [Math.PI / 2, 0, 0])) // the seeker
  cradle.add(part(new THREE.CircleGeometry(0.055, 16), materials.glass(), [0, 0.28, 0.381]))
  return buildTurret(cradle)
}
