import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { boxUV, part, scatter, transform, truss, tube, type Vec3 } from '../../../render/geometry.ts'
import { LIVERIES, materials } from '../../../render/materials/library.ts'
import { buildLamp } from '../../parts.ts'
import { BEACON } from './buildings.ts'
import { solid } from './props.ts'

// Port machinery and set pieces for the docks. Same conventions as props.ts:
// origin on the ground at the footprint centre, long axis along x, front
// facing +Z; on the quay, +Z is toward the water.

export const CONTAINER = { width: 2.44, height: 2.59, short: 6.06, long: 12.19 } // ISO boxes, metres

// Body and frame of a box `length` long, in two geometries: the body takes a
// tint per copy, the frame stays steel. Metre uvs, as merged props get.
function containerGeometry(length: number, framed: boolean) {
  const { width, height } = CONTAINER
  const body = boxUV(new THREE.BoxGeometry(length - 0.12, height - 0.16, width - 0.08).translate(0, height / 2, 0))
  if (!framed) return { body, frame: undefined }
  const bars: THREE.BufferGeometry[] = []
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => bars.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z))
  for (const x of [-1, 1]) for (const z of [-1, 1]) bar(0.16, height, 0.16, x * (length / 2 - 0.08), height / 2, z * (width / 2 - 0.08))
  for (const y of [0.08, height - 0.08]) {
    for (const z of [-1, 1]) bar(length, 0.16, 0.12, 0, y, z * (width / 2 - 0.06))
    for (const x of [-1, 1]) bar(0.12, 0.16, width, x * (length / 2 - 0.06), y, 0)
  }
  for (const z of [-0.95, -0.35, 0.35, 0.95]) bar(0.05, height - 0.4, 0.05, length / 2 + 0.03, height / 2, z) // door bars on +x
  return { body, frame: boxUV(mergeGeometries(bars.map((geometry) => geometry.toNonIndexed()))) }
}

// Shipping containers by the hundred, gathered while laying out and built at
// the end: one draw call per size for the bodies (each its own paint) and one
// for the frames. Solid shapes are the caller's: a stack is one box.
export function containerKit(castShadow: boolean, framed = true) {
  const sizes = [CONTAINER.short, CONTAINER.long].map((length) => ({ length, matrices: [] as THREE.Matrix4[], tints: [] as THREE.Color[] }))
  return {
    // One box, its centre on the ground at (x, z) raised `y`, its length along `yaw`'s x axis.
    add(x: number, y: number, z: number, yaw: number, long: boolean, paint: string, tilt: Vec3 = [0, 0, 0]) {
      const size = sizes[long ? 1 : 0]
      size.matrices.push(transform([x, y, z], [tilt[0], yaw + tilt[1], tilt[2]]))
      size.tints.push(new THREE.Color(paint))
    },
    build() {
      const meshes: THREE.InstancedMesh[] = []
      for (const { length, matrices, tints } of sizes) {
        if (!matrices.length) continue
        const { body, frame } = containerGeometry(length, framed)
        meshes.push(scatter(body, materials.corrugated('#d8d2c8', 0.2), matrices, tints)) // light rust: the tint darkens it too, and heavy patches read as camouflage
        if (frame) meshes.push(scatter(frame, materials.rustySteel(), matrices))
      }
      meshes.forEach((mesh) => {
        mesh.castShadow = castShadow
        mesh.receiveShadow = castShadow
      })
      return meshes
    },
  }
}

// Ship-to-shore gantry crane, its rails along x: four legs on bogies (x ±9,
// z ±13), open below 8 m so cars drive through it either way, bracing and a
// portal frame above; the boom runs out over the water along +Z with the
// machinery house on its back reach, under an A-frame with its stays.
// `spreader` hangs from the trolley (`trolley`, in crane space) and is meant
// to sway; `load` puts a box on it.
export function stsCrane(paint = LIVERIES.crimson.paint, load?: string) {
  const structure = new THREE.Group()
  const steel = materials.bodywork(paint)
  const dark = materials.darkSteel()
  const top = 30 // the portal frame
  const boom = 34.5 // the boom girders' centre line
  const legs: Array<[number, number]> = [
    [-9, -13],
    [9, -13],
    [-9, 13],
    [9, 13],
  ]
  for (const [x, z] of legs) {
    structure.add(part(new THREE.BoxGeometry(3.6, 1.1, 1.6), dark, [x, 0.55, z]))
    structure.add(part(new THREE.BoxGeometry(1.3, top - 1.1, 1.3), steel, [x, 1.1 + (top - 1.1) / 2, z]))
  }
  // the portal: girders round the top, ties at 8 m and X bracing above them on the rail sides
  for (const z of [-13, 13]) {
    structure.add(part(new THREE.BoxGeometry(19.3, 1.8, 1.6), steel, [0, top, z]))
    structure.add(part(new THREE.BoxGeometry(17.4, 0.9, 0.9), steel, [0, 8, z]))
    structure.add(part(tube([-8.5, 8.5, z], [8.5, top - 1, z], 0.28, 8), steel))
    structure.add(part(tube([8.5, 8.5, z], [-8.5, top - 1, z], 0.28, 8), steel))
  }
  for (const x of [-9, 9]) structure.add(part(new THREE.BoxGeometry(1.6, 1.8, 27.6), steel, [x, top, 0]))
  // the boom, from the back reach to the tip over the water, on posts off the portal
  const [back, tip] = [-27, 58]
  for (const x of [-2.7, 2.7]) {
    structure.add(part(new THREE.BoxGeometry(1.2, 2.6, tip - back), steel, [x, boom, (back + tip) / 2]))
    for (const z of [-13, 13]) structure.add(part(new THREE.BoxGeometry(1, boom - top - 1.6, 1), steel, [x, (top + boom) / 2 - 0.4, z]))
  }
  for (let z = back + 2; z < tip; z += 8) structure.add(part(new THREE.BoxGeometry(5.4, 0.5, 0.6), steel, [0, boom - 1.05, z]))
  structure.add(part(truss([0, boom - 2.8, 14], [0, boom - 2.8, tip - 1], 2.4, 11, 0.07, 0.04), dark))
  // A-frame over the landside legs, stays to both ends
  const apex: Vec3 = [0, 58, -7]
  for (const x of [-1, 1]) {
    structure.add(part(tube([x * 7.5, top + 1, -13], [x * 3, apex[1], apex[2]], 0.55, 8), steel))
    structure.add(part(tube([x * 7.5, top + 1, 13], [x * 3, apex[1], apex[2]], 0.55, 8), steel))
    structure.add(part(tube([x * 3, apex[1], apex[2]], [x * 2.7, boom + 1.2, tip - 1], 0.22, 6), dark))
    structure.add(part(tube([x * 3, apex[1], apex[2]], [x * 2.7, boom + 1.2, back + 1], 0.22, 6), dark))
  }
  structure.add(part(new THREE.BoxGeometry(7.6, 1.4, 1.4), steel, [0, apex[1], apex[2]]))
  structure.add(part(new THREE.SphereGeometry(0.4, 12, 8), BEACON, [0, apex[1] + 1, apex[2]]))
  structure.add(part(new THREE.SphereGeometry(0.35, 12, 8), BEACON, [0, boom + 1.6, tip - 0.5]))
  // machinery house on the back reach, the operator's cab under the boom, floodlights along it
  structure.add(part(new THREE.BoxGeometry(8.4, 5, 11), materials.corrugated('#c9c3b5', 0.3), [0, boom + 3.8, back + 7]))
  structure.add(part(new THREE.BoxGeometry(3, 2.6, 3.4), materials.corrugated('#c9c3b5', 0.3), [3.6, boom - 3.2, 20]))
  structure.add(part(new THREE.BoxGeometry(2.6, 1.6, 0.06), materials.glass(), [3.6, boom - 3, 21.74]))
  for (const z of [-20, -4, 12, 28, 44]) structure.add(part(new THREE.BoxGeometry(1.6, 0.25, 0.9), materials.light('#ffe4b8', 6), [0, boom - 1.45, z]))

  const trolley: Vec3 = [0, boom - 1.6, 4]
  structure.add(part(new THREE.BoxGeometry(6, 1.6, 6.5), dark, trolley))
  const drop = 21
  const spreader = new THREE.Group()
  for (const x of [-2.4, 2.4]) for (const z of [-0.8, 0.8]) spreader.add(part(tube([x, 0, z], [x * 1.3, -drop, z], 0.035, 4), dark))
  spreader.add(part(new THREE.BoxGeometry(12.2, 0.55, 2.5), materials.bodywork(LIVERIES.hazard.paint), [0, -drop - 0.3, 0]))
  if (load)
    spreader.add(
      part(boxUV(new THREE.BoxGeometry(CONTAINER.long - 0.1, CONTAINER.height, CONTAINER.width)), materials.corrugated(load, 0.2), [
        0,
        -drop - 0.6 - CONTAINER.height / 2,
        0,
      ]),
    )
  return {
    structure: solid(structure, ...legs.map(([x, z]) => ({ box: [1.8, top / 2, 0.8] as Vec3, at: [x, top / 2, z] as Vec3 }))),
    spreader,
    trolley,
  }
}

// Straddle carrier, its long axis along x: four legs on wheels, the top
// frame with its cab, and the box it carries hanging between the legs.
export function straddleCarrier(load: string, paint = LIVERIES.hazard.paint) {
  const group = new THREE.Group()
  const steel = materials.bodywork(paint)
  const [half, wide, height] = [4.6, 2.3, 12] // legs at x ±half, z ±wide
  for (const x of [-half, half]) {
    for (const z of [-wide, wide]) {
      group.add(part(new THREE.CylinderGeometry(0.75, 0.75, 0.7, 16), materials.rubber(), [x, 0.75, z], [Math.PI / 2, 0, 0]))
      group.add(part(new THREE.BoxGeometry(0.7, height - 1.2, 0.7), steel, [x, 0.75 + (height - 1.2) / 2, z]))
    }
    group.add(part(new THREE.BoxGeometry(0.9, 1.3, 2 * wide + 1.6), steel, [x, 1.1, 0]))
  }
  for (const z of [-wide, wide]) group.add(part(new THREE.BoxGeometry(2 * half + 0.8, 1.1, 0.8), steel, [0, height, z]))
  group.add(part(new THREE.BoxGeometry(2.2, 2.2, 2), materials.corrugated('#c9c3b5', 0.3), [half - 0.6, height + 1.6, -wide + 0.4]))
  group.add(part(new THREE.BoxGeometry(0.06, 1.2, 1.6), materials.glass(), [half + 0.52, height + 1.8, -wide + 0.4]))
  group.add(part(new THREE.BoxGeometry(CONTAINER.long - 0.2, 0.4, CONTAINER.width + 0.2), materials.darkSteel(), [0, height - 1.5, 0]))
  group.add(
    part(boxUV(new THREE.BoxGeometry(CONTAINER.long - 0.12, CONTAINER.height, CONTAINER.width - 0.08)), materials.corrugated(load, 0.2), [
      0,
      1.8 + CONTAINER.height / 2,
      0,
    ]),
  )
  for (const x of [-4, 4])
    for (const z of [-0.9, 0.9]) group.add(part(tube([x, height - 1.7, z], [x, 1.8 + CONTAINER.height, z], 0.04, 4), materials.darkSteel()))
  group.add(part(new THREE.SphereGeometry(0.22, 10, 6), materials.light('#ffb030', 8), [0, height + 0.8, 0]))
  return solid(group, ...[-half, half].flatMap((x) => [-wide, wide].map((z) => ({ box: [0.6, height / 2, 0.6] as Vec3, at: [x, height / 2, z] as Vec3 }))), {
    box: [CONTAINER.long / 2, CONTAINER.height / 2 + 0.5, CONTAINER.width / 2],
    at: [0, 1.3 + CONTAINER.height / 2, 0],
  })
}

// Counterbalance forklift, forks to +x: body and counterweight, the
// overhead guard over the seat, the mast with its carriage and forks.
export function forklift(paint = '#c4921f') {
  const group = new THREE.Group()
  const body = materials.bodywork(paint)
  const dark = materials.darkSteel()
  group.add(part(new RoundedBoxGeometry(2.3, 0.9, 1.2, 2, 0.12), body, [-0.2, 0.75, 0]))
  group.add(part(new RoundedBoxGeometry(0.7, 0.95, 1.15, 2, 0.15), dark, [-1.15, 0.95, 0]))
  for (const [x, z] of [
    [0.55, 0.62],
    [0.55, -0.62],
    [-0.95, 0.58],
    [-0.95, -0.58],
  ]) {
    group.add(part(new THREE.CylinderGeometry(0.32, 0.32, 0.26, 14), materials.rubber(), [x, 0.32, z], [Math.PI / 2, 0, 0]))
  }
  for (const [x, z] of [
    [0.45, 0.52],
    [0.45, -0.52],
    [-0.75, 0.52],
    [-0.75, -0.52],
  ]) {
    group.add(part(tube([x, 1.2, z], [x, 2.2, z], 0.035, 6), dark))
  }
  group.add(part(new THREE.BoxGeometry(1.35, 0.06, 1.15), dark, [-0.15, 2.22, 0]))
  group.add(part(new THREE.BoxGeometry(0.45, 0.5, 0.5), materials.rubber(), [-0.4, 1.45, 0]))
  for (const z of [-0.38, 0.38]) group.add(part(new THREE.BoxGeometry(0.12, 2.6, 0.12), dark, [1, 1.3, z]))
  group.add(part(new THREE.BoxGeometry(0.08, 0.8, 0.95), dark, [1.08, 0.6, 0]))
  for (const z of [-0.3, 0.3]) group.add(part(new THREE.BoxGeometry(1.1, 0.05, 0.12), dark, [1.65, 0.22, z]))
  return solid(group, { box: [1.45, 0.9, 0.7], at: [0, 0.9, 0] })
}

// Cast-iron mooring bollard.
export function bollard() {
  const group = new THREE.Group()
  const iron = materials.darkSteel()
  group.add(part(new THREE.CylinderGeometry(0.42, 0.46, 0.12, 14), iron, [0, 0.06, 0]))
  group.add(part(new THREE.CylinderGeometry(0.26, 0.3, 0.62, 14), iron, [0, 0.43, 0]))
  group.add(part(new THREE.CylinderGeometry(0.36, 0.3, 0.14, 14), iron, [0, 0.8, 0]))
  return solid(group, { cylinder: [0.42, 0.45], at: [0, 0.45, 0] })
}

// High-mast floodlight: a tapered pole, a ring at the top with lamps aimed out and down.
export function floodMast(height = 24) {
  const group = new THREE.Group()
  group.add(part(new THREE.CylinderGeometry(0.18, 0.34, height, 10), materials.steel(), [0, height / 2, 0]))
  group.add(part(new THREE.TorusGeometry(1.2, 0.08, 6, 20).rotateX(Math.PI / 2), materials.darkSteel(), [0, height, 0]))
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    const lamp = buildLamp(0.32, '#ffe2b0', 12)
    lamp.position.set(Math.cos(angle) * 1.2, height - 0.2, Math.sin(angle) * 1.2)
    lamp.lookAt(Math.cos(angle) * 12, 0, Math.sin(angle) * 12)
    group.add(lamp)
  }
  return solid(group, { cylinder: [0.36, height / 2], at: [0, height / 2, 0] })
}

// Chain-link security fence along x: posts every 3 m, a top rail, the mesh,
// barbed wire on arms leaning out over -Z. Not solid: the boundary is.
export function fence(length: number, height = 3) {
  const group = new THREE.Group()
  const post = materials.steel()
  const posts = Math.max(1, Math.round(length / 3))
  for (let i = 0; i <= posts; i++) {
    const x = -length / 2 + (i * length) / posts
    group.add(part(tube([x, 0, 0], [x, height, 0], 0.05, 6), post))
    group.add(part(tube([x, height, 0], [x, height + 0.45, -0.4], 0.03, 4), post))
  }
  group.add(part(tube([-length / 2, height, 0], [length / 2, height, 0], 0.04, 6), post))
  group.add(part(new THREE.BoxGeometry(length, height - 0.1, 0.02), materials.grate(), [0, height / 2, 0]))
  for (const [y, z] of [
    [height + 0.2, -0.18],
    [height + 0.4, -0.36],
  ]) {
    group.add(part(tube([-length / 2, y, z], [length / 2, y, z], 0.015, 4), materials.darkSteel()))
  }
  return group
}

// Gatehouse at a lane through the fence: a booth with windows all round
// under a flat roof, and a striped boom lowered across the lane along +x.
export function gatehouse(boom = 7) {
  const group = new THREE.Group()
  group.add(part(new THREE.BoxGeometry(3.2, 0.3, 3.2), materials.concrete(), [0, 0.15, 0]))
  group.add(part(new THREE.BoxGeometry(2.6, 2.6, 2.6), materials.bodywork('#d9d4c8'), [0, 1.6, 0]))
  for (const [w, d, x, z] of [
    [2.2, 0.06, 0, 1.31],
    [2.2, 0.06, 0, -1.31],
    [0.06, 2.2, 1.31, 0],
    [0.06, 2.2, -1.31, 0],
  ]) {
    group.add(part(new THREE.BoxGeometry(w, 1, d), materials.glass(), [x, 2, z]))
  }
  group.add(part(new THREE.BoxGeometry(3.4, 0.25, 3.4), materials.darkSteel(), [0, 3.02, 0]))
  group.add(part(new THREE.BoxGeometry(0.4, 1, 0.4), materials.bodywork('#d9d4c8'), [1.8, 0.5, 1.8]))
  group.add(part(new THREE.BoxGeometry(boom, 0.12, 0.12), materials.barrier(), [1.8 + boom / 2, 0.95, 1.8]))
  return solid(group, { box: [1.5, 1.5, 1.5], at: [0, 1.5, 0] })
}

// Moored container ship along x, bow to +x, its origin at the waterline:
// the hull, a forecastle, the accommodation block and bridge wings at the
// stern, the funnel; deck cargo stacked bay by bay in `cargo`, whose boxes
// are in world space: the caller places the ship at `at`. Scenery only.
export function ship(cargo: ReturnType<typeof containerKit>, at: Vec3, rng: () => number, paints: readonly string[], length = 170, beam = 28) {
  const group = new THREE.Group()
  const freeboard = 9
  const bow = 22
  const plan = new THREE.Shape()
  plan.moveTo(-length / 2, -beam / 2)
  plan.lineTo(length / 2 - bow, -beam / 2)
  plan.quadraticCurveTo(length / 2 - 4, -beam / 2 + 2, length / 2, 0)
  plan.quadraticCurveTo(length / 2 - 4, beam / 2 - 2, length / 2 - bow, beam / 2)
  plan.lineTo(-length / 2, beam / 2)
  plan.closePath()
  const hull = new THREE.ExtrudeGeometry(plan, { depth: freeboard + 3, bevelEnabled: false, curveSegments: 8 }).rotateX(-Math.PI / 2).translate(0, -3, 0)
  group.add(part(boxUV(hull), materials.bodywork('#1d2a33')))
  group.add(part(new THREE.BoxGeometry(length - bow, 0.5, beam + 0.3), materials.bodywork('#7a2418'), [-bow / 2, freeboard - 0.2, 0]))
  group.add(part(new THREE.BoxGeometry(16, 2.4, beam - 6), materials.bodywork('#1d2a33'), [length / 2 - bow - 6, freeboard + 1.2, 0]))
  // accommodation: five decks of windows, the bridge on top with its wings, the funnel behind
  const stern = -length / 2
  const white = materials.bodywork('#d8d2c4')
  group.add(part(new THREE.BoxGeometry(14, 15, beam - 6), white, [stern + 15, freeboard + 7.5, 0]))
  for (let deck = 0; deck < 5; deck++) {
    const y = freeboard + 2 + deck * 2.8
    group.add(part(new THREE.BoxGeometry(0.06, 1, beam - 8), materials.glass(), [stern + 22.04, y, 0]))
    for (const side of [-1, 1]) group.add(part(new THREE.BoxGeometry(12, 1, 0.06), materials.glass(), [stern + 15, y, side * ((beam - 6) / 2 + 0.03)]))
  }
  group.add(part(new THREE.BoxGeometry(9, 2.8, beam + 2), white, [stern + 17, freeboard + 16.4, 0]))
  group.add(part(new THREE.BoxGeometry(0.06, 1.4, beam), materials.glass(), [stern + 21.54, freeboard + 16.6, 0]))
  group.add(part(new THREE.BoxGeometry(5, 8, 6), materials.bodywork('#2a2a2a'), [stern + 6, freeboard + 4, 0]))
  group.add(part(new THREE.BoxGeometry(5.1, 1.6, 6.1), materials.bodywork('#7a2418'), [stern + 6, freeboard + 6.6, 0]))
  group.add(part(tube([stern + 17, freeboard + 17.8, 0], [stern + 17, freeboard + 23, 0], 0.12, 6), materials.steel()))
  // deck cargo, bay by bay: stacks across the beam, three to six high
  for (let x = stern + 26; x < length / 2 - bow - 14; x += CONTAINER.short + 0.4) {
    for (let k = 0; k < 10; k++) {
      const z = (k - 4.5) * (CONTAINER.width + 0.1)
      const tiers = 3 + Math.floor(rng() * 4)
      for (let t = 0; t < tiers; t++)
        cargo.add(at[0] + x, at[1] + freeboard + t * CONTAINER.height, at[2] + z, 0, false, paints[Math.floor(rng() * paints.length)])
    }
  }
  return group
}
