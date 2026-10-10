import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { part, truss, tube, type Vec3 } from '../../../render/geometry.ts'
import { LIVERIES, materials } from '../../../render/materials/library.ts'
import { createRng } from '../../../shared/rng.ts'
import { tyreCarcass } from '../../parts.ts'
import { BEACON } from './buildings.ts'
import { solid } from './props.ts'

// Street furniture and set pieces for the city. Same conventions as props.ts:
// origin on the ground, long axis along x, front facing +Z.

export interface SignalLamps {
  red: THREE.Material
  amber: THREE.Material
  green: THREE.Material
}

// Three-lamp head, lenses facing -Z under little visors.
function signalHead(lamps: SignalLamps) {
  const head = new THREE.Group()
  const iron = materials.darkSteel()
  head.add(part(new THREE.BoxGeometry(0.36, 1.05, 0.26), iron))
  head.add(part(new THREE.BoxGeometry(0.62, 1.3, 0.03), iron, [0, 0, 0.14]))
  const lights: Array<[number, THREE.Material]> = [
    [0.33, lamps.red],
    [0, lamps.amber],
    [-0.33, lamps.green],
  ]
  for (const [y, lamp] of lights) {
    head.add(part(new THREE.CircleGeometry(0.11, 16), lamp, [0, y, -0.132], [0, Math.PI, 0]))
    head.add(part(new THREE.BoxGeometry(0.3, 0.02, 0.2), iron, [0, y + 0.13, -0.23]))
  }
  return head
}

// Mast-arm traffic signal: pole at the corner, the arm reaching `reach`
// metres along +x over the lanes, two heads facing -Z at the traffic.
export function trafficSignal(reach: number, lamps: SignalLamps) {
  const group = new THREE.Group()
  const iron = materials.darkSteel()
  group.add(part(tube([0, 0, 0], [0, 6.8, 0], 0.13, 10), iron))
  group.add(part(tube([0, 6.3, 0], [reach, 6.3, 0], 0.08, 8), iron))
  group.add(part(tube([0, 5.3, 0], [Math.min(reach * 0.4, 3), 6.3, 0], 0.045, 6), iron))
  for (const t of [0.5, 0.88]) {
    const head = signalHead(lamps)
    head.position.set(reach * t, 5.72, 0)
    group.add(head)
  }
  group.add(part(new THREE.BoxGeometry(0.34, 0.34, 0.22), iron, [0, 3, -0.2]))
  return solid(group, { cylinder: [0.2, 1.5], at: [0, 1.5, 0] })
}

// Bus stop: steel frame, glass back and side, a lit advert, a bench.
export function busShelter() {
  const group = new THREE.Group()
  const iron = materials.darkSteel()
  for (const x of [-1.9, 1.9]) {
    for (const z of [-0.7, 0.7]) group.add(part(tube([x, 0, z], [x, 2.5, z], 0.05, 8), iron))
  }
  group.add(part(new THREE.BoxGeometry(4.2, 0.1, 1.8), materials.steel(), [0, 2.55, 0]))
  group.add(part(new THREE.BoxGeometry(3.8, 1.9, 0.02), materials.glass(), [0, 1.35, -0.7]))
  group.add(part(new THREE.BoxGeometry(0.02, 1.9, 1.3), materials.glass(), [1.9, 1.35, 0]))
  group.add(part(new THREE.BoxGeometry(0.14, 1.8, 1.25), materials.billboard(1), [-1.9, 1.35, 0]))
  group.add(part(new THREE.BoxGeometry(2.4, 0.06, 0.42), materials.steel(), [0.2, 0.46, -0.42]))
  return solid(group, { box: [2.1, 1.3, 0.9], at: [0, 1.3, 0] })
}

// Wheeled steel dumpster with its lid propped open.
export function dumpster(paint: string) {
  const group = new THREE.Group()
  group.add(part(new THREE.BoxGeometry(1.9, 1.05, 1.15), materials.corrugated(paint), [0, 0.68, 0]))
  group.add(part(new THREE.BoxGeometry(1.96, 0.06, 1.2), materials.darkSteel(), [0, 1.26, -0.1], [-0.35, 0, 0]))
  for (const x of [-0.95, 0.95]) group.add(part(new THREE.BoxGeometry(0.08, 0.14, 1.24), materials.darkSteel(), [x, 0.95, 0]))
  for (const x of [-0.75, 0.75]) {
    for (const z of [-0.45, 0.45]) group.add(part(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10), materials.rubber(), [x, 0.08, z], [0, 0, Math.PI / 2]))
  }
  return solid(group, { box: [0.98, 0.65, 0.6], at: [0, 0.65, 0] })
}

// City bus, long axis along x, nose to +x. A burnt one is charred to the
// frame, its windows empty.
export function bus(burnt: boolean, paint = '#a8741e') {
  const group = new THREE.Group()
  group.add(part(new RoundedBoxGeometry(11, 2.45, 2.5, 3, 0.18), burnt ? materials.charred() : materials.bodywork(paint), [0, 1.8, 0]))
  const pane = burnt ? materials.darkSteel() : materials.glass()
  for (const z of [-1, 1]) group.add(part(new THREE.BoxGeometry(9.2, 0.95, 0.02), pane, [-0.3, 2.35, z * 1.255]))
  group.add(part(new THREE.BoxGeometry(0.02, 1.3, 2.2), pane, [5.505, 2.2, 0]))
  group.add(part(new THREE.BoxGeometry(0.3, 0.35, 2.3), materials.darkSteel(), [5.55, 0.75, 0]))
  group.add(part(new THREE.BoxGeometry(0.3, 0.35, 2.3), materials.darkSteel(), [-5.55, 0.75, 0]))
  group.add(part(new THREE.BoxGeometry(2.6, 0.35, 1.6), materials.steel(), [-1.5, 3.15, 0]))
  const tyre = tyreCarcass(0.52, 0.34, 16).rotateY(Math.PI / 2)
  for (const x of [-3.6, 3.4]) {
    for (const z of [-1.05, 1.05]) group.add(part(tyre.clone(), materials.rubber(), [x, 0.52, z]))
  }
  return solid(group, { box: [5.5, 1.5, 1.25], at: [0, 1.55, 0] })
}

// A tube along the points, tapering from radius r0 to r1.
function limb(points: Vec3[], r0: number, r1: number, radial = 5) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)))
  const segments = points.length * 3
  const geometry = new THREE.TubeGeometry(curve, segments, 1, radial, false)
  const position = geometry.getAttribute('position')
  const centre = new THREE.Vector3()
  const vertex = new THREE.Vector3()
  for (let i = 0; i <= segments; i++) {
    curve.getPointAt(i / segments, centre)
    const radius = r0 + ((r1 - r0) * i) / segments
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j
      vertex.fromBufferAttribute(position, k).sub(centre).multiplyScalar(radius).add(centre)
      position.setXYZ(k, vertex.x, vertex.y, vertex.z)
    }
  }
  return geometry
}

// Dead street tree: a leaning trunk forking into four limbs and their twigs.
export function tree(seed: number, height = 7, isSolid = true) {
  const rng = createRng(seed)
  const group = new THREE.Group()
  const bark = materials.bark()
  const lean: Vec3 = [(rng() - 0.5) * 0.6, height * 0.45, (rng() - 0.5) * 0.6]
  group.add(part(limb([[0, 0, 0], [lean[0] * 0.3, height * 0.2, lean[2] * 0.3], lean], height * 0.032, height * 0.02), bark))
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + rng()
    const spread = height * (0.17 + rng() * 0.2)
    const rise = height * (0.3 + rng() * 0.22)
    const mid: Vec3 = [lean[0] + Math.cos(angle) * spread * 0.5, lean[1] + rise * 0.55, lean[2] + Math.sin(angle) * spread * 0.5]
    const end: Vec3 = [lean[0] + Math.cos(angle) * spread, lean[1] + rise, lean[2] + Math.sin(angle) * spread]
    group.add(part(limb([lean, mid, end], height * 0.016, height * 0.004), bark))
    for (let j = 0; j < 2; j++) {
      const fork = angle + (rng() - 0.5) * 1.8
      const twig: Vec3 = [mid[0] + Math.cos(fork) * height * 0.17, mid[1] + height * (0.1 + rng() * 0.15), mid[2] + Math.sin(fork) * height * 0.17]
      group.add(part(limb([mid, twig], height * 0.007, height * 0.002, 4), bark))
    }
  }
  return isSolid ? solid(group, { cylinder: [0.25, 1.5], at: [0, 1.5, 0] }) : group
}

export function bench() {
  const group = new THREE.Group()
  const slat = materials.corrugated('#5b4632')
  for (const x of [-0.8, 0.8]) group.add(part(new THREE.BoxGeometry(0.06, 0.45, 0.5), materials.darkSteel(), [x, 0.225, 0]))
  for (const z of [-0.15, 0, 0.15]) group.add(part(new THREE.BoxGeometry(1.9, 0.04, 0.12), slat, [0, 0.46, z]))
  for (const y of [0.66, 0.82]) group.add(part(new THREE.BoxGeometry(1.9, 0.1, 0.03), slat, [0, y, -0.26], [-0.2, 0, 0]))
  return solid(group, { box: [0.95, 0.4, 0.28], at: [0, 0.4, 0] })
}

export function hydrant() {
  const group = new THREE.Group()
  const paint = materials.paint(LIVERIES.crimson)
  group.add(part(new THREE.CylinderGeometry(0.14, 0.17, 0.62, 12), paint, [0, 0.31, 0]))
  group.add(part(new THREE.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), paint, [0, 0.6, 0]))
  group.add(part(tube([-0.24, 0.42, 0], [0.24, 0.42, 0], 0.06, 8), paint))
  return solid(group, { cylinder: [0.18, 0.4], at: [0, 0.4, 0] })
}

// Concrete planter with a dead shrub: sidewalk cover.
export function planter(size: number, seed: number) {
  const group = new THREE.Group()
  group.add(part(new THREE.BoxGeometry(size, 0.75, size), materials.concrete(), [0, 0.375, 0]))
  group.add(part(new THREE.BoxGeometry(size - 0.2, 0.02, size - 0.2), materials.mud(), [0, 0.74, 0]))
  const shrub = tree(seed, 2.4, false)
  shrub.position.y = 0.75
  group.add(shrub)
  return solid(group, { box: [size / 2, 0.4, size / 2], at: [0, 0.4, 0] })
}

// Roadside billboard on one steel pole, lit from its catwalk.
export function billboard(variant: number, height = 9) {
  const group = new THREE.Group()
  const steel = materials.rustySteel()
  group.add(part(tube([0, 0, 0], [0, height + 1, 0], 0.35, 14), steel))
  group.add(part(truss([-5.6, height + 0.4, -0.5], [5.6, height + 0.4, -0.5], 0.5, 8, 0.06, 0.03), steel))
  group.add(part(new THREE.BoxGeometry(12, 6, 0.3), materials.darkSteel(), [0, height + 3.4, 0]))
  group.add(part(new THREE.PlaneGeometry(11.6, 5.6), materials.billboard(variant), [0, height + 3.4, 0.16]))
  group.add(part(new THREE.BoxGeometry(12, 0.05, 1), materials.grate(), [0, height + 0.3, 0.7]))
  for (const x of [-4, 0, 4]) {
    group.add(part(tube([x, height + 0.3, 0.7], [x, height + 0.3, 1.3], 0.03, 5), steel))
    group.add(part(new THREE.BoxGeometry(0.45, 0.2, 0.25), materials.light('#fff0d0', 5), [x, height + 0.4, 1.35], [0.6, 0, 0]))
  }
  return solid(group, { cylinder: [0.45, 2], at: [0, 2, 0] })
}

// Petrol station canopy on four columns, lit underneath. Only the columns are solid.
export function canopy(width: number, depth: number, height = 5.2) {
  const group = new THREE.Group()
  group.add(part(new THREE.BoxGeometry(width, 0.9, depth), materials.steel(), [0, height + 0.45, 0]))
  group.add(part(new THREE.BoxGeometry(width + 0.06, 0.28, depth + 0.06), materials.light('#d8342a', 2.5), [0, height + 0.62, 0]))
  for (let i = 0; i < 6; i++) {
    group.add(
      part(new THREE.BoxGeometry(1.4, 0.05, 0.7), materials.light('#fff3df', 7), [
        ((i % 3) - 1) * (width / 3.2),
        height - 0.03,
        (Math.floor(i / 3) - 0.5) * (depth / 2),
      ]),
    )
  }
  for (const x of [-width / 3, width / 3]) {
    for (const z of [-depth / 4, depth / 4]) group.add(solid(part(new THREE.BoxGeometry(0.5, height, 0.5), materials.concrete(), [x, height / 2, z])))
  }
  return group
}

// Fuel pump on its island, a lit price screen facing +Z.
export function pump() {
  const group = new THREE.Group()
  group.add(part(new THREE.BoxGeometry(3, 0.18, 1.2), materials.concrete(), [0, 0.09, 0]))
  for (const x of [-0.8, 0.8]) {
    group.add(part(new RoundedBoxGeometry(0.62, 1.8, 0.9, 2, 0.05), materials.paint(LIVERIES.crimson), [x, 1.08, 0]))
    group.add(part(new THREE.PlaneGeometry(0.4, 0.25), materials.light('#9ff2c0', 2), [x, 1.5, 0.455]))
  }
  return solid(group, { box: [1.5, 1, 0.6], at: [0, 1, 0] })
}

// Tower crane: lattice mast, jib and counter-jib with its weights, a cab.
// `hook` (block and cable, in crane space at `trolley`) is left out so it can sway.
export function towerCrane(height = 38, jib = 34) {
  const structure = new THREE.Group()
  const yellow = materials.paint(LIVERIES.hazard)
  const top = height + 2
  structure.add(part(new THREE.BoxGeometry(5, 1, 5), materials.concrete(), [0, 0.5, 0]))
  structure.add(part(truss([0, 1, 0], [0, height, 0], 1.8, Math.round(height / 3), 0.09, 0.04), yellow))
  structure.add(part(new THREE.BoxGeometry(2.4, 1.2, 2.4), materials.steel(), [0, height + 0.6, 0]))
  structure.add(part(new THREE.BoxGeometry(1.8, 1.8, 1.8), yellow, [1.8, height + 1.3, 1.4]))
  structure.add(part(new THREE.BoxGeometry(0.05, 1.1, 1.4), materials.glass(), [2.71, height + 1.5, 1.4]))
  structure.add(part(truss([0, top, 0], [jib, top, 0], 1.2, Math.round(jib / 2.4), 0.07, 0.035), yellow))
  structure.add(part(truss([0, top, 0], [-12, top, 0], 1.2, 5, 0.07, 0.035), yellow))
  structure.add(part(truss([0, height + 1.2, 0], [0, top + 7, 0], 1, 3, 0.07, 0.035), yellow))
  for (const end of [jib * 0.72, -11.5]) structure.add(part(tube([0, top + 7, 0], [end, top + 0.6, 0], 0.04, 4), materials.darkSteel()))
  for (const x of [-9.5, -11]) structure.add(part(new THREE.BoxGeometry(1.2, 2.2, 2), materials.concrete(), [x, top - 1.4, 0]))
  structure.add(part(new THREE.SphereGeometry(0.3, 12, 8), BEACON, [0, top + 7.4, 0]))
  const trolley: Vec3 = [jib * 0.62, top - 0.7, 0]
  structure.add(part(new THREE.BoxGeometry(1.4, 0.5, 1.4), materials.darkSteel(), trolley))

  const drop = 20
  const hook = new THREE.Group()
  for (const z of [-0.3, 0.3]) hook.add(part(tube([0, 0, z], [0, -drop, z], 0.03, 4), materials.darkSteel()))
  hook.add(part(new THREE.BoxGeometry(0.9, 1.2, 0.9), yellow, [0, -drop - 0.6, 0]))
  hook.add(part(new THREE.TorusGeometry(0.35, 0.09, 6, 12, Math.PI * 1.4), materials.darkSteel(), [0, -drop - 1.6, 0]))
  return { structure: solid(structure, { box: [2.5, 1.5, 2.5], at: [0, 1.5, 0] }), hook, trolley }
}

// Unfinished concrete frame: columns on a 6 m grid, slabs you can drive
// under, rebar bristling from the top, the last slab half poured.
export function concreteFrame(width: number, depth: number, floors: number, storey = 4.2) {
  const group = new THREE.Group()
  const concrete = materials.concrete()
  const cols = Math.max(2, Math.round(width / 6) + 1)
  const rows = Math.max(2, Math.round(depth / 6) + 1)
  for (let f = 0; f < floors; f++) {
    const y = f * storey
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = -width / 2 + (width * i) / (cols - 1)
        const z = -depth / 2 + (depth * j) / (rows - 1)
        group.add(solid(part(new THREE.BoxGeometry(0.55, storey - 0.3, 0.55), concrete, [x, y + (storey - 0.3) / 2, z])))
        if (f === floors - 1) {
          for (const [dx, dz] of [
            [0.18, 0.18],
            [-0.18, 0.18],
            [0.18, -0.18],
            [-0.18, -0.18],
          ]) {
            group.add(part(tube([x + dx, y + storey - 0.3, z + dz], [x + dx * 1.6, y + storey + 1.1, z + dz * 1.6], 0.018, 4), materials.rustySteel()))
          }
        }
      }
    }
    if (f < floors - 1) group.add(solid(part(new THREE.BoxGeometry(width + 0.8, 0.3, depth + 0.8), concrete, [0, y + storey - 0.15, 0])))
    else group.add(solid(part(new THREE.BoxGeometry(width * 0.55, 0.3, depth + 0.8), concrete, [-width * 0.225, y + storey - 0.15, 0])))
  }
  return group
}

// Site hoarding: painted plywood panels on posts.
export function hoarding(length: number, paint = '#2f4a3a') {
  const group = new THREE.Group()
  group.add(part(new THREE.BoxGeometry(length, 2.4, 0.08), materials.corrugated(paint), [0, 1.2, 0]))
  for (let x = -length / 2; x <= length / 2 + 0.01; x += 2.4) group.add(part(new THREE.BoxGeometry(0.1, 2.5, 0.12), materials.darkSteel(), [x, 1.25, -0.1]))
  return solid(group, { box: [length / 2, 1.2, 0.1], at: [0, 1.2, 0] })
}

// Ground decals, laid flat just above the asphalt.
export const decal = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, z: number, yaw = 0, y = 0.012) =>
  part(geometry.rotateX(-Math.PI / 2), material, [x, y, z], [0, yaw, 0])
