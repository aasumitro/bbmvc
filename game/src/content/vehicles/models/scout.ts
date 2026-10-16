import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { bentTube, extrudeProfile, part, tube, type Vec3 } from '../../../render/geometry.ts'
import { LIVERIES, materials } from '../../../render/materials/library.ts'
import { createRng } from '../../../shared/rng.ts'
import { buildLamp, spike } from '../../parts.ts'
import type { ModelParts, VehicleOptions } from '../types.ts'
import { VEHICLES } from '../vehicles.ts'

// Light raider layout (the Scout): a stripped coupe, low and long in the
// nose, its cabin in a cage with the turret on the roof, a wing on the tail.
// Metres; +Z forward, +Y up, so the driver's left is +X. Wheel size and
// placement come from the Scout's chassis, which the physics builds too.
const { wheelRadius: WHEEL_RADIUS, wheels: WHEELS } = VEHICLES.scout.chassis
const WHEEL_WIDTH = 0.34
const AXLE_Z = WHEELS[0][2]
const BODY_WIDTH = 1.76
const CABIN_WIDTH = 1.36
const ARCH_RADIUS = 0.54
const SILL = 0.42
const DECK = 1.0 // the tail's top, the wing above it
const ROOF = 1.42
const TURRET_AT: Vec3 = [0, ROOF + 0.02, -0.55]

const polygon = (points: Array<[z: number, y: number]>) => new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)))

// Lower body side silhouette (z, y): a long bonnet falling to the nose, both wheel arches cut out.
function hullProfile() {
  const archStart = Math.asin((SILL - WHEEL_RADIUS) / ARCH_RADIUS)
  const shape = polygon([
    [-2.0, SILL],
    [-2.04, 0.86],
    [-1.94, DECK],
    [0.42, 0.98],
    [1.92, 0.8],
    [2.06, 0.66],
    [2.05, SILL + 0.06],
    [1.99, SILL],
  ])
  for (const axle of [AXLE_Z, -AXLE_Z]) shape.absarc(axle, WHEEL_RADIUS, ARCH_RADIUS, archStart, Math.PI - archStart, false)
  shape.closePath()
  return shape
}

// A low greenhouse, the windscreen raked well back.
const CABIN_PROFILE: Array<[number, number]> = [
  [0.44, 0.96],
  [-0.2, ROOF],
  [-0.95, ROOF + 0.01],
  [-1.46, 0.98],
]
const SCREEN = { bottom: [0.44, 0.96], top: [-0.2, ROOF] } as const // the windscreen's slope (z, y)

const SIDE_WINDOW: Array<[number, number]> = [
  [0.28, 1.04],
  [-0.18, 1.36],
  [-0.92, 1.37],
  [-1.28, 1.04],
]

// Riveted arch band bolted over each wheel.
function flareProfile() {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, ARCH_RADIUS + 0.12, 0.14, Math.PI - 0.14, false)
  shape.absarc(0, 0, ARCH_RADIUS + 0.02, Math.PI - 0.14, 0.14, true)
  shape.closePath()
  return shape
}

// The Scout's body; models.ts merges it and adds the turret and wheels.
export function buildScout({ livery = LIVERIES.hazard, seed = 1 }: VehicleOptions): ModelParts {
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
  add(new RoundedBoxGeometry(1.3, 0.5, 3.7, 2, 0.04), dark, [0, 0.68, 0])
  add(extrudeProfile(polygon(CABIN_PROFILE), CABIN_WIDTH, 0.04), paint)
  for (const [, x, z] of WHEELS) add(extrudeProfile(flareProfile(), 0.26, 0.02), paint, [Math.sign(x) * 0.9, WHEEL_RADIUS, z])

  // A plate over each door, mismatched; sill guards; the crest on each door.
  for (const side of [-1, 1]) {
    const skin = side * (BODY_WIDTH / 2 + 0.016)
    plate(paint, [0.03, 0.34, 0.92], [skin, 0.74, -0.42], [0, jitter(0.05), jitter(0.05)])
    plate(paint, [0.03, 0.24, 0.4], [skin, 0.8, 0.6], [0, jitter(0.06), jitter(0.06)])
    plate(rusty, [0.03, 0.12, 1.3], [side * (BODY_WIDTH / 2 + 0.02), 0.5, -0.1])
    add(new THREE.PlaneGeometry(0.4, 0.4), materials.emblem(), [side * (BODY_WIDTH / 2 + 0.034), 0.74, -0.42], [0, (side * Math.PI) / 2, 0])
  }

  // Bonnet: a scoop on its crown, pins at its nose.
  const bonnetPitch = Math.atan2(0.98 - 0.8, 1.92 - 0.42)
  plate(paint, [0.56, 0.12, 0.72], [0, 0.96, 1.0], [bonnetPitch, 0, 0])
  add(new THREE.BoxGeometry(0.44, 0.07, 0.02), dark, [0, 0.98, 1.37], [bonnetPitch, 0, 0])
  for (const x of [-0.55, 0.55]) add(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), steel, [x, 0.84, 1.78])

  // Glass behind bars: the windscreen's grid, meshed side windows.
  const [zb, yb] = SCREEN.bottom
  const [zt, yt] = SCREEN.top
  const slope = Math.hypot(zb - zt, yt - yb)
  const pitch = Math.atan2(-(zb - zt), yt - yb)
  const out = [(yt - yb) / slope, (zb - zt) / slope] // the windscreen's outward normal (z, y)
  const onScreen = (t: number, lift: number): Vec3 => [0, yb + t * (yt - yb) + lift * out[1], zb + t * (zt - zb) + lift * out[0]]
  add(new THREE.BoxGeometry(CABIN_WIDTH - 0.18, slope - 0.08, 0.012), materials.glass(), onScreen(0.5, 0.012), [pitch, 0, 0])
  const [, y0, z0] = onScreen(0.04, 0.04)
  const [, y1, z1] = onScreen(0.96, 0.04)
  for (const x of [-0.42, -0.14, 0.14, 0.42]) add(tube([x, y0, z0], [x, y1, z1], 0.014), steel)
  for (const side of [-1, 1]) {
    const x = side * (CABIN_WIDTH / 2 + 0.035)
    add(extrudeProfile(polygon(SIDE_WINDOW), 0.02, 0), materials.glass(), [side * (CABIN_WIDTH / 2), 0, 0])
    add(extrudeProfile(polygon(SIDE_WINDOW), 0.012, 0), materials.grate(), [x, 0, 0])
    add(
      bentTube(
        [...SIDE_WINDOW, SIDE_WINDOW[0]].map(([z, y]): Vec3 => [x, y, z]),
        0.02,
      ),
      steel,
    )
  }

  // The cage over the cabin, the collar round the turret ring.
  for (const side of [-1, 1]) {
    const x = side * 0.72
    add(
      bentTube(
        [
          [x, 0.98, 0.5],
          [x, ROOF + 0.05, -0.18],
          [x, ROOF + 0.06, -0.96],
          [x * 1.02, 1.0, -1.52],
        ],
        0.032,
      ),
      steel,
    )
    add(tube([x, ROOF + 0.05, -0.18], [x * 0.4, 1.0, 0.46], 0.026), steel)
  }
  for (const z of [-0.18, -0.96]) add(tube([-0.72, ROOF + 0.05, z], [0.72, ROOF + 0.05, z], 0.028), steel)
  add(new THREE.CylinderGeometry(0.38, 0.42, 0.06, 28), dark, [TURRET_AT[0], TURRET_AT[1] - 0.02, TURRET_AT[2]])

  // Nose: grille, headlights, a skid plate under a nerf bar with two rally lamps.
  add(new THREE.BoxGeometry(0.8, 0.16, 0.08), dark, [0, 0.58, 2.03])
  for (let i = 0; i < 6; i++) add(tube([-0.3 + i * 0.12, 0.51, 2.08], [-0.3 + i * 0.12, 0.65, 2.08], 0.012), steel)
  for (const side of [-1, 1]) {
    plate(dark, [0.26, 0.2, 0.12], [side * 0.6, 0.7, 2.0])
    bolt(buildLamp(0.085, '#ffd9a0', 2.5), [side * 0.6, 0.7, 2.02])
  }
  plate(rusty, [1.6, 0.06, 0.5], [0, 0.4, 2.0], [0.35, 0, 0])
  add(
    bentTube(
      [
        [-0.82, 0.46, 2.06],
        [-0.78, 0.66, 2.2],
        [-0.5, 0.74, 2.26],
        [0.5, 0.74, 2.26],
        [0.78, 0.66, 2.2],
        [0.82, 0.46, 2.06],
      ],
      0.036,
    ),
    steel,
  )
  for (const x of [-0.3, 0.3]) {
    add(new THREE.BoxGeometry(0.03, 0.08, 0.03), dark, [x, 0.8, 2.26])
    bolt(buildLamp(0.075, '#ffcf8f', 3.5), [x, 0.88, 2.24])
  }
  for (const side of [-1, 1]) add(spike(0.26, 0.04), steel, [side * 0.8, 0.6, 2.14], [1.2, 0, 0])

  // Tail: the wing on its uprights, the bumper, tail lights, twin pipes.
  for (const x of [-0.56, 0.56]) plate(dark, [0.05, 0.36, 0.16], [x, DECK + 0.16, -1.82], [-0.25, 0, 0])
  plate(paint, [1.68, 0.04, 0.38], [0, DECK + 0.35, -1.88], [-0.12, 0, 0])
  for (const side of [-1, 1]) plate(dark, [0.03, 0.18, 0.42], [side * 0.85, DECK + 0.32, -1.88])
  plate(rusty, [1.74, 0.16, 0.18], [0, 0.56, -2.06])
  for (const side of [-1, 1]) {
    for (const y of [0.86, 0.79]) add(new RoundedBoxGeometry(0.3, 0.045, 0.04, 2, 0.01), materials.light('#ff2410', 2.5), [side * 0.56, y, -2.03])
    add(tube([side * 0.36, 0.5, -1.9], [side * 0.36, 0.5, -2.22], 0.06, 14), rusty)
    add(tube([side * 0.36, 0.5, -2.2], [side * 0.36, 0.5, -2.24], 0.068, 14), steel)
  }

  // A side pipe under each door, in a perforated heat shield.
  for (const side of [-1, 1]) {
    const x = side * 0.92
    add(
      bentTube(
        [
          [side * 0.6, 0.56, 0.76],
          [x, 0.44, 0.6],
          [x, 0.44, -0.6],
        ],
        0.06,
        12,
      ),
      rusty,
    )
    add(tube([x, 0.44, 0.3], [x, 0.44, -0.4], 0.085, 16), materials.perforated())
  }

  // Spikes: raked back along the rear flares.
  for (const side of [-1, 1]) {
    const reach = ARCH_RADIUS + 0.12
    for (const angle of [1.8, 2.3]) {
      const position: Vec3 = [side * 0.9, WHEEL_RADIUS + Math.sin(angle) * reach, -AXLE_Z + Math.cos(angle) * reach]
      add(spike(0.26, 0.04), steel, position, [Math.PI / 2 - angle - 0.25, 0, 0])
    }
  }

  return { shell, turretAt: TURRET_AT, wheelWidth: WHEEL_WIDTH }
}
