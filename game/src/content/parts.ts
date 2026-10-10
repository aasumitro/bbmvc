import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { extrudeProfile, mergeByMaterial, part, type Vec3 } from '../render/geometry.ts'
import { materials, type Livery } from '../render/materials/library.ts'

// Reusable vehicle parts. Each faces +Z with its origin at its mount point,
// so any chassis (or arena prop) can bolt them on.

// Lathed tyre body around the x axis, without tread — also used for tyre piles.
export function tyreCarcass(radius: number, width: number, segments = 32) {
  const profile = [
    [0.62, -0.9],
    [0.8, -1],
    [0.9, -0.98],
    [0.95, -0.85],
    [0.965, -0.55],
    [0.965, 0.55],
    [0.95, 0.85],
    [0.9, 0.98],
    [0.8, 1],
    [0.62, 0.9],
  ].map(([r, y]) => new THREE.Vector2(r * radius, (y * width) / 2))
  return new THREE.LatheGeometry(profile, segments).rotateZ(-Math.PI / 2)
}

// Off-road wheel: lugged tyre on a beadlock rim. Axle along x, outer face +X.
export function buildWheel(radius: number, width: number) {
  const parts = new THREE.Group()
  const rubber = materials.rubber()
  const metal = materials.darkSteel()
  const half = width / 2
  const tread = radius * 0.93

  parts.add(part(tyreCarcass(tread, width), rubber))

  // Two staggered rows of chevron lugs, plus shoulder blocks that wrap the sidewall.
  const pitches = 20
  for (let i = 0; i < pitches; i++) {
    for (const side of [-1, 1]) {
      const angle = ((i + (side > 0 ? 0.5 : 0)) / pitches) * Math.PI * 2
      const around = (r: number, axial: number): Vec3 => [axial, Math.cos(angle) * r, Math.sin(angle) * r]
      const lug = new THREE.BoxGeometry(width * 0.42, radius * 0.1, radius * 0.17).rotateY(side * 0.25)
      parts.add(part(lug, rubber, around(tread + radius * 0.02, side * half * 0.4), [angle, 0, 0]))
      const shoulder = new THREE.BoxGeometry(width * 0.14, radius * 0.16, radius * 0.15)
      parts.add(part(shoulder, rubber, around(tread * 0.93, side * half * 0.93), [angle, 0, 0]))
    }
  }

  // Rim: dark dish, eight spokes, hub and nuts, beadlock ring with bolts.
  const rim = radius * 0.6
  const x = (t: number) => half * t
  parts.add(part(new THREE.CylinderGeometry(rim, rim, 0.02, 28), metal, [x(0.1), 0, 0], [0, 0, Math.PI / 2]))
  parts.add(part(new THREE.CylinderGeometry(rim, rim, width * 0.85, 28, 1, true), metal, [0, 0, 0], [0, 0, Math.PI / 2]))
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    parts.add(part(new THREE.BoxGeometry(0.04, rim * 0.86, 0.05), metal, [x(0.55), Math.cos(angle) * rim * 0.52, Math.sin(angle) * rim * 0.52], [angle, 0, 0]))
  }
  parts.add(part(new THREE.CylinderGeometry(radius * 0.14, radius * 0.17, 0.13, 18), metal, [x(0.55), 0, 0], [0, 0, Math.PI / 2]))
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    parts.add(
      part(
        new THREE.CylinderGeometry(0.014, 0.014, 0.03, 6),
        materials.steel(),
        [x(0.72), Math.cos(angle) * 0.045, Math.sin(angle) * 0.045],
        [0, 0, Math.PI / 2],
      ),
    )
  }
  parts.add(part(new THREE.TorusGeometry(rim * 1.02, 0.03, 8, 40), metal, [x(0.84), 0, 0], [0, Math.PI / 2, 0]))
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2
    parts.add(
      part(
        new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6),
        materials.steel(),
        [x(0.9), Math.cos(angle) * rim * 1.02, Math.sin(angle) * rim * 1.02],
        [0, 0, Math.PI / 2],
      ),
    )
  }
  return mergeByMaterial(parts)
}

// Plough blade: pointed plate with a serrated spine, hanging forward and down.
export function buildBlade(length: number, height: number, livery: Livery) {
  const shape = new THREE.Shape()
  shape.moveTo(0, height * 0.55)
  shape.lineTo(length * 0.3, height * 0.42)
  shape.lineTo(length * 0.36, height * 0.26)
  shape.lineTo(length * 0.62, height * 0.12)
  shape.lineTo(length, -height * 0.42)
  shape.lineTo(length * 0.5, -height * 0.34)
  shape.lineTo(0, -height * 0.45)
  shape.closePath()
  return part(extrudeProfile(shape, 0.035, 0.008), materials.hazard(livery))
}

// Round lamp (housing, bezel, glowing lens) facing +Z; origin at the housing back.
export function buildLamp(radius: number, color = '#ffd29a', intensity = 10) {
  const lamp = new THREE.Group()
  const depth = radius * 1.3
  lamp.add(part(new THREE.CylinderGeometry(radius, radius * 0.75, depth, 18), materials.darkSteel(), [0, 0, depth / 2], [Math.PI / 2, 0, 0]))
  lamp.add(part(new THREE.TorusGeometry(radius * 0.94, radius * 0.1, 8, 24), materials.steel(), [0, 0, depth]))
  lamp.add(part(new THREE.CircleGeometry(radius * 0.88, 24), materials.light(color, intensity), [0, 0, depth + 0.003]))
  return lamp
}

// Cone spike standing on its base, pointing +Y.
export function spike(length: number, radius: number) {
  return new THREE.ConeGeometry(radius, length, 8).translate(0, length / 2, 0)
}

// Roof turret: ring, pedestal and yoke around `cradle`, which becomes 'gun'
// on the trunnion. The returned group yaws; 'gun' pitches about x.
export function buildTurret(cradle: THREE.Group) {
  const turret = new THREE.Group()
  const mount = new THREE.Group()
  mount.add(part(new THREE.CylinderGeometry(0.3, 0.34, 0.1, 24), materials.darkSteel(), [0, 0.05, 0]))
  mount.add(part(new RoundedBoxGeometry(0.36, 0.28, 0.34, 2, 0.03), materials.darkSteel(), [0, 0.24, 0]))
  for (const x of [-0.19, 0.19]) mount.add(part(new THREE.BoxGeometry(0.04, 0.28, 0.24), materials.steel(), [x, 0.42, 0]))
  turret.add(mergeByMaterial(mount))

  const gun = mergeByMaterial(cradle)
  gun.name = 'gun'
  gun.position.set(0, 0.46, 0)
  turret.add(gun)
  return turret
}
