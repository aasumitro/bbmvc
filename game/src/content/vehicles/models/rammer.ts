import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { bentTube, extrudeProfile, part, tube, type Vec3 } from '../../../render/geometry.ts'
import { LIVERIES, materials } from '../../../render/materials/library.ts'
import { createRng } from '../../../shared/rng.ts'
import { buildLamp, spike } from '../../parts.ts'
import type { ModelParts, VehicleOptions } from '../types.ts'
import { VEHICLES } from '../vehicles.ts'

// Battering ram layout (the Rammer): a low steel wedge, the cabin set back
// on it with the turret on its roof, a V-plough across the nose that the
// ram's blows land with. Metres; +Z forward, +Y up, so the driver's left is
// +X. Wheel size and placement come from the Rammer's chassis, which the
// physics builds too.
const { wheelRadius: WHEEL_RADIUS, wheels: WHEELS } = VEHICLES.rammer.chassis
const WHEEL_WIDTH = 0.48
const AXLE_Z = WHEELS[0][2]
const BODY_WIDTH = 1.96
const CABIN_WIDTH = 1.56
const ARCH_RADIUS = 0.68
const SILL = 0.58
const DECK = 1.32 // the wedge's top behind the cabin, sloping down to the nose ahead of it
const ROOF = 1.86 // the cabin's, the turret ring on it
const TURRET_AT: Vec3 = [0, ROOF + 0.01, -0.5]

const polygon = (points: Array<[z: number, y: number]>) => new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)))

// The wedge's side silhouette (z, y): a flat deck at the back, sloping down
// to a low nose, both wheel arches cut out.
function hullProfile() {
  const archStart = Math.asin((SILL - WHEEL_RADIUS) / ARCH_RADIUS)
  const shape = polygon([
    [-2.38, SILL],
    [-2.44, 1.18],
    [-2.3, DECK],
    [-0.2, DECK],
    [2.3, 0.94],
    [2.42, 0.7],
    [2.34, SILL],
  ])
  for (const axle of [AXLE_Z, -AXLE_Z]) shape.absarc(axle, WHEEL_RADIUS, ARCH_RADIUS, archStart, Math.PI - archStart, false)
  shape.closePath()
  return shape
}

// The cabin on the deck, its windscreen laid well back.
const CABIN_PROFILE: Array<[number, number]> = [
  [-1.36, DECK - 0.02],
  [-1.3, ROOF],
  [0.2, ROOF],
  [0.62, 1.4],
  [0.62, 1.18],
]
const SCREEN = { bottom: [0.62, 1.4], top: [0.2, ROOF] } as const // the windscreen's slope (z, y)

const SIDE_SLIT: Array<[number, number]> = [
  [-0.05, 1.56],
  [-0.05, 1.72],
  [-1.0, 1.72],
  [-1.0, 1.56],
]

// The Rammer's body; models.ts merges it and adds the turret and wheels.
export function buildRammer({ livery = LIVERIES.hazard, seed = 1 }: VehicleOptions): ModelParts {
  const rng = createRng(seed)
  const jitter = (amount: number) => (rng() - 0.5) * amount
  const paint = materials.paint(livery)
  const steel = materials.steel()
  const rusty = materials.rustySteel()
  const dark = materials.darkSteel()

  // Everything rigid goes into `shell`, merged into a few meshes at the end.
  const shell = new THREE.Group()
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, position?: Vec3, rotation?: Vec3) =>
    shell.add(part(geometry, material, position, rotation))
  const plate = (material: THREE.Material, size: Vec3, position: Vec3, rotation?: Vec3) =>
    add(new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(...size) * 0.3), material, position, rotation)
  const bolt = (object: THREE.Object3D, position: Vec3) => {
    object.position.set(...position)
    shell.add(object)
  }

  // Body: the wedge, a narrower tub closing the arch tunnels, the cabin.
  add(extrudeProfile(hullProfile(), BODY_WIDTH, 0.04), paint)
  add(new RoundedBoxGeometry(1.5, 0.62, 4.5, 2, 0.05), dark, [0, 0.9, 0])
  add(extrudeProfile(polygon(CABIN_PROFILE), CABIN_WIDTH, 0.04), paint)

  // Armour: a plate down each flank, a sill guard, rivets; the crest on each door.
  for (const side of [-1, 1]) {
    const skin = side * (BODY_WIDTH / 2 + 0.018)
    plate(paint, [0.035, 0.42, 1.7], [skin, 1.0, -0.1], [0, jitter(0.04), jitter(0.04)])
    plate(rusty, [0.035, 0.14, 1.9], [side * (BODY_WIDTH / 2 + 0.026), 0.7, -0.1])
    for (let i = 0; i <= 9; i++)
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 6), steel, [side * (BODY_WIDTH / 2 + 0.008), 1.24, -2.1 + i * 0.4], [0, 0, Math.PI / 2])
    add(new THREE.PlaneGeometry(0.4, 0.4), materials.emblem(), [side * (BODY_WIDTH / 2 + 0.038), 1.0, -0.1], [0, (side * Math.PI) / 2, 0])
  }

  // Glass behind a grate: the windscreen, and a slit down each side.
  const [zb, yb] = SCREEN.bottom
  const [zt, yt] = SCREEN.top
  const slope = Math.hypot(zb - zt, yt - yb)
  const pitch = Math.atan2(-(zb - zt), yt - yb)
  const out = [(yt - yb) / slope, (zb - zt) / slope] // the windscreen's outward normal (z, y)
  const onScreen = (t: number, lift: number): Vec3 => [0, yb + t * (yt - yb) + lift * out[1], zb + t * (zt - zb) + lift * out[0]]
  add(new THREE.BoxGeometry(CABIN_WIDTH - 0.2, slope - 0.08, 0.012), materials.glass(), onScreen(0.5, 0.012), [pitch, 0, 0])
  add(new THREE.BoxGeometry(CABIN_WIDTH - 0.2, slope - 0.08, 0.008), materials.grate(), onScreen(0.5, 0.03), [pitch, 0, 0])
  for (const side of [-1, 1]) {
    add(extrudeProfile(polygon(SIDE_SLIT), 0.02, 0), materials.glass(), [side * (CABIN_WIDTH / 2), 0, 0])
    add(
      bentTube(
        [...SIDE_SLIT, SIDE_SLIT[0]].map(([z, y]): Vec3 => [side * (CABIN_WIDTH / 2 + 0.03), y, z]),
        0.022,
      ),
      steel,
    )
  }

  // Roof: the collar round the turret ring, a light bar over the windscreen.
  add(new THREE.CylinderGeometry(0.48, 0.52, 0.08, 28), dark, [TURRET_AT[0], TURRET_AT[1] - 0.02, TURRET_AT[2]])
  add(tube([-0.66, ROOF + 0.05, 0.12], [0.66, ROOF + 0.05, 0.12], 0.024), steel)
  for (const x of [-0.45, 0, 0.45]) bolt(buildLamp(0.06, '#ffcf8f', 3.5), [x, ROOF + 0.11, 0.1])

  // Nose: headlights sunk in the wedge, the push bar, and the plough: two
  // plates meeting in a V ahead of the bumper, on struts, a hazard-striped
  // lip along its foot, spikes along its top and a beak at its point.
  for (const side of [-1, 1]) {
    plate(dark, [0.3, 0.16, 0.14], [side * 0.62, 0.86, 2.3], [-0.15, 0, 0])
    bolt(buildLamp(0.07, '#ffd9a0', 2.5), [side * 0.62, 0.86, 2.37])
  }
  plate(rusty, [2.0, 0.22, 0.22], [0, 0.62, 2.38])
  for (const side of [-1, 1]) {
    plate(rusty, [1.24, 0.7, 0.07], [side * 0.56, 0.74, 2.72], [0, side * 0.42, 0])
    plate(materials.hazard(livery), [1.24, 0.12, 0.09], [side * 0.56, 0.42, 2.74], [0, side * 0.42, 0])
    for (const x of [0.35, 0.85]) add(tube([side * x, 0.66, 2.44], [side * x, 0.72, 2.86 - x * 0.42], 0.045), dark)
    for (const x of [0.3, 0.7, 1.05]) add(spike(0.26, 0.045), steel, [side * x, 1.08, 2.92 - x * 0.45], [1.15 + jitter(0.1), 0, 0])
  }
  add(new THREE.ConeGeometry(0.09, 0.4, 8), steel, [0, 0.74, 3.12], [Math.PI / 2, 0, 0])

  // Tail: bumper, LED bars, the exhausts out through the deck.
  plate(rusty, [1.96, 0.2, 0.2], [0, 0.7, -2.44])
  for (const side of [-1, 1]) {
    for (const y of [1.12, 1.04]) add(new RoundedBoxGeometry(0.36, 0.05, 0.04), materials.light('#ff2410', 2.5), [side * 0.64, y, -2.45])
    add(tube([side * 0.72, DECK - 0.05, -1.9], [side * 0.72, DECK + 0.42, -2.0], 0.07, 14), rusty)
    add(new THREE.CylinderGeometry(0.085, 0.075, 0.06, 14), dark, [side * 0.72, DECK + 0.45, -2.0])
  }

  return { shell, turretAt: TURRET_AT, wheelWidth: WHEEL_WIDTH }
}
