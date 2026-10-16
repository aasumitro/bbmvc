import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { bentTube, extrudeProfile, part, tube, type Vec3 } from '../../../render/geometry.ts'
import { LIVERIES, materials } from '../../../render/materials/library.ts'
import { createRng } from '../../../shared/rng.ts'
import { buildLamp, buildWheel, spike } from '../../parts.ts'
import type { ModelParts, VehicleOptions } from '../types.ts'
import { VEHICLES } from '../vehicles.ts'

// Dune buggy layout (the Buggy): a narrow tub on long-travel arms, big
// wheels standing out on them, the seats in an open tube cage with the
// turret on its roof, the engine bare at the back. Metres; +Z forward, +Y
// up, so the driver's left is +X. Wheel size and placement come from the
// Buggy's chassis, which the physics builds too.
const { wheelRadius: WHEEL_RADIUS, wheels: WHEELS } = VEHICLES.buggy.chassis
const WHEEL_WIDTH = 0.44
const TUB_WIDTH = 1.0
const FLOOR = 0.6 // the tub's underside: long arms, a high belly
const RAIL = 1.02 // the tub's top edge, where the cage stands
const ROOF = 1.86 // the cage's top, the turret ring on its plate
const HOOPS = [0.62, -0.74] // the front and main hoops' z
const TURRET_AT: Vec3 = [0, ROOF + 0.04, -0.2]

const polygon = (points: Array<[z: number, y: number]>) => new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)))

// The tub's side silhouette (z, y): a short cowl falling to the nose, a flat deck over the engine.
const TUB_PROFILE: Array<[number, number]> = [
  [-1.62, FLOOR],
  [-1.66, 0.96],
  [-1.5, RAIL],
  [0.86, RAIL],
  [1.86, 0.84],
  [2.0, 0.7],
  [1.94, FLOOR],
]

// The Buggy's body; models.ts merges it and adds the turret and wheels.
export function buildBuggy({ livery = LIVERIES.hazard, seed = 1 }: VehicleOptions): ModelParts {
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
  const bolt = (object: THREE.Object3D, position: Vec3, rotation: Vec3 = [0, 0, 0]) => {
    object.position.set(...position)
    object.rotation.set(rotation[0], rotation[1], rotation[2], 'YXZ')
    shell.add(object)
  }

  // The tub, a skid pan under it, panels on its flanks with the crest.
  add(extrudeProfile(polygon(TUB_PROFILE), TUB_WIDTH, 0.035), paint)
  plate(rusty, [0.86, 0.05, 3.2], [0, FLOOR - 0.02, 0.1])
  for (const side of [-1, 1]) {
    const skin = side * (TUB_WIDTH / 2 + 0.016)
    plate(paint, [0.03, 0.26, 0.9], [skin, 0.8, 1.15], [0, jitter(0.06), jitter(0.06)])
    plate(paint, [0.03, 0.24, 0.7], [skin, 0.8, -1.1], [0, jitter(0.06), jitter(0.06)])
    add(new THREE.PlaneGeometry(0.34, 0.34), materials.emblem(), [side * (TUB_WIDTH / 2 + 0.034), 0.8, 0.1], [0, (side * Math.PI) / 2, 0])
  }

  // The cowl: a vented panel over the nose, a mesh screen in the front hoop.
  const cowlPitch = Math.atan2(RAIL - 0.84, 1.86 - 0.86)
  plate(paint, [0.86, 0.04, 1.0], [0, RAIL - 0.04, 1.36], [cowlPitch, 0, 0])
  for (const x of [-0.2, 0, 0.2]) add(new THREE.BoxGeometry(0.14, 0.02, 0.5), dark, [x, RAIL - 0.01, 1.3], [cowlPitch, 0, 0])
  add(new THREE.BoxGeometry(0.9, 0.56, 0.01), materials.grate(), [0, RAIL + 0.36, HOOPS[0] - 0.02], [-0.32, 0, 0])

  // Seats and the wheel, seen through the open cage.
  for (const x of [-0.24, 0.24]) {
    plate(dark, [0.36, 0.1, 0.46], [x, RAIL - 0.08, -0.12])
    plate(dark, [0.36, 0.62, 0.1], [x, RAIL + 0.22, -0.4], [-0.18, 0, 0])
  }
  add(new THREE.TorusGeometry(0.15, 0.025, 6, 16), dark, [0.24, RAIL + 0.3, 0.3], [-0.9, 0, 0])

  // The cage: the front and main hoops, rails along the roof, braces, struts back over the engine; the turret's plate.
  for (const z of HOOPS) {
    const lean = z > 0 ? -0.3 : 0.1
    add(
      bentTube(
        [
          [0.5, RAIL, z],
          [0.48, ROOF - 0.12, z + lean],
          [0.42, ROOF, z + lean],
          [-0.42, ROOF, z + lean],
          [-0.48, ROOF - 0.12, z + lean],
          [-0.5, RAIL, z],
        ],
        0.038,
      ),
      steel,
    )
  }
  for (const x of [-0.42, 0.42]) {
    add(tube([x, ROOF, HOOPS[0] - 0.3], [x, ROOF, HOOPS[1] + 0.1], 0.034), steel)
    add(tube([x * 1.1, ROOF - 0.08, HOOPS[1] + 0.06], [x * 1.1, 1.04, -1.52], 0.032), steel)
  }
  add(tube([0.48, ROOF - 0.1, HOOPS[1] + 0.1], [-0.5, RAIL + 0.04, HOOPS[1]], 0.026), steel)
  add(tube([-0.47, 1.05, -1.5], [0.47, 1.05, -1.5], 0.03), steel)
  plate(dark, [0.84, 0.04, 0.9], [0, ROOF + 0.01, -0.2])
  add(new THREE.CylinderGeometry(0.36, 0.4, 0.05, 28), dark, [TURRET_AT[0], TURRET_AT[1] - 0.02, TURRET_AT[2]])

  // Lamps: a bar of four on the front hoop's top, two in the nose.
  add(tube([-0.5, ROOF + 0.06, HOOPS[0] - 0.36], [0.5, ROOF + 0.06, HOOPS[0] - 0.36], 0.024), steel)
  for (const x of [-0.36, -0.12, 0.12, 0.36]) {
    bolt(buildLamp(0.07, '#ffcf8f', 3.5), [x, ROOF + 0.13, HOOPS[0] - 0.4])
    add(new THREE.BoxGeometry(0.03, 0.08, 0.03), dark, [x, ROOF + 0.08, HOOPS[0] - 0.36])
  }
  for (const side of [-1, 1]) bolt(buildLamp(0.08, '#ffd9a0', 2.5), [side * 0.3, 0.76, 1.95])

  // The nose bar: a hoop round the cowl's tip, spikes on it.
  add(
    bentTube(
      [
        [-0.56, 0.66, 1.9],
        [-0.5, 0.9, 2.12],
        [-0.3, 0.96, 2.18],
        [0.3, 0.96, 2.18],
        [0.5, 0.9, 2.12],
        [0.56, 0.66, 1.9],
      ],
      0.04,
    ),
    steel,
  )
  for (const x of [-0.42, 0.42]) add(spike(0.24, 0.04), steel, [x, 0.94, 2.16], [1.2, 0, 0])

  // The engine bare at the back: block, air filter, a grate between it and the seats, headers into two pipes; tail lights, the spare.
  plate(dark, [0.58, 0.4, 0.62], [0, RAIL + 0.16, -1.15])
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.16, 18), steel, [0, RAIL + 0.44, -1.1])
  plate(materials.grate(), [0.6, 0.36, 0.05], [0, RAIL + 0.12, -0.78])
  for (const side of [-1, 1]) {
    add(
      bentTube(
        [
          [side * 0.3, RAIL + 0.12, -1.2],
          [side * 0.42, RAIL + 0.06, -1.36],
          [side * 0.42, RAIL + 0.3, -1.58],
          [side * 0.38, RAIL + 0.56, -1.7],
        ],
        0.05,
        12,
      ),
      rusty,
    )
    add(new THREE.CylinderGeometry(0.065, 0.055, 0.05, 12), dark, [side * 0.38, RAIL + 0.6, -1.71])
    add(new RoundedBoxGeometry(0.2, 0.06, 0.04, 2, 0.01), materials.light('#ff2410', 2.5), [side * 0.42, 0.84, -1.68])
  }
  const spare = buildWheel(0.4, 0.3)
  bolt(spare, [0, RAIL + 0.1, -1.86], [0, Math.PI / 2, 0])

  // Long-travel arms to each hub: a wishbone from the tub, and a coilover up to the cage.
  for (const [, x, z] of WHEELS) {
    const side = Math.sign(x)
    const hub: Vec3 = [x - side * 0.2, WHEEL_RADIUS, z]
    for (const dz of [-0.22, 0.22]) {
      add(tube([side * (TUB_WIDTH / 2 - 0.04), FLOOR + 0.06, z + dz], hub, 0.03), steel)
      add(tube([side * (TUB_WIDTH / 2 - 0.04), FLOOR + 0.3, z + dz], [hub[0], WHEEL_RADIUS + 0.22, z], 0.026), steel)
    }
    const top: Vec3 = [side * (TUB_WIDTH / 2 - 0.02), RAIL + 0.1, z]
    add(tube([hub[0], WHEEL_RADIUS + 0.12, z], top, 0.045, 12), dark)
    add(
      tube(lerp([hub[0], WHEEL_RADIUS + 0.12, z], top, 0.25), lerp([hub[0], WHEEL_RADIUS + 0.12, z], top, 0.7), 0.075, 14),
      materials.bodywork(LIVERIES.crimson.paint),
    )
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.18, 14), dark, hub, [0, 0, Math.PI / 2])
  }

  return { shell, turretAt: TURRET_AT, wheelWidth: WHEEL_WIDTH }
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
