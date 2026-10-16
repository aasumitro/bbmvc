import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { bentTube, extrudeProfile, part, tube, type Vec3 } from '../../../render/geometry.ts'
import { LIVERIES, materials } from '../../../render/materials/library.ts'
import { createRng } from '../../../shared/rng.ts'
import { buildLamp, buildWheel, spike } from '../../parts.ts'
import type { ModelParts, VehicleOptions } from '../types.ts'
import { VEHICLES } from '../vehicles.ts'

// Armoured hauler layout (the Brute): a cab over the front axle, a fighting
// compartment behind it with the turret on its roof, a dozer blade on the
// nose (plating: ram damage is the Rammer's alone).
// Metres; +Z forward, +Y up, so the driver's left is +X. Wheel size and
// placement come from the Brute's chassis, which the physics builds too.
const { wheelRadius: WHEEL_RADIUS, wheels: WHEELS } = VEHICLES.brute.chassis
const WHEEL_WIDTH = 0.5
const AXLE_Z = WHEELS[0][2]
const BODY_WIDTH = 2.0
const CAB_WIDTH = 1.86
const BOX_WIDTH = 1.84
const ARCH_RADIUS = 0.74
const SILL = 0.66
const DECK = 1.5 // the hull's top: the cab and the fighting compartment stand on it
const ROOF = 2.0 // the cab's, below the turret so the gun shows over it
const BOX_TOP = 2.12 // the fighting compartment's roof, the turret ring on it
const TURRET_AT: Vec3 = [0, BOX_TOP + 0.02, -0.7]

const polygon = (points: Array<[z: number, y: number]>) => new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)))

// Lower hull side silhouette (z, y): a sloped glacis at the nose, both wheel arches cut out.
function hullProfile() {
  const archStart = Math.asin((SILL - WHEEL_RADIUS) / ARCH_RADIUS)
  const shape = polygon([
    [-2.48, SILL],
    [-2.52, 1.4],
    [-2.44, DECK],
    [1.95, DECK],
    [2.42, 1.12],
    [2.5, 0.86],
    [2.46, SILL + 0.06],
    [2.38, SILL],
  ])
  for (const axle of [AXLE_Z, -AXLE_Z]) shape.absarc(axle, WHEEL_RADIUS, ARCH_RADIUS, archStart, Math.PI - archStart, false)
  shape.closePath()
  return shape
}

// Cab over the front axle, its windscreen sloped back.
const CAB_PROFILE: Array<[number, number]> = [
  [0.62, DECK - 0.02],
  [0.62, ROOF],
  [1.82, ROOF],
  [2.04, 1.6],
  [2.0, DECK - 0.02],
]
const SCREEN = { bottom: [2.04, 1.6], top: [1.82, ROOF] } as const // the windscreen's slope (z, y)

const SIDE_WINDOW: Array<[number, number]> = [
  [1.62, 1.7],
  [1.62, 1.92],
  [0.98, 1.92],
  [0.98, 1.7],
]

// The blade across the nose (z, y): a plough plate leaning back from its lip.
const BLADE_PROFILE: Array<[number, number]> = [
  [2.86, 0.44],
  [2.95, 0.5],
  [2.66, 1.0],
  [2.56, 0.98],
]
const BLADE_FACE = { bottom: [2.95, 0.5], top: [2.66, 1.0] } as const

// Riveted arch band bolted over each wheel.
function flareProfile() {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, ARCH_RADIUS + 0.16, 0.1, Math.PI - 0.1, false)
  shape.absarc(0, 0, ARCH_RADIUS + 0.03, Math.PI - 0.1, 0.1, true)
  shape.closePath()
  return shape
}

// The Brute's body; models.ts merges it and adds the turret and wheels.
export function buildBrute({ livery = LIVERIES.hazard, seed = 1 }: VehicleOptions): ModelParts {
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
  const bolt = (object: THREE.Object3D, position: Vec3, yaw = 0) => {
    object.position.set(...position)
    object.rotation.y = yaw
    shell.add(object)
  }

  // Body: hull, a narrower tub closing the arch tunnels, cab, fighting compartment, flares.
  add(extrudeProfile(hullProfile(), BODY_WIDTH, 0.04), paint)
  add(new RoundedBoxGeometry(1.5, 0.7, 4.7, 2, 0.05), dark, [0, 0.92, 0])
  add(extrudeProfile(polygon(CAB_PROFILE), CAB_WIDTH, 0.045), paint)
  add(new RoundedBoxGeometry(BOX_WIDTH, BOX_TOP - DECK + 0.02, 3.0, 2, 0.05), paint, [0, (DECK + BOX_TOP) / 2, -0.98])
  for (const [, x, z] of WHEELS) add(extrudeProfile(flareProfile(), 0.38, 0.02), paint, [Math.sign(x) * 1.12, WHEEL_RADIUS, z])

  // Slab armour: a plate over each door and quarter, mismatched; sill guards; rivets; the crest on each cab door.
  for (const side of [-1, 1]) {
    const skin = side * (BODY_WIDTH / 2 + 0.018)
    plate(paint, [0.035, 0.5, 1.5], [skin, 1.08, 0], [0, jitter(0.04), jitter(0.04)])
    plate(rusty, [0.035, 0.16, 1.6], [side * (BODY_WIDTH / 2 + 0.026), 0.76, 0])
    const box = side * (BOX_WIDTH / 2 + 0.016)
    plate(paint, [0.03, 0.36, 0.72], [box, DECK + 0.26, -1.92], [0, jitter(0.06), jitter(0.06)])
    plate(paint, [0.03, 0.3, 0.86], [box, DECK + 0.27, -0.66], [0, jitter(0.06), jitter(0.06)])
    for (let i = 0; i <= 10; i++)
      add(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6), steel, [side * (BODY_WIDTH / 2 + 0.008), 1.43, -2.3 + i * 0.4], [0, 0, Math.PI / 2])
    add(new THREE.PlaneGeometry(0.44, 0.44), materials.emblem(), [side * (BODY_WIDTH / 2 + 0.038), 1.08, 0], [0, (side * Math.PI) / 2, 0])
  }

  // Glass behind armour: the windscreen behind a grate and visor slats, slit side windows.
  const [zb, yb] = SCREEN.bottom
  const [zt, yt] = SCREEN.top
  const slope = Math.hypot(zb - zt, yt - yb)
  const pitch = Math.atan2(-(zb - zt), yt - yb)
  const out = [(yt - yb) / slope, (zb - zt) / slope] // the windscreen's outward normal (z, y)
  const onScreen = (t: number, lift: number): Vec3 => [0, yb + t * (yt - yb) + lift * out[1], zb + t * (zt - zb) + lift * out[0]]
  add(new THREE.BoxGeometry(CAB_WIDTH - 0.24, slope - 0.1, 0.012), materials.glass(), onScreen(0.5, 0.012), [pitch, 0, 0])
  add(new THREE.BoxGeometry(CAB_WIDTH - 0.24, slope - 0.1, 0.008), materials.grate(), onScreen(0.5, 0.03), [pitch, 0, 0])
  for (const t of [0.16, 0.5, 0.84]) plate(dark, [CAB_WIDTH - 0.1, 0.05, 0.05], onScreen(t, 0.06), [pitch, 0, 0])
  for (const side of [-1, 1]) {
    const x = side * (CAB_WIDTH / 2 + 0.035)
    add(extrudeProfile(polygon(SIDE_WINDOW), 0.02, 0), materials.glass(), [side * (CAB_WIDTH / 2), 0, 0])
    add(extrudeProfile(polygon(SIDE_WINDOW), 0.012, 0), materials.grate(), [x, 0, 0])
    add(
      bentTube(
        [...SIDE_WINDOW, SIDE_WINDOW[0]].map(([z, y]): Vec3 => [x, y, z]),
        0.024,
      ),
      steel,
    )
  }

  // Roof: light bar over the windscreen; the collar round the turret ring, vents behind it.
  add(tube([-0.82, ROOF + 0.06, 1.72], [0.82, ROOF + 0.06, 1.72], 0.026), steel)
  for (const x of [-0.6, -0.2, 0.2, 0.6]) {
    bolt(buildLamp(0.068, '#ffcf8f', 3.5), [x, ROOF + 0.13, 1.68])
    add(new THREE.BoxGeometry(0.03, 0.08, 0.03), dark, [x, ROOF + 0.05, 1.72])
  }
  add(new THREE.CylinderGeometry(0.5, 0.54, 0.08, 28), dark, [TURRET_AT[0], TURRET_AT[1] - 0.02, TURRET_AT[2]])
  add(new THREE.BoxGeometry(1.2, 0.03, 0.7), materials.perforated(), [0, BOX_TOP + 0.01, -1.95])
  for (const x of [-0.7, 0.7]) add(tube([x, BOX_TOP + 0.06, -2.4], [x, BOX_TOP + 0.06, -1.5], 0.022), steel)

  // Nose: headlights caged on the glacis, grille, bumper, bull bar, the blade with its spikes.
  for (const side of [-1, 1]) {
    plate(dark, [0.32, 0.26, 0.2], [side * 0.72, 1.3, 2.24])
    bolt(buildLamp(0.11, '#ffd9a0', 2.5), [side * 0.72, 1.3, 2.32])
    for (const dx of [-0.1, 0.1]) add(tube([side * 0.72 + dx, 1.16, 2.47], [side * 0.72 + dx, 1.46, 2.44], 0.014), steel)
  }
  add(new THREE.BoxGeometry(1.1, 0.26, 0.08), dark, [0, 0.94, 2.47])
  for (let i = 0; i < 8; i++) add(tube([-0.49 + i * 0.14, 0.82, 2.52], [-0.49 + i * 0.14, 1.06, 2.5], 0.016), steel)
  plate(rusty, [2.08, 0.2, 0.24], [0, 0.6, 2.42])
  add(
    bentTube(
      [
        [-0.98, 0.98, 2.52],
        [-0.92, 1.42, 2.46],
        [-0.72, 1.54, 2.4],
        [0.72, 1.54, 2.4],
        [0.92, 1.42, 2.46],
        [0.98, 0.98, 2.52],
      ],
      0.05,
    ),
    steel,
  )
  // the blade: its plate on struts from the bumper, ribs up its face, a hazard-striped lip, spikes along the top
  add(extrudeProfile(polygon(BLADE_PROFILE), 2.24, 0.025), rusty)
  for (const x of [-0.9, -0.3, 0.3, 0.9]) add(tube([x, 0.62, 2.46], [x, 0.78, 2.78], 0.045), dark)
  const [rb, ryb] = BLADE_FACE.bottom
  const [rt, ryt] = BLADE_FACE.top
  const lean = Math.atan2(-(rb - rt), ryt - ryb)
  const face = Math.hypot(rb - rt, ryt - ryb)
  for (const x of [-0.84, -0.28, 0.28, 0.84]) plate(steel, [0.07, face - 0.06, 0.05], [x, (ryb + ryt) / 2 + 0.02, (rb + rt) / 2 + 0.035], [lean, 0, 0])
  plate(materials.hazard(livery), [2.28, 0.12, 0.16], [0, 0.48, 2.9])
  for (const x of [-0.9, -0.45, 0, 0.45, 0.9]) add(spike(0.3, 0.05), steel, [x, 0.98, 2.6], [1.1 + jitter(0.1), 0, 0])

  // Tail: bumper, LED bars, the spare wheel on the compartment's back door, jerry cans.
  plate(rusty, [2.0, 0.22, 0.22], [0, 0.72, -2.56])
  for (const side of [-1, 1]) {
    for (const y of [1.3, 1.22]) add(new RoundedBoxGeometry(0.4, 0.05, 0.04), materials.light('#ff2410', 2.5), [side * 0.66, y, -2.53])
    for (const z of [-2.22, -1.86]) plate(materials.olive(), [0.12, 0.42, 0.3], [side * (BOX_WIDTH / 2 + 0.08), DECK + 0.24, z])
  }
  add(new THREE.BoxGeometry(0.5, 0.5, 0.06), dark, [0, DECK + 0.14, -2.51])
  const spare = buildWheel(0.46, 0.34)
  bolt(spare, [0, DECK + 0.14, -2.72], Math.PI / 2)

  // Exhaust stacks between the cab and the compartment, in heat shields.
  for (const side of [-1, 1]) {
    const x = side * 0.98
    add(tube([x, 1.2, 0.57], [x, 2.44, 0.57], 0.075, 14), rusty)
    add(tube([x, 1.66, 0.57], [x, 2.12, 0.57], 0.1, 18), materials.perforated())
    add(new THREE.CylinderGeometry(0.09, 0.08, 0.06, 14), dark, [x, 2.46, 0.57])
  }

  // Spikes: raked back along the rear flares, up from the cab's roof corners.
  for (const side of [-1, 1]) {
    const reach = ARCH_RADIUS + 0.16
    for (const angle of [1.7, 2.1, 2.5]) {
      const position: Vec3 = [side * 1.12, WHEEL_RADIUS + Math.sin(angle) * reach, -AXLE_Z + Math.cos(angle) * reach]
      add(spike(0.34, 0.05), steel, position, [Math.PI / 2 - angle - 0.25, 0, 0])
    }
    add(spike(0.22, 0.04), steel, [side * 0.86, ROOF, 0.68], [-0.5, 0, 0])
  }

  return { shell, turretAt: TURRET_AT, wheelWidth: WHEEL_WIDTH }
}
