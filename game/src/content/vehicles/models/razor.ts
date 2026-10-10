import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { bentTube, extrudeProfile, part, tube, type Vec3 } from '../../../render/geometry.ts'
import { LIVERIES, materials } from '../../../render/materials/library.ts'
import { createRng } from '../../../shared/rng.ts'
import { buildBlade, buildLamp, spike } from '../../parts.ts'
import type { ModelParts, VehicleOptions } from '../types.ts'
import { VEHICLES } from '../vehicles.ts'

// War-rig layout (the Razor). Metres; +Z forward, +Y up, so the driver's
// left is +X. Wheel size and placement come from the Razor's chassis, which
// the physics builds too.
const { wheelRadius: WHEEL_RADIUS, wheels: WHEELS } = VEHICLES.razor.chassis
const WHEEL_WIDTH = 0.42
const AXLE_Z = WHEELS[0][2]
const BODY_WIDTH = 1.84
const CABIN_WIDTH = 1.5
const ARCH_RADIUS = 0.62
const SILL = 0.55

const polygon = (points: Array<[z: number, y: number]>) => new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)))

// Lower body side silhouette (z, y) with both wheel arches cut out.
function hullProfile() {
  const archStart = Math.asin((SILL - WHEEL_RADIUS) / ARCH_RADIUS)
  const shape = polygon([
    [-2.12, SILL],
    [-2.14, 1.2],
    [-1.98, 1.32],
    [0.62, 1.32],
    [2.02, 1.19],
    [2.16, 1.07],
    [2.14, SILL + 0.06],
    [2.08, SILL],
  ])
  for (const axle of [AXLE_Z, -AXLE_Z]) shape.absarc(axle, WHEEL_RADIUS, ARCH_RADIUS, archStart, Math.PI - archStart, false)
  shape.closePath()
  return shape
}

const CABIN_PROFILE: Array<[number, number]> = [
  [0.66, 1.28],
  [-0.1, 1.88],
  [-1.08, 1.9],
  [-1.66, 1.28],
]

const SIDE_WINDOW: Array<[number, number]> = [
  [0.42, 1.38],
  [-0.12, 1.8],
  [-1.02, 1.82],
  [-1.44, 1.38],
]

// Riveted arch band bolted over each wheel.
function flareProfile() {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, ARCH_RADIUS + 0.14, 0.12, Math.PI - 0.12, false)
  shape.absarc(0, 0, ARCH_RADIUS + 0.02, Math.PI - 0.12, 0.12, true)
  shape.closePath()
  return shape
}

// The Razor's body; models.ts merges it and adds the turret and wheels.
export function buildRazor({ livery = LIVERIES.hazard, seed = 1 }: VehicleOptions): ModelParts {
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

  // Body: hull, a narrower tub closing the arch tunnels, greenhouse, flares.
  add(extrudeProfile(hullProfile(), BODY_WIDTH, 0.035), paint)
  add(new RoundedBoxGeometry(1.36, 0.62, 4.0, 2, 0.04), dark, [0, 0.76, 0])
  add(extrudeProfile(polygon(CABIN_PROFILE), CABIN_WIDTH, 0.04), paint)
  for (const [, x, z] of WHEELS) add(extrudeProfile(flareProfile(), 0.3, 0.02), paint, [Math.sign(x) * 1.0, WHEEL_RADIUS, z])

  // Mismatched armour plates over doors, quarters and sills; crest on each door.
  for (const side of [-1, 1]) {
    const skin = side * (BODY_WIDTH / 2 + 0.016)
    plate(paint, [0.03, 0.46, 1.02], [skin, 0.9, -0.22])
    plate(paint, [0.03, 0.34, 0.5], [skin, 1.06, -1.3], [0, jitter(0.06), jitter(0.06)])
    plate(paint, [0.03, 0.3, 0.42], [skin, 1.08, 0.5], [0, jitter(0.06), jitter(0.06)])
    plate(rusty, [0.03, 0.14, 1.5], [side * (BODY_WIDTH / 2 + 0.02), 0.64, -0.05])
    add(new THREE.PlaneGeometry(0.52, 0.52), materials.emblem(), [side * (BODY_WIDTH / 2 + 0.036), 0.9, -0.22], [0, (side * Math.PI) / 2, 0])
  }

  // Hood: raised centre panel and reinforcing bars following the slope.
  const hoodPitch = Math.atan2(1.32 - 1.19, 2.02 - 0.62)
  plate(paint, [1.2, 0.05, 1.2], [0, 1.28, 1.35], [hoodPitch, 0, 0])
  for (const x of [-0.35, 0.35]) add(tube([x, 1.34, 0.8], [x, 1.23, 2.0], 0.026), steel)

  // Glass behind bars: windshield grid, meshed side windows.
  const windshieldPitch = Math.atan2(-(0.66 + 0.1), 1.88 - 1.28)
  add(new THREE.BoxGeometry(CABIN_WIDTH - 0.16, 0.86, 0.012), materials.glass(), [0, 1.59, 0.29], [windshieldPitch, 0, 0])
  for (const x of [-0.5, -0.25, 0, 0.25, 0.5]) add(tube([x, 1.33, 0.7], [x, 1.93, -0.06], 0.016), steel)
  add(tube([-0.66, 1.62, 0.34], [0.66, 1.62, 0.34], 0.016), steel)
  const rearPitch = Math.atan2(1.66 - 1.08, 1.9 - 1.28)
  add(new THREE.BoxGeometry(CABIN_WIDTH - 0.2, 0.7, 0.012), materials.glass(), [0, 1.6, -1.38], [rearPitch, 0, 0])
  for (const x of [-0.35, 0, 0.35]) add(tube([x, 1.31, -1.7], [x, 1.93, -1.12], 0.018), steel)
  for (const side of [-1, 1]) {
    const x = side * (CABIN_WIDTH / 2 + 0.04)
    add(extrudeProfile(polygon(SIDE_WINDOW), 0.02, 0), materials.glass(), [side * (CABIN_WIDTH / 2), 0, 0])
    add(extrudeProfile(polygon(SIDE_WINDOW), 0.012, 0), materials.grate(), [x, 0, 0])
    add(
      bentTube(
        [...SIDE_WINDOW, SIDE_WINDOW[0]].map(([z, y]): Vec3 => [x, y, z]),
        0.022,
      ),
      steel,
    )
  }

  // Roll cage over the cabin, roof rack, light bar.
  for (const side of [-1, 1]) {
    const x = side * 0.8
    add(
      bentTube(
        [
          [x, 1.3, 0.74],
          [x, 1.95, -0.1],
          [x, 1.97, -1.1],
          [x * 1.02, 1.33, -1.86],
        ],
        0.034,
      ),
      steel,
    )
  }
  for (const z of [-0.1, -0.62, -1.1]) add(tube([-0.8, 1.96, z], [0.8, 1.96, z], 0.03), steel)
  for (const x of [-0.5, 0.5]) add(tube([x, 2.0, -0.1], [x, 2.0, -1.1], 0.02), steel)
  add(tube([-0.72, 2.03, 0], [0.72, 2.03, 0], 0.03), steel)
  for (const x of [-0.54, -0.18, 0.18, 0.54]) {
    bolt(buildLamp(0.085, '#ffcf8f', 3.5), [x, 2.13, -0.04])
    add(new THREE.BoxGeometry(0.03, 0.1, 0.03), dark, [x, 2.07, 0])
  }

  // Nose: recessed grille, headlights, bumper, bull bar, six-blade plough.
  add(new THREE.BoxGeometry(1.0, 0.34, 0.1), dark, [0, 0.86, 2.12])
  for (let i = 0; i < 7; i++) add(tube([-0.42 + i * 0.14, 0.7, 2.19], [-0.42 + i * 0.14, 1.03, 2.19], 0.016), steel)
  for (const side of [-1, 1]) {
    plate(dark, [0.3, 0.3, 0.14], [side * 0.66, 0.93, 2.07])
    bolt(buildLamp(0.11, '#ffd9a0', 2.5), [side * 0.66, 0.93, 2.08])
  }
  plate(rusty, [1.96, 0.18, 0.22], [0, 0.62, 2.2])
  add(
    bentTube(
      [
        [-0.56, 0.62, 2.3],
        [-0.56, 1.02, 2.32],
        [-0.42, 1.16, 2.26],
        [0.42, 1.16, 2.26],
        [0.56, 1.02, 2.32],
        [0.56, 0.62, 2.3],
      ],
      0.042,
    ),
    steel,
  )
  for (const x of [-0.3, -0.1, 0.1, 0.3]) add(tube([x, 0.7, 2.31], [x, 1.14, 2.28], 0.024), steel)
  plate(dark, [1.9, 0.12, 0.16], [0, 0.48, 2.3])
  for (let i = 0; i < 6; i++) {
    const x = -0.85 + i * 0.34
    const blade = buildBlade(0.95, 0.28, livery)
    blade.position.set(x, 0.5, 2.3)
    blade.rotation.set(0.38 + jitter(0.06), x * 0.3, 0, 'YXZ')
    shell.add(blade)
  }

  // Tail: bumper, cage, twin LED bars, exhaust stacks.
  plate(rusty, [1.9, 0.2, 0.2], [0, 0.68, -2.22])
  for (const x of [-0.6, -0.2, 0.2, 0.6]) add(tube([x, 0.78, -2.26], [x, 1.28, -2.2], 0.022), steel)
  add(tube([-0.7, 1.02, -2.25], [0.7, 1.02, -2.25], 0.022), steel)
  for (const side of [-1, 1]) {
    for (const y of [1.16, 1.08]) add(new RoundedBoxGeometry(0.34, 0.05, 0.04, 2, 0.01), materials.light('#ff2410', 2.5), [side * 0.5, y, -2.15])
  }

  // Exhausts: sill pipes (upper one in a perforated heat shield), rear stacks, deck pipes.
  for (const side of [-1, 1]) {
    add(
      bentTube(
        [
          [0.66 * side, 0.8, 0.8],
          [0.98 * side, 0.62, 0.62],
          [side, 0.62, -0.2],
          [side, 0.62, -0.82],
        ],
        0.07,
        12,
      ),
      rusty,
    )
    add(
      bentTube(
        [
          [0.66 * side, 0.66, 0.74],
          [0.96 * side, 0.48, 0.56],
          [0.98 * side, 0.48, -0.2],
          [0.98 * side, 0.48, -0.8],
        ],
        0.055,
        12,
      ),
      rusty,
    )
    add(tube([side, 0.62, 0.52], [side, 0.62, -0.1], 0.1, 18), materials.perforated())
    add(tube([side, 0.62, -0.78], [side, 0.62, -0.9], 0.082, 14), steel)
    add(tube([0.98 * side, 0.48, -0.76], [0.98 * side, 0.48, -0.88], 0.066, 14), steel)
    add(tube([0.8 * side, 0.95, -1.98], [0.8 * side, 0.95, -2.5], 0.085, 14), rusty)
    add(tube([0.8 * side, 0.78, -1.98], [0.8 * side, 0.78, -2.44], 0.075, 14), rusty)
    add(tube([0.52 * side, 1.36, -1.5], [0.6 * side, 1.66, -2.14], 0.09, 14), dark)
  }

  // Spikes: raked back along the rear flares, one per front flare, roof corners.
  for (const side of [-1, 1]) {
    const reach = ARCH_RADIUS + 0.14
    for (const angle of [1.7, 2.1, 2.5]) {
      const position: Vec3 = [side * 1.0, WHEEL_RADIUS + Math.sin(angle) * reach, -AXLE_Z + Math.cos(angle) * reach]
      add(spike(0.32, 0.045), steel, position, [Math.PI / 2 - angle - 0.25, 0, 0])
    }
    add(spike(0.42, 0.05), steel, [side * 1.0, WHEEL_RADIUS + reach, AXLE_Z - 0.05], [-0.3, 0, 0])
    add(spike(0.2, 0.035), steel, [side * 0.8, 1.97, -1.1], [-0.6, 0, 0])
  }

  return { shell, turretAt: [0, 1.95, -0.62], wheelWidth: WHEEL_WIDTH }
}
