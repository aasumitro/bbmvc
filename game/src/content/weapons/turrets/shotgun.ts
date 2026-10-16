import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { part, tube } from '../../../render/geometry.ts'
import { materials } from '../../../render/materials/library.ts'
import { buildTurret } from '../../parts.ts'

// A pump-action scattergun on the same yoke: the receiver, one wide barrel
// in a perforated shroud to a choke at the muzzle, the tube magazine under
// it with the pump, a box of shells on the side, a counterweight behind.
export function buildShotgun() {
  const cradle = new THREE.Group()
  cradle.add(part(new RoundedBoxGeometry(0.3, 0.28, 0.6, 2, 0.04), materials.olive(), [0, 0, -0.05]))
  cradle.add(part(tube([0, 0.05, 0.25], [0, 0.05, 1.08], 0.07, 16), materials.darkSteel()))
  cradle.add(part(tube([0, 0.05, 0.4], [0, 0.05, 0.98], 0.088, 16), materials.perforated()))
  cradle.add(part(new THREE.CylinderGeometry(0.095, 0.08, 0.08, 16), materials.steel(), [0, 0.05, 1.11], [Math.PI / 2, 0, 0]))
  cradle.add(part(tube([0, -0.08, 0.25], [0, -0.08, 0.95], 0.045, 12), materials.steel()))
  cradle.add(part(new RoundedBoxGeometry(0.13, 0.11, 0.32, 2, 0.03), materials.darkSteel(), [0, -0.07, 0.62]))
  cradle.add(part(new THREE.BoxGeometry(0.16, 0.2, 0.24), materials.olive(), [0.17, -0.02, -0.1]))
  cradle.add(part(new THREE.BoxGeometry(0.22, 0.24, 0.12), materials.darkSteel(), [0, -0.01, -0.4]))
  return buildTurret(cradle)
}
