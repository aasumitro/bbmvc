import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { part } from '../../../render/geometry.ts'
import { materials } from '../../../render/materials/library.ts'
import { buildTurret } from '../../parts.ts'

// A mine rack on the same yoke: three mines stacked between side plates on
// a base plate, the feed chute down the back, a red band across the front.
export function buildMines() {
  const cradle = new THREE.Group()
  cradle.add(part(new RoundedBoxGeometry(0.5, 0.06, 0.62, 2, 0.02), materials.darkSteel(), [0, -0.1, 0.05]))
  for (const x of [-0.27, 0.27]) cradle.add(part(new THREE.BoxGeometry(0.04, 0.34, 0.5), materials.olive(), [x, 0.06, 0.05]))
  for (let i = 0; i < 3; i++) {
    cradle.add(part(new THREE.CylinderGeometry(0.21, 0.23, 0.07, 18), materials.darkSteel(), [0, -0.04 + i * 0.085, 0.05]))
    cradle.add(part(new THREE.CylinderGeometry(0.09, 0.1, 0.02, 14), materials.olive(), [0, 0.005 + i * 0.085, 0.05]))
  }
  cradle.add(part(new THREE.BoxGeometry(0.22, 0.05, 0.4), materials.steel(), [0, -0.14, -0.32], [-0.5, 0, 0])) // the chute
  cradle.add(part(new THREE.BoxGeometry(0.58, 0.05, 0.05), materials.bodywork('#a3261b'), [0, 0.2, 0.31]))
  return buildTurret(cradle)
}
