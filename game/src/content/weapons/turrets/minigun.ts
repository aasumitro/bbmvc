import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { bentTube, part, tube } from '../../../render/geometry.ts'
import { materials } from '../../../render/materials/library.ts'
import { buildTurret } from '../../parts.ts'

export function buildMinigun() {
  const cradle = new THREE.Group()
  cradle.add(part(new RoundedBoxGeometry(0.3, 0.26, 0.56, 2, 0.03), materials.darkSteel(), [0, 0, -0.04]))
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    const bx = Math.cos(angle) * 0.055
    const by = Math.sin(angle) * 0.055
    cradle.add(part(tube([bx, by, 0.2], [bx, by, 1.12], 0.018, 8), materials.darkSteel()))
  }
  for (const z of [0.36, 0.78, 1.08]) {
    cradle.add(part(new THREE.CylinderGeometry(0.088, 0.088, 0.05, 18), materials.steel(), [0, 0, z], [Math.PI / 2, 0, 0]))
  }
  cradle.add(part(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 18), materials.darkSteel(), [0, 0, 0.27], [Math.PI / 2, 0, 0]))
  cradle.add(part(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 14), materials.steel(), [0, 0.04, -0.4], [Math.PI / 2, 0, 0]))
  cradle.add(part(new RoundedBoxGeometry(0.24, 0.3, 0.42, 2, 0.02), materials.olive(), [0.33, -0.03, -0.06]))
  cradle.add(part(new THREE.BoxGeometry(0.1, 0.03, 0.26), materials.darkSteel(), [0.33, 0.135, -0.06]))
  cradle.add(
    part(
      bentTube(
        [
          [0.24, 0.06, 0.04],
          [0.16, 0.12, 0.1],
          [0.06, 0.08, 0.12],
        ],
        0.035,
      ),
      materials.darkSteel(),
    ),
  )
  return buildTurret(cradle)
}
