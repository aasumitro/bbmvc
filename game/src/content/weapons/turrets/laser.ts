import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { part, tube } from '../../../render/geometry.ts'
import { materials } from '../../../render/materials/library.ts'
import { buildTurret } from '../../parts.ts'

// A beam projector on the same yoke: the power pack, the emitter tube in a
// stack of cooling fins, a lens housing at the muzzle with its lens lit, the
// cables from pack to tube, a counterweight behind.
export function buildLaser() {
  const cradle = new THREE.Group()
  cradle.add(part(new RoundedBoxGeometry(0.32, 0.28, 0.56, 2, 0.04), materials.olive(), [0, 0, -0.06]))
  cradle.add(part(tube([0, 0.03, 0.2], [0, 0.03, 1.02], 0.065, 16), materials.darkSteel()))
  for (let z = 0.3; z <= 0.78; z += 0.06) cradle.add(part(new THREE.BoxGeometry(0.22, 0.22, 0.018), materials.steel(), [0, 0.03, z]))
  cradle.add(part(new THREE.CylinderGeometry(0.1, 0.085, 0.13, 18), materials.darkSteel(), [0, 0.03, 1.07], [Math.PI / 2, 0, 0]))
  cradle.add(part(new THREE.CircleGeometry(0.06, 18), materials.light('#7fdcff', 6), [0, 0.03, 1.136]))
  for (const x of [-0.11, 0.11]) cradle.add(part(tube([x, -0.1, 0.1], [x * 0.6, -0.04, 0.9], 0.016, 6), materials.rubber()))
  cradle.add(part(new THREE.BoxGeometry(0.24, 0.22, 0.14), materials.darkSteel(), [0, -0.01, -0.4]))
  return buildTurret(cradle)
}
