import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bentTube, boxUV, extrudeProfile, mergeByMaterial, part, truss, tube, type Vec3 } from '../../../render/geometry.ts'
import { LIVERIES, materials } from '../../../render/materials/library.ts'
import { buildLamp, tyreCarcass } from '../../parts.ts'

// Arena props. Origin on the ground at the footprint centre, long axis along
// x, "front" facing +Z. Static props are plain groups (the arena merges them
// per material); high-count clutter exposes a geometry for instancing.

const shape = (points: Array<[number, number]>) => new THREE.Shape(points.map(([a, b]) => new THREE.Vector2(a, b)))
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

// Physics footprint in the object's own space: box half-extents or an upright
// cylinder [radius, half height], centred on `at`.
export type LocalCollider = { box: Vec3; at?: Vec3 } | { cylinder: [number, number]; at?: Vec3 }

// Tags a prop as solid; the arena collects the shapes with their world
// transforms before merging meshes. Without shapes, the prop's own bounding
// box is used — so call it before the prop is placed.
export function solid<T extends THREE.Object3D>(object: T, ...colliders: LocalCollider[]): T {
  if (!colliders.length) {
    const bounds = object instanceof THREE.Mesh ? (object.geometry.computeBoundingBox(), object.geometry.boundingBox!) : new THREE.Box3().setFromObject(object)
    colliders = [{ box: bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5).toArray(), at: bounds.getCenter(new THREE.Vector3()).toArray() }]
  }
  object.userData.colliders = colliders
  return object
}

// --- cover -----------------------------------------------------------------

const JERSEY: Array<[number, number]> = [
  [-0.3, 0],
  [0.3, 0],
  [0.3, 0.08],
  [0.17, 0.3],
  [0.1, 0.82],
  [-0.1, 0.82],
  [-0.17, 0.3],
  [-0.3, 0.08],
]

// Concrete jersey barrier with worn red stripes.
export function jerseyBarrier(length = 3) {
  return solid(part(extrudeProfile(shape(JERSEY), length, 0.02), materials.barrier()))
}

// ISO shipping container, cargo doors on +x.
export function shippingContainer(paint: string, length = 6.06) {
  const width = 2.44
  const height = 2.59
  const frame = materials.rustySteel()
  const group = new THREE.Group()
  group.add(part(new THREE.BoxGeometry(length - 0.12, height - 0.16, width - 0.08), materials.corrugated(paint), [0, height / 2, 0]))
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) group.add(part(new THREE.BoxGeometry(0.16, height, 0.16), frame, [x * (length / 2 - 0.08), height / 2, z * (width / 2 - 0.08)]))
  }
  for (const y of [0.08, height - 0.08]) {
    for (const z of [-1, 1]) group.add(part(new THREE.BoxGeometry(length, 0.16, 0.12), frame, [0, y, z * (width / 2 - 0.06)]))
    for (const x of [-1, 1]) group.add(part(new THREE.BoxGeometry(0.12, 0.16, width), frame, [x * (length / 2 - 0.06), y, 0]))
  }
  for (const z of [-0.95, -0.35, 0.35, 0.95]) {
    group.add(part(tube([length / 2 + 0.03, 0.2, z], [length / 2 + 0.03, height - 0.2, z], 0.025, 8), frame))
    group.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.22), frame, [length / 2 + 0.05, 1.2, z + 0.1]))
  }
  return solid(group)
}

// Rolled steel I-beam lying along x.
export function iBeam(length: number) {
  const profile = shape([
    [-0.15, 0],
    [0.15, 0],
    [0.15, 0.03],
    [0.02, 0.03],
    [0.02, 0.37],
    [0.15, 0.37],
    [0.15, 0.4],
    [-0.15, 0.4],
    [-0.15, 0.37],
    [-0.02, 0.37],
    [-0.02, 0.03],
    [-0.15, 0.03],
  ])
  return solid(part(extrudeProfile(profile, length, 0.004), materials.rustySteel()))
}

// --- instanced clutter geometry ----------------------------------------------

export function drumGeometry() {
  const rib = (y: number, radius: number) => new THREE.TorusGeometry(radius, 0.013, 6, 20).rotateX(Math.PI / 2).translate(0, y, 0)
  return mergeGeometries(
    [new THREE.CylinderGeometry(0.29, 0.29, 0.88, 20).translate(0, 0.44, 0), rib(0.3, 0.292), rib(0.58, 0.292), rib(0.875, 0.28)].map(boxUV),
  )
}

// Tyre lying on its side, resting on the ground.
export function tyreGeometry() {
  return boxUV(
    tyreCarcass(0.42, 0.3, 14)
      .rotateZ(Math.PI / 2)
      .translate(0, 0.15, 0),
  )
}

// Junk-pile car shells: body length/height, axle positions, cabin profile (z, y).
const WRECKS: Array<{ half: number; top: number; axles: [number, number]; cabin: Array<[number, number]> }> = [
  {
    half: 2.2,
    top: 0.9,
    axles: [1.35, -1.35],
    cabin: [
      [1.05, 0.86],
      [0.4, 1.36],
      [-0.9, 1.36],
      [-1.5, 0.88],
    ],
  },
  {
    half: 1.9,
    top: 0.92,
    axles: [1.2, -1.2],
    cabin: [
      [0.95, 0.88],
      [0.35, 1.4],
      [-1.2, 1.42],
      [-1.85, 0.95],
    ],
  },
  {
    half: 2.45,
    top: 1.0,
    axles: [1.5, -1.6],
    cabin: [
      [1.2, 0.96],
      [0.6, 1.6],
      [-0.4, 1.62],
      [-0.6, 0.96],
    ],
  },
]
export const WRECK_VARIANTS = WRECKS.length

const WRECK_WHEEL = { y: 0.34, radius: 0.33, arch: 0.42 }

// Side silhouette with both wheel arches cut out, so shells read as cars.
function wreckProfile(half: number, top: number, axles: [number, number]) {
  const sill = 0.24
  const outline = shape([
    [-half, sill],
    [-half - 0.05, top - 0.12],
    [-half + 0.3, top],
    [half - 0.5, top - 0.02],
    [half, top - 0.22],
    [half + 0.05, sill + 0.1],
    [half - 0.1, sill],
  ])
  const start = Math.asin((sill - WRECK_WHEEL.y) / WRECK_WHEEL.arch)
  for (const axle of axles) outline.absarc(axle, WRECK_WHEEL.y, WRECK_WHEEL.arch, start, Math.PI - start, false)
  outline.closePath()
  return outline
}

// Grey vertex colour picked per vertex from its normal's y; multiplies the instance tint and texture.
function shade(geometry: THREE.BufferGeometry, value: (normalY: number) => number) {
  const normal = geometry.getAttribute('normal')
  const colors = new Float32Array(normal.count * 3).map((_, i) => value(normal.getY(Math.floor(i / 3))))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

// Stripped, dented car shell for junk piles (use materials.wreck()). Vertex
// colours keep glass and tyres dark under any tint; faceted normals read as crumpled.
export function wreckGeometry(variant: number) {
  const { half, top, axles, cabin } = WRECKS[variant % WRECKS.length]
  const glassOrRoof = (normalY: number) => (normalY > 0.85 ? 1 : 0.07)
  const parts = [
    shade(boxUV(extrudeProfile(wreckProfile(half, top, axles), 1.72, 0.06, 6)), () => 1), // hundreds of these: coarse arches
    shade(boxUV(extrudeProfile(shape(cabin), 1.4, 0.05)), glassOrRoof),
  ]
  for (const z of axles) {
    for (const x of [-0.7, 0.7]) {
      const wheel = new THREE.CylinderGeometry(WRECK_WHEEL.radius, WRECK_WHEEL.radius, 0.24, 12).rotateZ(Math.PI / 2).translate(x, WRECK_WHEEL.y, z)
      parts.push(shade(boxUV(wheel), () => 0.1))
    }
  }
  const geometry = mergeGeometries(parts)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const dent = Math.max(0, Math.sin(x * 3.1 + z * 1.7 + variant * 2.3)) * 0.07 + Math.max(0, Math.sin(z * 4.3 - variant)) * 0.04
    position.setXYZ(i, x * (1 - dent * 0.4), y - dent * (y / 1.4) * 1.5, z)
  }
  geometry.computeVertexNormals()
  return geometry
}

// A car crushed into a bale (use materials.wreck()): a dented block, the
// tint in bands between dark crumpled glass and rubber (vertex colours).
export function baleGeometry() {
  const block = new THREE.BoxGeometry(2.4, 1.1, 1.6, 6, 3, 4)
  const position = block.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const dent = 0.07 * Math.sin(x * 4.1 + z * 2.3) * Math.cos(y * 5.7 - x) + 0.04 * Math.sin(z * 7.3 + y * 3.1)
    position.setXYZ(i, x * (1 + dent * 0.4), y + dent, z * (1 + dent))
  }
  block.translate(0, 0.55, 0)
  block.computeVertexNormals()
  const geometry = boxUV(block)
  const at = geometry.getAttribute('position')
  const colors = new Float32Array(at.count * 3)
  for (let i = 0; i < at.count; i++) colors.fill(Math.sin(at.getY(i) * 9 + at.getX(i) * 1.3) > 0.6 ? 0.1 : 1, i * 3, i * 3 + 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

// Heap of scrap for the skyline: a low lumpy dome, smooth-shaded so it reads
// as piled junk rather than rock. Mostly seen as a silhouette in the haze.
export function junkMound(radius: number, height: number, seed: number) {
  const sphere = new THREE.IcosahedronGeometry(1, 6)
  sphere.deleteAttribute('normal')
  sphere.deleteAttribute('uv')
  const geometry = mergeVertices(sphere)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const lump = 1 + 0.12 * Math.sin(x * 5.1 + seed) * Math.cos(z * 4.3 + seed * 1.7) + 0.06 * Math.sin(x * 17 + y * 11) * Math.sin(z * 13 - y * 7)
    position.setXYZ(i, x * radius * lump, (Math.max(y, 0) * height - 0.4) * lump, z * radius * lump)
  }
  geometry.computeVertexNormals()
  return part(geometry, materials.rustySteel())
}

// --- structures ------------------------------------------------------------

// Lattice watch tower with a lit cabin and a floodlight rack aimed along +Z.
export function watchTower(height = 14) {
  const group = new THREE.Group()
  const steel = materials.rustySteel()
  const legs = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([x, z]): [Vec3, Vec3] => [
    [x * 1.8, 0, z * 1.8],
    [x * 1.35, height, z * 1.35],
  ])
  for (const [bottom, top] of legs) group.add(part(tube(bottom, top, 0.14, 8), steel))
  const levels = Math.round(height / 3.5)
  for (let i = 0; i <= levels; i++) {
    for (let c = 0; c < 4; c++) {
      const [a0, a1] = legs[c]
      const [b0, b1] = legs[(c + 1) % 4]
      const t0 = i / levels
      const t1 = (i + 1) / levels
      group.add(part(tube(lerp3(a0, a1, t0), lerp3(b0, b1, t0), 0.06, 6), steel))
      if (i === levels) continue
      group.add(part(tube(lerp3(a0, a1, t0), lerp3(b0, b1, t1), 0.045, 5), steel))
      group.add(part(tube(lerp3(b0, b1, t0), lerp3(a0, a1, t1), 0.045, 5), steel))
    }
  }

  const deck = height + 0.15
  group.add(part(new THREE.BoxGeometry(4.6, 0.3, 4.6), steel, [0, deck, 0]))
  group.add(part(new THREE.BoxGeometry(3.2, 2.4, 3.2), materials.corrugated('#4d4842'), [0, deck + 1.35, 0]))
  for (let side = 0; side < 4; side++) {
    const angle = (side * Math.PI) / 2
    const pane = part(
      new THREE.BoxGeometry(2.2, 0.6, 0.05),
      materials.light('#ffb45a', 2.2),
      [Math.sin(angle) * 1.61, deck + 1.7, Math.cos(angle) * 1.61],
      [0, angle, 0],
    )
    group.add(pane)
  }
  group.add(part(new THREE.BoxGeometry(3.9, 0.22, 3.9), steel, [0, deck + 2.65, 0]))
  for (const [a, b] of [
    [
      [-2.2, 1, 2.2],
      [2.2, 1, 2.2],
    ],
    [
      [2.2, 1, 2.2],
      [2.2, 1, -2.2],
    ],
    [
      [2.2, 1, -2.2],
      [-2.2, 1, -2.2],
    ],
    [
      [-2.2, 1, -2.2],
      [-2.2, 1, 2.2],
    ],
  ] as Array<[Vec3, Vec3]>) {
    group.add(part(tube([a[0], deck + a[1], a[2]], [b[0], deck + b[1], b[2]], 0.035, 6), steel))
  }

  // Floodlight rack on the roof, two rows of three, tilted down into the yard.
  const rack = new THREE.Group()
  rack.add(part(new THREE.BoxGeometry(2.6, 1.3, 0.12), materials.darkSteel(), [0, 0, -0.1]))
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const lamp = buildLamp(0.24, '#ffe7c4', 16)
      lamp.position.set((col - 1) * 0.82, (row - 0.5) * 0.6, 0)
      rack.add(lamp)
    }
  }
  rack.position.set(0, deck + 3.6, 1.2)
  rack.rotation.x = 0.35
  group.add(rack)
  group.add(part(tube([0, deck + 2.75, 0.9], [0, deck + 3.2, 1.1], 0.08, 8), steel))

  // Ladder up the back face.
  const ladderZ = -1.9
  for (const x of [-0.25, 0.25]) group.add(part(tube([x, 0, ladderZ], [x, deck, ladderZ + 0.45], 0.03, 5), steel))
  for (let y = 0.3; y < deck; y += 0.35) {
    const z = ladderZ + (y / deck) * 0.45
    group.add(part(tube([-0.25, y, z], [0.25, y, z], 0.018, 4), steel))
  }
  return solid(group, { box: [1.95, 3, 1.95], at: [0, 3, 0] }) // braced legs: only the base matters at car height
}

// Faction banner hanging from its origin down to -height, facing +Z.
export function banner(width = 2.4, height = 5) {
  const cloth = new THREE.PlaneGeometry(width, height, 6, 12)
  const position = cloth.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const slack = 0.3 + (0.5 - y / height) // loosens toward the hem
    position.setZ(i, Math.sin(x * 2.6 + y * 0.8) * 0.06 * slack)
  }
  cloth.computeVertexNormals()
  cloth.translate(0, -height / 2 - 0.08, 0)
  const group = new THREE.Group()
  group.add(part(cloth, materials.banner()))
  group.add(part(tube([-width / 2 - 0.15, 0, 0], [width / 2 + 0.15, 0, 0], 0.05, 8), materials.rustySteel()))
  return group
}

// Horizontal truss spanning between two towers, banner in the middle.
export function gantry(span: number, bannerHeight = 6) {
  const group = new THREE.Group()
  group.add(part(truss([-span / 2, 0, 0], [span / 2, 0, 0], 1.6, Math.round(span / 2), 0.1, 0.045), materials.rustySteel()))
  const flag = banner(4, bannerHeight)
  flag.position.set(0, -0.9, 0.9)
  group.add(flag)
  return group
}

// Street lamp with its head facing down.
export function lampPost(height = 7) {
  const group = new THREE.Group()
  group.add(part(tube([0, 0, 0], [0, height, 0], 0.09, 10), materials.rustySteel()))
  group.add(part(tube([0, height - 0.1, 0], [0, height + 0.15, 0.9], 0.06, 8), materials.rustySteel()))
  const lamp = buildLamp(0.22, '#ffd8a0', 10)
  lamp.position.set(0, height + 0.15, 0.9)
  lamp.rotation.x = Math.PI / 2
  group.add(lamp)
  return solid(group, { cylinder: [0.15, height / 2], at: [0, height / 2, 0] })
}

// Long open-fronted work shed (front along +Z), lit from inside.
export function shed(length = 36, depth = 11, height = 7) {
  const group = new THREE.Group()
  const wall = materials.corrugated('#5f5850')
  const frame = materials.rustySteel()
  // walls and posts are solid one by one, so cars can drive in under the roof
  group.add(solid(part(new THREE.BoxGeometry(length, height, 0.15), wall, [0, height / 2, -depth / 2])))
  for (const x of [-1, 1]) group.add(solid(part(new THREE.BoxGeometry(0.15, height, depth), wall, [(x * length) / 2, height / 2, 0])))
  group.add(part(new THREE.BoxGeometry(length + 0.6, 0.12, depth + 1.4), wall, [0, height + 0.5, 0.3], [-0.1, 0, 0]))
  for (let x = -length / 2; x <= length / 2 + 0.01; x += 6) {
    group.add(solid(part(new THREE.BoxGeometry(0.3, height + 0.6, 0.3), frame, [x, (height + 0.6) / 2, depth / 2])))
    group.add(part(new THREE.BoxGeometry(0.3, 0.4, depth + 0.6), frame, [x, height + 0.3, 0.2], [-0.1, 0, 0]))
  }
  for (let x = -length / 2 + 4; x < length / 2 - 1; x += 6) {
    group.add(part(new THREE.BoxGeometry(1.4, 0.12, 0.5), materials.light('#ffb060', 7), [x, height - 0.7, -0.5]))
  }
  return group
}

// Broken-backed airliner, half sunk into the yard: fuselage, fin, wing, engines.
export function planeWreck() {
  const group = new THREE.Group()
  const skin = materials.aluminium()
  // tail to nose: lathe normals face outward when the profile runs up its axis
  const profile = [
    [1.95, -6.5],
    [1.95, 3],
    [1.8, 5.8],
    [1.35, 7.4],
    [0.7, 8.4],
    [0, 8.8],
  ].map(([r, z]) => new THREE.Vector2(r, z))
  const hull = new THREE.Group()
  hull.add(part(new THREE.LatheGeometry(profile, 28).rotateX(Math.PI / 2), skin))
  // inside of the torn tail end, facing inward so the fuselage doesn't look hollow
  hull.add(
    part(
      new THREE.LatheGeometry(
        [...profile].reverse().map((p) => p.clone().multiplyScalar(0.985)),
        28,
      ).rotateX(Math.PI / 2),
      materials.darkSteel(),
    ),
  )
  const windowX = Math.sqrt(1.95 ** 2 - 0.55 ** 2)
  for (let i = 0; i < 12; i++) {
    for (const side of [-1, 1]) {
      hull.add(part(new RoundedBoxGeometry(0.06, 0.34, 0.26, 2, 0.02), materials.glass(), [side * windowX, 0.55, 4.5 - i * 0.85]))
    }
  }
  hull.add(
    part(
      extrudeProfile(
        shape([
          [-5.6, 1.6],
          [-2.8, 1.6],
          [-5.0, 5.2],
          [-6.3, 5.2],
        ]),
        0.3,
        0.05,
      ),
      skin,
    ),
  )
  hull.position.set(0, 1.1, 0)
  hull.rotation.set(0.04, 0, 0.2)
  group.add(solid(hull, { box: [1.95, 1.95, 7.65], at: [0, 0, 1.15] }))

  const wing = part(
    extrudeProfile(
      shape([
        [0, 0],
        [3.4, 0],
        [2.2, 0.32],
        [0.4, 0.34],
      ]),
      11,
      0.04,
    ),
    skin,
    [6.5, 0.8, 1.5],
    [0.25, 0.3, -0.32],
  )
  group.add(solid(wing))
  for (const [x, z, yaw] of [
    [-4.5, 5.5, 0.6],
    [5.5, -3.5, -0.4],
  ]) {
    group.add(solid(part(new THREE.CylinderGeometry(0.85, 0.7, 3.4, 20), skin, [x, 0.75, z], [Math.PI / 2, yaw, 0])))
    group.add(part(new THREE.CircleGeometry(0.72, 20), materials.darkSteel(), [x + Math.sin(yaw) * 1.71, 0.75, z + Math.cos(yaw) * 1.71], [0, yaw, 0]))
  }
  return group
}

// Pipe rack bridging a road along x: two lattice legs, three pipes, catwalk.
export function pipeBridge(span = 18, height = 7) {
  const group = new THREE.Group()
  const steel = materials.rustySteel()
  for (const x of [-span / 2, span / 2]) group.add(solid(part(truss([x, 0, 0], [x, height + 1.4, 0], 2.2, 5, 0.12, 0.05), steel)))
  for (const [z, y, radius] of [
    [-0.55, height + 0.5, 0.45],
    [0.35, height + 0.4, 0.34],
    [0.95, height + 0.32, 0.26],
  ]) {
    group.add(part(tube([-span / 2 - 4, y, z], [span / 2 + 4, y, z], radius, 20), steel))
    for (const x of [-span / 4, span / 4]) group.add(part(tube([x - 0.1, y, z], [x + 0.1, y, z], radius + 0.06, 20), materials.darkSteel()))
  }
  const deckY = height + 1.2
  group.add(part(new THREE.BoxGeometry(span + 2.4, 0.06, 1.3), materials.grate(), [0, deckY, -1.9]))
  group.add(part(truss([-span / 2, deckY - 0.35, -1.9], [span / 2, deckY - 0.35, -1.9], 0.6, Math.round(span / 1.5), 0.06, 0.03), steel))
  for (const z of [-1.3, -2.5]) group.add(part(tube([-span / 2 - 1, deckY + 1, z], [span / 2 + 1, deckY + 1, z], 0.03, 6), steel))
  for (let x = -span / 2; x <= span / 2 + 0.01; x += 1.5) {
    for (const z of [-1.3, -2.5]) group.add(part(tube([x, deckY, z], [x, deckY + 1, z], 0.025, 5), steel))
  }
  return group
}

// Tracked crawler crane. `structure` is static; `claw` hangs from the boom
// tip (position given in crane space) and is meant to sway.
export function crane() {
  const structure = solid(new THREE.Group(), { box: [2.1, 2.3, 3.65], at: [0, 2.3, -0.35] }) // tracks, cab and counterweight; the boom is overhead
  const steel = materials.rustySteel()
  const housing = materials.corrugated('#6d5b3b')
  for (const x of [-1.6, 1.6]) structure.add(part(new RoundedBoxGeometry(1.0, 1.1, 6.5, 2, 0.3), materials.darkSteel(), [x, 0.55, 0]))
  structure.add(part(new THREE.BoxGeometry(3.6, 1.0, 4.6), steel, [0, 1.5, 0]))
  structure.add(part(new THREE.BoxGeometry(3.2, 2.6, 4.2), housing, [0, 3.3, -0.6]))
  structure.add(part(new THREE.BoxGeometry(1.4, 1.8, 1.6), housing, [1.1, 3.0, 2.2]))
  structure.add(part(new THREE.BoxGeometry(1.2, 0.9, 0.05), materials.glass(), [1.1, 3.3, 3.01]))
  structure.add(part(new THREE.BoxGeometry(3.4, 1.8, 1.4), materials.concrete(), [0, 3.3, -3.3]))

  const pivot: Vec3 = [0, 3.8, 1.5]
  const elevation = 0.95
  const length = 30
  const tip: Vec3 = [0, pivot[1] + Math.sin(elevation) * length, pivot[2] + Math.cos(elevation) * length]
  structure.add(part(truss(pivot, tip, 1.3, 18, 0.1, 0.045), steel))
  structure.add(part(truss([0, 4.6, -1.0], [0, 8.5, -1.0], 1.0, 3, 0.08, 0.04), steel))
  structure.add(part(tube([0, 8.5, -1.0], tip, 0.035, 4), materials.darkSteel()))
  structure.add(part(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 16), materials.darkSteel(), tip, [0, 0, Math.PI / 2]))

  const drop = 11
  const claw = new THREE.Group()
  claw.add(part(tube([0, 0, 0], [0, -drop, 0], 0.04, 4), materials.darkSteel()))
  claw.add(part(new RoundedBoxGeometry(0.9, 1.1, 0.9, 2, 0.08), materials.darkSteel(), [0, -drop - 0.5, 0]))
  claw.add(part(new THREE.CylinderGeometry(0.7, 0.9, 0.5, 12), steel, [0, -drop - 1.25, 0]))
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2
    const out = (r: number, y: number): Vec3 => [Math.cos(angle) * r, -drop + y, Math.sin(angle) * r]
    claw.add(part(bentTube([out(0.75, -1.3), out(1.9, -2.2), out(1.8, -3.6), out(0.9, -4.5)], 0.13, 8), steel))
  }
  const swinging = mergeByMaterial(claw)
  swinging.position.set(...tip)
  return { structure, claw: swinging }
}

// Squat storage tank: a welded steel shell with stiffening rings, a shallow
// cone roof with a rail round it, a ladder up the +Z side.
export function storageTank(radius: number, height: number, paint = '#9a948a') {
  const group = new THREE.Group()
  const steel = materials.rustySteel()
  group.add(part(new THREE.CylinderGeometry(radius, radius, height, 40), materials.bodywork(paint), [0, height / 2, 0]))
  group.add(part(new THREE.ConeGeometry(radius + 0.2, radius * 0.28, 40), materials.steel(), [0, height + radius * 0.14, 0]))
  for (const t of [0, 0.36, 0.7])
    group.add(part(new THREE.TorusGeometry(radius + 0.04, 0.09, 6, 48).rotateX(Math.PI / 2), materials.darkSteel(), [0, height * t + 0.1, 0]))
  group.add(part(new THREE.TorusGeometry(radius - 0.1, 0.035, 5, 48).rotateX(Math.PI / 2), steel, [0, height + 1.05, 0]))
  for (let i = 0; i < 16; i++) {
    const [x, z] = [Math.cos((i / 16) * Math.PI * 2) * (radius - 0.1), Math.sin((i / 16) * Math.PI * 2) * (radius - 0.1)]
    group.add(part(tube([x, height, z], [x, height + 1.05, z], 0.03, 4), steel))
  }
  for (const x of [-0.25, 0.25]) group.add(part(tube([x, 0, radius + 0.3], [x, height + 1, radius + 0.3], 0.03, 5), steel))
  for (let y = 0.35; y < height + 0.9; y += 0.35) group.add(part(tube([-0.25, y, radius + 0.3], [0.25, y, radius + 0.3], 0.018, 4), steel))
  return solid(group, { cylinder: [radius + 0.1, height / 2], at: [0, height / 2, 0] })
}

// Car crusher along x: a bed between steel walls, open at both ends, the
// press lid raised on its rams under a head beam on four columns; the power
// pack, exhaust and cab at the +x end.
export function crusher() {
  const group = new THREE.Group()
  const frame = materials.hazard(LIVERIES.hazard)
  const steel = materials.darkSteel()
  const bed = 9
  group.add(part(new THREE.BoxGeometry(bed, 1, 3.6), materials.concrete(), [0, 0.5, 0]))
  for (const z of [-1, 1]) group.add(part(new THREE.BoxGeometry(bed, 2.2, 0.35), steel, [0, 2.1, z * 1.62]))
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) group.add(part(new THREE.BoxGeometry(0.55, 7.2, 0.55), frame, [x * (bed / 2 - 0.3), 3.6, z * 1.95]))
  }
  group.add(part(new THREE.BoxGeometry(bed + 0.4, 0.8, 4.6), frame, [0, 7.6, 0]))
  group.add(part(new THREE.BoxGeometry(bed - 0.8, 0.6, 3), steel, [0, 5.6, 0]))
  for (const x of [-2.6, 0, 2.6]) group.add(part(tube([x, 5.9, 0], [x, 7.2, 0], 0.28, 12), materials.steel()))
  group.add(part(new THREE.BoxGeometry(3.2, 2.6, 3.4), materials.corrugated('#b08a2a'), [bed / 2 + 1.8, 1.3, 0]))
  group.add(part(tube([bed / 2 + 2.8, 2.6, -1], [bed / 2 + 2.8, 5.4, -1], 0.14, 10), steel))
  group.add(part(new THREE.BoxGeometry(1.6, 1.8, 1.6), materials.corrugated('#4d4842'), [bed / 2 + 1.6, 3.5, 0.7]))
  group.add(part(new THREE.BoxGeometry(1.3, 0.8, 0.05), materials.glass(), [bed / 2 + 1.6, 3.7, 1.53]))
  return solid(group, { box: [bed / 2 + 1.7, 1.6, 2.25], at: [1.6, 1.6, 0] })
}
