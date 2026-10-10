import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { extrudeProfile, part, tube } from '../../../render/geometry.ts'
import { FACADES, type FacadeStyle } from '../../../render/materials/facade.ts'
import { materials } from '../../../render/materials/library.ts'
import { FACADE_TILE } from '../../../render/materials/recipes.ts'
import { createRng } from '../../../shared/rng.ts'
import { solid } from './props.ts'

// City buildings. Origin at the centre of the footprint on the ground, the
// street front facing +Z. Facade walls carry their own uvs — u counts bays
// across, v storeys up, in FACADE_TILE units — so every window lands whole
// and the facade shader knows which room each pane looks into.

// Blinking red aviation light for masts and tall roofs; the city pulses it.
export const BEACON = new THREE.MeshStandardMaterial({ name: 'beacon', color: '#000000', emissive: '#ff2a1a', emissiveIntensity: 6 })

// One wall facing +Z, `length` wide and `storeys` high, its rooms numbered from (u0, v0).
function facadePanel(length: number, storeys: number, style: FacadeStyle, u0: number, v0 = 0) {
  const { bay, storey } = FACADES[style].rooms
  const bays = Math.max(1, Math.round(length / bay))
  const height = storeys * storey
  const plane = new THREE.PlaneGeometry(length, height).translate(0, height / 2, 0)
  const uv = plane.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (u0 + uv.getX(i) * bays) * FACADE_TILE, (v0 + uv.getY(i) * storeys) * FACADE_TILE)
  return plane
}

// The four walls around a width x depth footprint. Each wall's rooms start
// at their own offset, so no two walls (or buildings) light the same pattern.
function facadeWalls(width: number, depth: number, storeys: number, style: FacadeStyle, seed: number) {
  const walls = [0, 1, 2, 3].map((side) => {
    const along = side % 2 ? depth : width
    const out = (side % 2 ? width : depth) / 2
    return facadePanel(along, storeys, style, (seed * 37 + side * 53) % 211, (seed * 11) % 17)
      .translate(0, 0, out)
      .rotateY((side * Math.PI) / 2)
  })
  return mergeGeometries(walls)
}

// Moulded cornice, drawn in (out from the wall, up).
const CORNICE = new THREE.Shape(
  [
    [0, 0],
    [0.1, 0],
    [0.1, 0.1],
    [0.22, 0.16],
    [0.32, 0.32],
    [0.46, 0.38],
    [0.46, 0.55],
    [0, 0.55],
  ].map(([z, y]) => new THREE.Vector2(z, y)),
)

// A piece built against the south wall, turned onto wall `side` (0 south, 1 east, 2 north, 3 west).
function onWall(group: THREE.Group, side: number, piece: THREE.Object3D) {
  const holder = new THREE.Group()
  holder.rotation.y = (side * Math.PI) / 2
  holder.add(piece)
  group.add(holder)
}

// Cornice (masonry) or parapet (panels, glass) along the roof edge.
function roofline(group: THREE.Group, width: number, depth: number, top: number, crown: 'cornice' | 'parapet') {
  const trim = materials.concrete()
  for (let side = 0; side < 4; side++) {
    const along = side % 2 ? depth : width
    const out = (side % 2 ? width : depth) / 2
    if (crown === 'cornice') {
      onWall(group, side, part(extrudeProfile(CORNICE, along + (side % 2 ? 0 : 0.92), 0.01), trim, [0, top - 0.55, out]))
    } else {
      onWall(group, side, part(new THREE.BoxGeometry(along + (side % 2 ? -0.5 : 0.1), 1, 0.25), trim, [0, top + 0.5, out - 0.075]))
    }
  }
}

// Wooden-staved water tank on a steel stand, the tenement skyline's signature.
function waterTank() {
  const group = new THREE.Group()
  const steel = materials.rustySteel()
  for (const [x, z] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]) {
    group.add(part(tube([x * 1.35, 0, z * 1.35], [x * 1.35, 3.1, z * 1.35], 0.1, 6), steel))
  }
  for (const [a, b] of [
    [
      [-1.35, 3, -1.35],
      [1.35, 3, 1.35],
    ],
    [
      [1.35, 3, -1.35],
      [-1.35, 3, 1.35],
    ],
  ] as Array<[[number, number, number], [number, number, number]]>) {
    group.add(part(tube(a, b, 0.07, 6), steel))
  }
  group.add(part(new THREE.CylinderGeometry(1.9, 1.9, 3.6, 20), materials.corrugated('#4d3d2e'), [0, 4.9, 0]))
  for (const y of [3.6, 4.9, 6.2]) group.add(part(new THREE.TorusGeometry(1.93, 0.035, 5, 28).rotateX(Math.PI / 2), steel, [0, y, 0]))
  group.add(part(new THREE.CylinderGeometry(0.12, 2.05, 1.2, 20), materials.corrugated('#3b3a38'), [0, 7.3, 0]))
  return group
}

// Rooftop condenser: a box with a fan grille on top.
function acUnit() {
  const group = new THREE.Group()
  group.add(part(new THREE.BoxGeometry(1.4, 1, 1.1), materials.steel(), [0, 0.5, 0]))
  group.add(part(new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2), materials.grate(), [0, 1.005, 0]))
  return group
}

type Rooftop = 'tank' | 'plant' | 'mast' | 'bare'

// Roof clutter, one item per quadrant: a tank or plant room, a stair
// bulkhead, condensers; a mast with its beacon on tall buildings.
function rooftop(group: THREE.Group, width: number, depth: number, top: number, kind: Rooftop, rng: () => number) {
  if (kind === 'bare' || width < 7 || depth < 7) return
  const quadrants = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].sort(() => rng() - 0.5)
  const spot = (i: number, size: number): [number, number, number] => {
    const [qx, qz] = quadrants[i % 4]
    return [qx * (width / 4 + (rng() - 0.5) * Math.max(0, width / 2 - size - 1.5)), top, qz * (depth / 4 + (rng() - 0.5) * Math.max(0, depth / 2 - size - 1.5))]
  }
  if (kind === 'tank') {
    const tank = waterTank()
    tank.position.set(...spot(0, 4.2))
    group.add(tank)
  } else {
    const [x, y, z] = spot(0, Math.min(width, depth) * 0.4)
    group.add(part(new THREE.BoxGeometry(width * 0.35, 3.4, depth * 0.35), materials.corrugated('#5a5a57'), [x, y + 1.7, z]))
  }
  const bulkhead = spot(1, 3)
  group.add(part(new THREE.BoxGeometry(2.6, 2.8, 3), materials.concrete(), [bulkhead[0], top + 1.4, bulkhead[2]]))
  group.add(part(new THREE.BoxGeometry(0.9, 2, 0.05), materials.darkSteel(), [bulkhead[0], top + 1.05, bulkhead[2] + 1.52]))
  for (let i = 2; i < 2 + Math.min(2, Math.floor((width * depth) / 150)); i++) {
    const unit = acUnit()
    unit.position.set(...spot(i, 1.5))
    unit.rotation.y = Math.floor(rng() * 4) * (Math.PI / 2)
    group.add(unit)
  }
  if (kind === 'mast') {
    const [x, , z] = spot(3, 1)
    const height = 10 + rng() * 8
    group.add(part(tube([x, top, z], [x, top + height, z], 0.12, 8), materials.steel()))
    for (let y = 2; y < height - 1; y += 3) group.add(part(tube([x - 0.9, top + y, z], [x + 0.9, top + y, z], 0.03, 5), materials.steel()))
    group.add(part(new THREE.SphereGeometry(0.28, 12, 8), BEACON, [x, top + height + 0.2, z]))
  }
}

// Black iron fire escape across two bays of the +Z wall: a grated landing
// at every storey above the street, a stair zig-zagging between them and a
// drop ladder hanging over the sidewalk.
function fireEscape(group: THREE.Group, width: number, depth: number, base: number, storeys: number, style: FacadeStyle, rng: () => number) {
  const { bay, storey } = FACADES[style].rooms
  const bays = Math.max(1, Math.round(width / bay))
  if (bays < 3 || storeys < 3) return
  const pitch = width / bays
  const first = Math.floor(rng() * (bays - 1))
  const x0 = -width / 2 + first * pitch + 0.25
  const x1 = x0 + 2 * pitch - 0.5
  const wall = depth / 2
  const edge = wall + 1.3
  const iron = materials.darkSteel()
  const run = storey * 0.85 // stair's horizontal run per flight
  for (let k = 1; k < storeys; k++) {
    const y = base + k * storey
    group.add(part(new THREE.BoxGeometry(x1 - x0, 0.05, 1.3), materials.grate(), [(x0 + x1) / 2, y, wall + 0.65]))
    group.add(part(tube([x0, y, edge], [x1, y, edge], 0.035, 5), iron))
    for (const rail of [0.5, 1]) group.add(part(tube([x0, y + rail, edge], [x1, y + rail, edge], 0.022, 5), iron))
    for (const x of [x0, x1]) group.add(part(tube([x, y + 1, wall], [x, y + 1, edge], 0.022, 5), iron))
    for (let i = 0; i <= 4; i++) {
      const x = x0 + ((x1 - x0) * i) / 4
      group.add(part(tube([x, y, edge], [x, y + 1, edge], 0.02, 4), iron))
    }
    for (const x of [x0 + 0.3, x1 - 0.3]) group.add(part(tube([x, y - 0.7, wall], [x, y - 0.03, edge - 0.15], 0.03, 5), iron))
    if (k === 1) continue
    // flight up from the landing below, alternating ends
    const up = k % 2 === 0
    const xa = up ? x0 + 0.35 : x1 - 0.35
    const xb = up ? xa + run : xa - run
    const low = y - storey
    for (const z of [wall + 0.35, wall + 1.0]) group.add(part(tube([xa, low + 0.05, z], [xb, y, z], 0.03, 5), iron))
    const steps = Math.round(storey / 0.22)
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      group.add(part(new THREE.BoxGeometry(0.22, 0.03, 0.62), materials.grate(), [xa + (xb - xa) * t, low + (y - low) * t, wall + 0.675]))
    }
  }
  // drop ladder from the first landing, stopping well over a car's roof
  const lx = x1 - 0.5
  for (const x of [lx - 0.22, lx + 0.22]) group.add(part(tube([x, base + storey - 2.2, edge - 0.1], [x, base + storey, edge - 0.1], 0.025, 5), iron))
  for (let y = base + storey - 2.0; y < base + storey; y += 0.3) group.add(part(tube([lx - 0.22, y, edge - 0.1], [lx + 0.22, y, edge - 0.1], 0.015, 4), iron))
}

// Concrete balconies on alternate bays of the +Z wall, some glazed in.
function balconies(group: THREE.Group, width: number, depth: number, base: number, storeys: number, style: FacadeStyle, rng: () => number) {
  const { bay, storey } = FACADES[style].rooms
  const bays = Math.max(1, Math.round(width / bay))
  const pitch = width / bays
  const wall = depth / 2
  for (let k = 1; k < storeys; k++) {
    for (let i = k % 2; i < bays; i += 2) {
      const x = -width / 2 + (i + 0.5) * pitch
      const y = base + k * storey
      const front = rng() < 0.25 ? materials.glass() : materials.concrete() // some glazed in by their tenants
      group.add(part(new THREE.BoxGeometry(pitch * 0.9, 0.16, 1.2), materials.concrete(), [x, y, wall + 0.6]))
      group.add(part(new THREE.BoxGeometry(pitch * 0.9, 1, 0.08), front, [x, y + 0.58, wall + 1.16]))
      for (const side of [-1, 1]) group.add(part(new THREE.BoxGeometry(0.08, 1, 1.1), front, [x + (side * pitch * 0.9) / 2, y + 0.58, wall + 0.62]))
    }
  }
}

const SIGNS: Array<[string, string]> = [
  ['BAR', '#ff3b5c'],
  ['PAWN', '#ffb03b'],
  ['LIQUOR', '#3bd8ff'],
  ['DINER', '#ff5a3b'],
  ['HOTEL', '#b44bff'],
  ['OPEN', '#ff3b5c'],
  ['PIZZA', '#ffb03b'],
  ['TATTOO', '#6bff8a'],
  ['GARAGE', '#3bd8ff'],
  ['ARCADE', '#b44bff'],
]
const AWNINGS = ['#6e1d16', '#1f463a', '#2c4460', '#7a5a1c']

// Storefront dressing on the +Z wall: striped-metal awnings over some shops,
// a neon name on a fascia or two, sometimes a vertical blade sign.
function shopDressing(group: THREE.Group, width: number, depth: number, shops: FacadeStyle, rng: () => number) {
  const { bay, storey } = FACADES[shops].rooms
  const bays = Math.max(1, Math.round(width / bay))
  const pitch = width / bays
  const wall = depth / 2
  const awning = materials.corrugated(AWNINGS[Math.floor(rng() * AWNINGS.length)])
  for (let i = 0; i < bays; i++) {
    const x = -width / 2 + (i + 0.5) * pitch
    const roll = rng()
    if (roll < 0.4) {
      group.add(part(new THREE.BoxGeometry(pitch * 0.86, 0.05, 1.6), awning, [x, storey * 0.74, wall + 0.72], [0.38, 0, 0]))
    } else if (roll < 0.7) {
      const [text, color] = SIGNS[Math.floor(rng() * SIGNS.length)]
      const aspect = (text.length * 0.7 + 1) / 1.25 // of the neon texture
      const signWidth = Math.min(pitch * 0.7, 0.65 * aspect) // no taller than the fascia
      group.add(part(new THREE.PlaneGeometry(signWidth, signWidth / aspect), materials.neon(text, color), [x, storey * 0.88, wall + 0.04]))
    }
  }
  if (rng() < 0.5) {
    const [text, color] = SIGNS[Math.floor(rng() * SIGNS.length)]
    const height = text.length * 0.7 + 0.4
    const x = (rng() < 0.5 ? -1 : 1) * (width / 2 - 0.8)
    const y = storey + 1 + height / 2
    group.add(part(new THREE.BoxGeometry(0.22, height, 0.95), materials.darkSteel(), [x, y, wall + 0.6]))
    for (const side of [-1, 1]) {
      group.add(
        part(new THREE.PlaneGeometry(0.85, height - 0.2), materials.neon(text, color, true), [x + side * 0.115, y, wall + 0.6], [0, (side * Math.PI) / 2, 0]),
      )
    }
    for (const dy of [-height / 2 + 0.3, height / 2 - 0.3]) group.add(part(tube([x, y + dy, wall], [x, y + dy, wall + 0.15], 0.04, 5), materials.darkSteel()))
  }
}

export interface BuildingOptions {
  width: number // along x
  depth: number // along z
  storeys: number // above the shops, if any
  style: FacadeStyle
  seed: number
  shops?: FacadeStyle // ground-floor shopfronts, a storey of their own
  crown?: 'cornice' | 'parapet'
  roof?: Rooftop
  fireEscape?: boolean // on the +Z wall
  balconies?: boolean // on the +Z wall
  burnt?: boolean // gutted: charred roof, broken parapet
}

// A city block building, solid as its whole footprint. userData.height is its top.
export function building(o: BuildingOptions) {
  const rng = createRng(o.seed)
  const group = new THREE.Group()
  const { storey } = FACADES[o.style].rooms
  let base = 0
  if (o.shops) {
    group.add(part(facadeWalls(o.width, o.depth, 1, o.shops, o.seed), materials.facade(o.shops)))
    base = FACADES[o.shops].rooms.storey
    group.add(part(new THREE.BoxGeometry(o.width + 0.3, 0.32, o.depth + 0.3), materials.concrete(), [0, base, 0])) // string course over the shops
    shopDressing(group, o.width, o.depth, o.shops, rng)
  }
  const top = base + o.storeys * storey
  if (o.storeys > 0) group.add(part(facadeWalls(o.width, o.depth, o.storeys, o.style, o.seed + 1).translate(0, base, 0), materials.facade(o.style)))
  group.add(part(new THREE.BoxGeometry(o.width - 0.04, 0.3, o.depth - 0.04), o.burnt ? materials.charred() : materials.roof(), [0, top - 0.15, 0]))
  if (o.burnt) {
    for (let i = 0; i < 6; i++) {
      const side = Math.floor(rng() * 4)
      const along = (rng() - 0.5) * (side % 2 ? o.depth : o.width) * 0.8
      const out = (side % 2 ? o.width : o.depth) / 2 - 0.4
      onWall(
        group,
        side,
        part(
          new THREE.BoxGeometry(1 + rng() * 2, 0.5 + rng() * 1.4, 0.3),
          materials.charred(),
          [along, top + 0.2, out],
          [rng() * 0.3, rng() - 0.5, rng() * 0.5],
        ),
      )
    }
  } else {
    roofline(group, o.width, o.depth, top, o.crown ?? 'parapet')
    rooftop(group, o.width, o.depth, top, o.roof ?? 'bare', rng)
  }
  if (o.fireEscape) fireEscape(group, o.width, o.depth, base, o.storeys, o.style, rng)
  if (o.balconies) balconies(group, o.width, o.depth, base, o.storeys, o.style, rng)
  group.userData.height = top
  return solid(group, { box: [o.width / 2, top / 2, o.depth / 2], at: [0, top / 2, 0] })
}

// Landmark office tower: a lobby and fourteen floors, then two setbacks and a mast.
export function tower(width: number, depth: number, seed: number) {
  const group = new THREE.Group()
  let y = 0
  const sections: Array<[number, number, Rooftop]> = [
    [1, 14, 'bare'],
    [0.8, 8, 'bare'],
    [0.6, 4, 'mast'],
  ]
  sections.forEach(([scale, storeys, roof], i) => {
    const section = building({
      width: width * scale,
      depth: depth * scale,
      storeys,
      style: i === 1 ? 'bronzeGlass' : 'blueGlass',
      seed: seed + i * 5,
      shops: i ? undefined : 'lobby',
      roof,
    })
    section.position.y = y
    group.add(section)
    y += section.userData.height
  })
  group.userData.height = y
  return group
}
