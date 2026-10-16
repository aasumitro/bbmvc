import * as THREE from 'three'
import { mergeByMaterial, part, tube } from '../../render/geometry.ts'
import { facadeClock, type FacadeStyle } from '../../render/materials/facade.ts'
import { LIVERIES, materials } from '../../render/materials/library.ts'
import { createRng } from '../../shared/rng.ts'
import { chunks, clutterKit, collectColliders, navGraph, spreadOut, type Arena, type ArenaCollider, type Area, type Emitter, type SpawnPoint } from './arena.ts'
import { BEACON, building } from './kit/buildings.ts'
import { createGround } from './kit/ground.ts'
import { bollard, CONTAINER, containerKit, fence, floodMast, forklift, gatehouse, ship, straddleCarrier, stsCrane } from './kit/port.ts'
import { jerseyBarrier, pipeBridge, shed, shippingContainer, solid, storageTank } from './kit/props.ts'
import { decal } from './kit/street.ts'

// The Docks: a container terminal at dusk, built for eight cars. North is
// -Z, east +X. The quay runs along the south edge: an apron under three
// ship-to-shore cranes on their rails, a ship moored alongside, the water
// past the quay's edge only to look at. North of the apron lies the yard:
// twelve blocks in three rows between a grid of lanes, each with its own
// trade — rows of stacks, a canyon of empties, reefers on their power racks,
// a tank farm, customs with its scanner, a stack still burning, a forklift
// yard, a transit shed. A road runs along the warehouses that wall the north
// side; fences close the west and east ends, a gate in each, and the crews
// start inside them on the middle lane, a straddle carrier parked where the
// main lane crosses it. Free for all starts round the edges. Beyond, more of
// the terminal, and the city fading into the haze.

const X_EDGE = 118 // the fences, west and east: the drivable limit
const NORTH = -112 // the warehouse fronts
const QUAY = 104 // the quay's edge
const WATER = -2.4 // the harbour, below the quay
const X_LINES = [-109, -50, 0, 50, 109] // north-south: the end roads and the lanes between the block columns
const X_WIDTHS = [18, 14, 18, 14, 18]
const Z_LINES = [-104, -46, 8] // east-west: the warehouse road and the lanes between the block rows
const Z_WIDTHS = [16, 14, 16]
const MIDDLE = Z_LINES[2] // the crews' lane
const APRON = 56 // the yard's south edge: the apron runs from here to the quay
const LANE = 62 // the apron's road along the yard
const UNDER = 83 // the apron's road under the cranes, between their rails
const CRANES = [-60, 0, 60] // their centres along the rails
const RAILS = [70, 96]
const ISLAND = 13 // radius of the ring round the straddle carrier parked on the main lane's crossing
const COLS = X_LINES.slice(0, -1).map((line, i): [number, number] => [line + X_WIDTHS[i] / 2, X_LINES[i + 1] - X_WIDTHS[i + 1] / 2])
const ROWS: Array<[number, number]> = [
  [Z_LINES[0] + Z_WIDTHS[0] / 2, Z_LINES[1] - Z_WIDTHS[1] / 2],
  [Z_LINES[1] + Z_WIDTHS[1] / 2, Z_LINES[2] - Z_WIDTHS[2] / 2],
  [Z_LINES[2] + Z_WIDTHS[2] / 2, APRON],
]

type BlockKind = 'stacks' | 'empties' | 'reefers' | 'tanks' | 'customs' | 'blaze' | 'forklifts' | 'transit'
const BLOCKS: BlockKind[][] = [
  ['tanks', 'stacks', 'customs', 'reefers'], // north row, along the warehouses
  ['stacks', 'empties', 'blaze', 'stacks'],
  ['forklifts', 'stacks', 'transit', 'stacks'], // south row, on the apron
]

// Shipping lines' colours, multiplied into the boxes' pale corrugated steel.
const PAINTS = ['#8e2a1c', '#2d4f73', '#a75a1f', '#3f5a3a', '#c9a43a', '#6b6f73', '#24364d', '#7b3f5e', '#1f6b6b', '#d0ccc2']
const REEFER = '#e4e0d8'
const CHARRED = '#2a2522'
const BRICK: FacadeStyle[] = ['redBrick', 'brownBrick', 'creamBrick']
const UP = new THREE.Vector3(0, 1, 0)

interface Lot {
  x0: number
  x1: number
  z0: number
  z1: number
}

const inset = (lot: Lot, by: number): Lot => ({ x0: lot.x0 + by, x1: lot.x1 - by, z0: lot.z0 + by, z1: lot.z1 - by })
const middle = (lot: Lot): [number, number] => [(lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2]

export function buildDocks(seed = 3): Arena {
  const rng = createRng(seed)
  const between = (a: number, b: number) => a + rng() * (b - a)
  const whole = (a: number, b: number) => Math.floor(between(a, b + 1))
  const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)]
  const root = new THREE.Group()
  root.name = 'docks'
  const colliders: ArenaCollider[] = []
  const emitters: Emitter[] = []
  const scorches: Array<[number, number, number]> = [] // x, z, radius: burnt ground under fires
  const clutter = clutterKit(rng, true, colliders)
  const boxes = containerKit(true) // the yard's: solid as stacks, casting shadows
  const far = containerKit(false, false) // the ship's cargo and the terminal past the fences
  const scenery = chunks(3, 300) // solid props within reach: their shapes are collected
  const flat = chunks(3, 300) // ground paint and light pools: merged apart, casting nothing
  const walls = chunks(3, 640) // past the boundary: warehouses, fences, gates, more cranes
  const backdrop = chunks(2, 1600) // the ship, the water, the city
  const swinging: THREE.Object3D[] = []
  let nextSeed = 1

  const place = <T extends THREE.Object3D>(object: T, x: number, z: number, yaw = 0, y = 0, into = scenery): T => {
    object.position.set(x, y, z)
    object.rotation.y = yaw
    into.at(x, z).add(object)
    return object
  }
  const paint = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, z: number, yaw = 0, y = 0.02) =>
    flat.at(x, z).add(decal(geometry, material, x, z, yaw, y))
  const fire = (x: number, y: number, z: number, scorch = 3) => {
    emitters.push({ kind: 'fire', position: new THREE.Vector3(x, y, z) })
    scorches.push([x, z, scorch])
  }
  const solidBox = (half: [number, number, number], x: number, y: number, z: number, yaw = 0) =>
    colliders.push({ box: new THREE.Vector3(...half), position: new THREE.Vector3(x, y, z), rotation: new THREE.Quaternion().setFromAxisAngle(UP, yaw) })
  const yellowPaint = materials.roadPaint('#b8912a')
  const whitePaint = materials.roadPaint('#c4beb2')
  const pool = materials.glow('#ffb46a', 0.12)

  // --- containers --------------------------------------------------------------

  // A stack of `tiers` boxes, its foot centred at (x, z), its length along
  // x turned by `yaw`; solid as one box.
  function stack(x: number, z: number, yaw: number, long: boolean, tiers: number, color?: string) {
    const length = long ? CONTAINER.long : CONTAINER.short
    for (let t = 0; t < tiers; t++) {
      boxes.add(x + (rng() - 0.5) * 0.1, t * CONTAINER.height, z + (rng() - 0.5) * 0.1, yaw, long, color ?? pick(PAINTS), [0, t ? (rng() - 0.5) * 0.04 : 0, 0])
    }
    solidBox([length / 2, (tiers * CONTAINER.height) / 2, CONTAINER.width / 2], x, (tiers * CONTAINER.height) / 2, z, yaw)
  }

  // Stacks side by side across z at x, filling z0 to z1; a pair left out now
  // and then opens a gap to squeeze through.
  function row(x: number, z0: number, z1: number, long: boolean, tiers: [number, number], color?: () => string) {
    const pitch = CONTAINER.width + 0.16
    const count = Math.floor((z1 - z0) / pitch)
    const first = (z0 + z1) / 2 - ((count - 1) * pitch) / 2
    for (let i = 0; i < count; i++) {
      if (i + 1 < count && rng() < 0.08) {
        i++
        continue
      }
      stack(x, first + i * pitch, 0, long, whole(...tiers), color?.())
    }
  }

  // A 40 ft box knocked over: flat at an odd angle, or rolled onto its side
  // (lying beside where it stood).
  function fallen(x: number, z: number, yaw: number, onSide: boolean, color: string) {
    boxes.add(x, onSide ? CONTAINER.width / 2 : 0, z, yaw, true, color, [onSide ? Math.PI / 2 : 0, 0, 0])
    const [high, deep] = onSide ? [CONTAINER.width, CONTAINER.height] : [CONTAINER.height, CONTAINER.width]
    const aside = onSide ? CONTAINER.height / 2 : 0
    solidBox([CONTAINER.long / 2, high / 2, deep / 2], x + Math.sin(yaw) * aside, high / 2, z + Math.cos(yaw) * aside, yaw)
  }

  // --- starts ------------------------------------------------------------------
  // Free for all round the edges: the warehouse road, the apron's two roads,
  // the end roads, each facing in. The crews line up inside the gates at
  // either end of the middle lane, three rows of two (a crew of four starts
  // on the two outer rows).
  const spawns: SpawnPoint[] = []
  const start = (x: number, z: number, heading: number) => spawns.push({ position: new THREE.Vector3(x, 0, z), heading })
  for (const x of [-84, -28, 28, 84]) {
    start(x, Z_LINES[0], x < 0 ? Math.PI / 2 : -Math.PI / 2)
    start(x, LANE, x < 0 ? Math.PI / 2 : -Math.PI / 2)
  }
  for (const side of [-1, 1]) {
    for (const z of [-75, -20, 36]) start(side * X_LINES[4], z, z < MIDDLE ? 0 : Math.PI)
    start(side * 30, UNDER, (-side * Math.PI) / 2)
  }
  spreadOut(spawns)
  const bases: [SpawnPoint[], SpawnPoint[]] = [[], []]
  for (const [team, side] of [
    [0, -1],
    [1, 1],
  ]) {
    for (const x of [110, 98, 86]) {
      for (const z of [MIDDLE - 4, MIDDLE + 4]) bases[team].push({ position: new THREE.Vector3(side * x, 0, z), heading: (-side * Math.PI) / 2 })
    }
  }
  const keepClear = [...spawns, ...bases[0], ...bases[1]].map((s) => s.position)
  const clearOfStarts = (x: number, z: number, room = 10) => keepClear.every((p) => Math.hypot(p.x - x, p.z - z) > room)

  // --- blocks ------------------------------------------------------------------

  // Rows of 40 ft stacks one to three high down both sides, a cross alley
  // halfway; a 20 ft row down the middle where the block is wide enough.
  function stacks(lot: Lot) {
    const [cx, cz] = middle(lot)
    const alley = 8
    for (const x of [lot.x0 + CONTAINER.long / 2, lot.x1 - CONTAINER.long / 2]) {
      row(x, lot.z0, cz - alley / 2, true, [1, 3])
      row(x, cz + alley / 2, lot.z1, true, [1, 3])
    }
    if (lot.x1 - lot.x0 > 2 * CONTAINER.long + 12) {
      row(cx, lot.z0, cz - alley / 2, false, [1, 2])
      row(cx, cz + alley / 2, lot.z1, false, [1, 2])
    }
  }

  // Empties stacked high: a canyon along x through the middle walled by 20 ft
  // boxes four and five high, lower toward the block's edges, and a gap
  // across halfway along.
  function empties(lot: Lot) {
    const [cx, cz] = middle(lot)
    const pitch = CONTAINER.width + 0.16
    for (const side of [-1, 1]) {
      for (let k = 0; 4 + CONTAINER.width + k * pitch <= (lot.z1 - lot.z0) / 2; k++) {
        const z = cz + side * (4 + CONTAINER.width / 2 + k * pitch)
        for (let x = lot.x0 + CONTAINER.short / 2; x <= lot.x1 - CONTAINER.short / 2; x += CONTAINER.short + 0.3) {
          if (Math.abs(x - cx) < 4.5) continue
          stack(x, z, 0, false, k < 2 ? whole(4, 5) : whole(2, 3))
        }
      }
    }
  }

  // Reefers, two high in rows on their power racks: a gantry over each rack
  // with lamps under it, posts at its ends and in the middle aisle.
  function reefers(lot: Lot) {
    const [cx] = middle(lot)
    const pitch = CONTAINER.width + 0.16
    const span = 6 * pitch
    const width = lot.x1 - lot.x0 + 2
    for (const z0 of [lot.z0, lot.z1 - span]) {
      for (const x of [lot.x0 + CONTAINER.long / 2, lot.x1 - CONTAINER.long / 2]) {
        for (let i = 0; i < 6; i++) stack(x, z0 + pitch / 2 + i * pitch, 0, true, rng() < 0.85 ? 2 : 1, rng() < 0.85 ? REEFER : pick(PAINTS))
      }
      const rack = new THREE.Group()
      rack.add(part(new THREE.BoxGeometry(width, 0.5, 0.7), materials.steel(), [0, 6.6, 0]))
      for (const x of [-width / 2, 0, width / 2]) rack.add(solid(part(new THREE.BoxGeometry(0.45, 6.6, 0.45), materials.steel(), [x, 3.3, 0])))
      for (let x = -width / 2 + 3; x < width / 2 - 1; x += 6) rack.add(part(new THREE.BoxGeometry(1.2, 0.2, 0.5), materials.light('#ffe4b8', 5), [x, 6.25, 0]))
      place(rack, cx, z0 + span / 2)
    }
  }

  // Tank farm: three tanks, a pipe rack bridging the warehouse road, drums by the lane.
  function tanks(lot: Lot) {
    for (const [x, z, radius, height, color] of [
      [lot.x0 + 9, lot.z0 + 9, 8, 10, '#9a948a'],
      [lot.x1 - 8, lot.z0 + 11, 6.5, 8, '#7c6a52'],
      [lot.x0 + 10, lot.z1 - 8, 6, 7.5, '#9a948a'],
    ] as Array<[number, number, number, number, string]>) {
      place(storageTank(radius, height, color), x, z, rng() * Math.PI * 2)
    }
    place(pipeBridge(16, 7), lot.x0 + 9, Z_LINES[0], Math.PI / 2)
    clutter.drums(lot.x1 - 4, lot.z1 - 4, 6)
  }

  // Customs: the inspection shed open to the block, a scanner portal over
  // the way in from the lane, the officers' cabins, barriers for the queue.
  function customs(lot: Lot) {
    const [cx, cz] = middle(lot)
    place(shed(28, 11, 7), cx, lot.z0 + 6, 0)
    const portal = new THREE.Group()
    for (const x of [-3.6, 3.6]) portal.add(solid(part(new THREE.BoxGeometry(0.9, 6.2, 1.6), materials.bodywork('#d9d4c8'), [x, 3.1, 0])))
    portal.add(part(new THREE.BoxGeometry(8.1, 1.2, 1.8), materials.bodywork('#d9d4c8'), [0, 6.8, 0]))
    portal.add(part(new THREE.BoxGeometry(6, 0.15, 0.4), materials.light('#ff5a3b', 5), [0, 6.1, 0.6]))
    for (const side of [-1, 1])
      portal.add(part(new THREE.PlaneGeometry(4, 0.9), materials.neon('CUSTOMS', '#ffb03b'), [0, 6.8, side * 0.91], [0, side > 0 ? 0 : Math.PI, 0]))
    place(portal, cx, lot.z1 - 5, 0)
    const cabins = new THREE.Group()
    cabins.add(shippingContainer('#c2c0b8').translateZ(-1.25), shippingContainer('#2c4a63').translateZ(1.25), shippingContainer('#c2c0b8').translateY(2.6))
    place(cabins, lot.x0 + 4, lot.z1 - 8, Math.PI / 2)
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) place(jerseyBarrier(), cx + side * 6, cz + 1 + i * 3.1, Math.PI / 2)
    stack(lot.x1 - CONTAINER.long / 2, lot.z1 - 3, 0, true, 2)
    stack(lot.x1 - CONTAINER.long / 2, lot.z1 - 3 - CONTAINER.width - 0.16, 0, true, 1)
  }

  // A stack fire: a row along the west side, boxes knocked over and burnt
  // black, one still standing and burning; smoke over it all.
  function blaze(lot: Lot) {
    row(lot.x0 + CONTAINER.long / 2, lot.z0, lot.z1, true, [2, 3])
    const [cx, cz] = middle(lot)
    fallen(cx + 6, cz - 10.5, 0.25, false, CHARRED)
    fallen(cx + 9, cz + 2.5, -1.3, true, CHARRED)
    fallen(cx + 3, cz + 12.5, 1.45, false, pick(PAINTS))
    stack(cx + 1, cz - 0.5, 0, false, 2, CHARRED)
    fire(cx + 6, 2.8, cz - 10.5)
    fire(cx + 8, 2.6, cz + 2.5)
    fire(cx + 1, 5.4, cz - 0.5, 4)
    fire(cx + 12, 0.6, cz + 13, 2)
    emitters.push({ kind: 'plume', position: new THREE.Vector3(cx + 4, 24, cz) })
    fireLight.position.set(cx + 4, 5, cz + 1)
  }

  // Forklift yard: single boxes set down at odd angles, forklifts among
  // them, a straddle carrier waiting, drums and tyres.
  function forklifts(lot: Lot) {
    const [cx, cz] = middle(lot)
    for (const [dx, dz, yaw, long] of [
      [-12, -10, 0.3, true],
      [8, -12, -0.4, false],
      [-4, 3, 1.2, true],
      [12, 5, 0.1, true],
      [-14, 11, -0.7, false],
      [3, 13, 0.5, false],
    ] as Array<[number, number, number, boolean]>) {
      stack(cx + dx, cz + dz, yaw, long, 1)
    }
    for (const [dx, dz, yaw] of [
      [-2, -15, 0.2],
      [7, -2, 2],
      [-16, 0, -0.4],
      [15, -6, 3],
    ]) {
      place(forklift(), cx + dx, cz + dz, yaw)
    }
    place(straddleCarrier(pick(PAINTS)), cx + 10, lot.z1 - 4, 0)
    clutter.drums(lot.x0 + 3, lot.z0 + 3, 5)
    clutter.tyreStack(lot.x1 - 3, lot.z0 + 4, 4)
  }

  // Transit shed: a long brick warehouse along the back of the block, a
  // loading dock in front, trailers backed up to it (their axles at the
  // dock, their legs down at the front).
  function transit(lot: Lot) {
    const [cx] = middle(lot)
    const depth = 18
    const width = lot.x1 - lot.x0
    place(building({ width, depth, storeys: 2, style: pick(BRICK), seed: nextSeed++, crown: 'cornice', roof: 'plant' }), cx, lot.z0 + depth / 2)
    place(solid(part(new THREE.BoxGeometry(width, 1.2, 3), materials.concrete(), [0, 0.6, 0])), cx, lot.z0 + depth + 1.5)
    for (const dx of [-8, 5]) {
      const [x, z] = [cx + dx, lot.z0 + depth + 3 + 6.6]
      const trailer = new THREE.Group()
      trailer.add(part(new THREE.BoxGeometry(12.6, 0.3, 2.3), materials.darkSteel(), [0, 1.05, 0]))
      for (const ax of [3.4, 4.6])
        for (const az of [-0.85, 0.85])
          trailer.add(part(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12), materials.rubber(), [ax, 0.5, az], [Math.PI / 2, 0, 0]))
      for (const az of [-0.9, 0.9]) trailer.add(part(new THREE.BoxGeometry(0.16, 0.9, 0.16), materials.darkSteel(), [-3.6, 0.45, az]))
      place(solid(trailer, { box: [6.3, 1.9, 1.25], at: [0, 1.9, 0] }), x, z, Math.PI / 2)
      boxes.add(x, 1.2, z, Math.PI / 2, true, pick(PAINTS))
    }
  }

  const fireLight = new THREE.PointLight('#ff6a24', 700, 34, 2)
  root.add(fireLight)

  const build: Record<BlockKind, (lot: Lot) => void> = { stacks, empties, reefers, tanks, customs, blaze, forklifts, transit }
  ROWS.forEach(([z0, z1], row) => COLS.forEach(([x0, x1], col) => build[BLOCKS[row][col]](inset({ x0, x1, z0, z1 }, 2))))

  // --- lanes -------------------------------------------------------------------
  // Yellow lines along every lane's edges, light masts and their pools, boxes
  // set down and barriers on the middle lane (so the bases don't see each
  // other down it), a straddle carrier parked on its crossing, burnt-out cars
  // along the warehouse road and the end roads.
  for (const [i, x] of X_LINES.entries()) {
    if (i === 0 || i === 4) continue
    for (const side of [-1, 1]) {
      for (const [z0, z1] of [[ROWS[0][0], APRON]])
        paint(new THREE.PlaneGeometry(0.15, z1 - z0), yellowPaint, x + side * (X_WIDTHS[i] / 2 - 0.4), (z0 + z1) / 2)
    }
  }
  for (const [i, z] of Z_LINES.entries()) {
    for (const side of [-1, 1]) {
      if (i === 0 && side < 0) continue
      paint(new THREE.PlaneGeometry(0.15, 2 * X_EDGE), yellowPaint, 0, z + side * (Z_WIDTHS[i] / 2 - 0.4), Math.PI / 2)
    }
  }
  paint(new THREE.PlaneGeometry(0.15, 2 * X_EDGE), yellowPaint, 0, APRON + 0.4, Math.PI / 2)
  for (let x = -X_EDGE + 4; x < X_EDGE - 4; x += 8) {
    paint(new THREE.PlaneGeometry(0.15, 4), whitePaint, x, LANE, Math.PI / 2)
    paint(new THREE.PlaneGeometry(0.15, 4), whitePaint, x, UNDER, Math.PI / 2)
  }
  for (const [x, z] of [
    [-96, 58.5],
    [-40, 58.5],
    [20, 58.5],
    [76, 58.5],
    [-80, NORTH + 1.5],
    [-20, NORTH + 1.5],
    [40, NORTH + 1.5],
    [100, NORTH + 1.5],
  ]) {
    place(floodMast(22), x, z)
    paint(new THREE.PlaneGeometry(28, 28), pool, x, z + (z < 0 ? 8 : 4), 0, 0.03)
  }
  for (const [x, z, long] of [
    [-75, MIDDLE + 4.3, false],
    [-30, MIDDLE - 4.3, false],
    [30, MIDDLE + 4.3, false],
    [75, MIDDLE - 4.3, false],
  ] as Array<[number, number, boolean]>) {
    stack(x, z, 0, long, 1)
  }
  place(straddleCarrier(pick(PAINTS)), 0, MIDDLE, 0)
  for (const [x, z] of [
    [-60, -109.5],
    [5, -109.5],
    [70, -109.5],
    [-114.5, -40],
    [114.5, 50],
  ]) {
    if (!clearOfStarts(x, z)) continue
    clutter.wreck(x, 0, z, 0.1, true, Math.abs(x) > 100 ? (rng() < 0.5 ? 0 : Math.PI) : Math.PI / 2 + (rng() - 0.5) * 0.3)
  }
  fire(5, 1.1, -109.5, 4)

  // --- the quay ----------------------------------------------------------------
  // The cranes on their rails, boxes staged under them, straddle carriers
  // between, bollards along the edge; the quay wall, the ship moored to it
  // and the water beyond.
  for (const [i, x] of CRANES.entries()) {
    const { structure, spreader, trolley } = stsCrane(i === 1 ? LIVERIES.hazard.paint : LIVERIES.crimson.paint, i === 2 ? pick(PAINTS) : undefined)
    place(structure, x, UNDER)
    structure.updateMatrixWorld()
    spreader.position.set(...trolley).applyMatrix4(structure.matrixWorld)
    swinging.push(spreader)
    paint(new THREE.PlaneGeometry(22, 30), pool, x, UNDER, 0, 0.03)
    stack(x - 5, RAILS[0] + 6, 0, false, rng() < 0.4 ? 2 : 1)
    stack(x + 5, RAILS[1] - 6, 0, false, 1)
  }
  for (const x of [-30, 30]) place(straddleCarrier(pick(PAINTS)), x, RAILS[1] - 4, 0)
  for (const z of RAILS) paint(new THREE.PlaneGeometry(0.3, 1400), materials.darkSteel(), 0, z, Math.PI / 2, 0.025)
  paint(new THREE.PlaneGeometry(0.4, 1400), yellowPaint, 0, QUAY - 0.6, Math.PI / 2)
  for (let x = -X_EDGE + 4; x < X_EDGE; x += 12) place(bollard(), x, QUAY - 1.5)

  const quay = new THREE.Group()
  quay.add(part(new THREE.BoxGeometry(1400, 3.4, 1), materials.concrete(), [0, -1.7, 0.5]))
  quay.add(part(new THREE.BoxGeometry(1400, 0.3, 0.7), materials.concrete(), [0, 0.15, 0.35]))
  for (let x = -690; x <= 690; x += 15) quay.add(part(new THREE.CylinderGeometry(0.45, 0.45, 2.2, 10), materials.rubber(), [x, -1.2, 1.25]))
  place(quay, 0, QUAY, 0, 0, walls)
  const berth: [number, number, number] = [0, WATER, QUAY + 2 + 14]
  place(ship(far, berth, rng, PAINTS), berth[0], berth[2], 0, berth[1], backdrop)
  for (const [x, to] of [
    [-76, -68],
    [-52, -60],
    [52, 44],
    [76, 70],
  ]) {
    place(part(tube([x, 0.75, QUAY - 1.5], [to, WATER + 8.6, QUAY + 2.1], 0.05, 5), materials.darkSteel()), 0, 0, 0, 0, walls)
  }
  place(part(new THREE.PlaneGeometry(1600, 900).rotateX(-Math.PI / 2), materials.water()), 0, QUAY + 450, 0, WATER, backdrop)
  // a breakwater across the harbour mouth, its light at the end
  const breakwater = new THREE.Group()
  breakwater.add(part(new THREE.BoxGeometry(700, 4.5, 12), materials.concrete(), [350, 0, 0]))
  breakwater.add(part(new THREE.CylinderGeometry(2, 2.4, 14, 16), materials.bodywork('#d8d2c4'), [0, 7, 0]))
  breakwater.add(part(new THREE.CylinderGeometry(2.05, 2.1, 1.6, 16), materials.bodywork('#8e1d15'), [0, 10, 0]))
  breakwater.add(part(new THREE.SphereGeometry(0.9, 12, 8), BEACON, [0, 14.8, 0]))
  place(breakwater, -120, QUAY + 420, 0, WATER, backdrop)

  // --- boundary ----------------------------------------------------------------
  // Warehouses wall the north side, facing the road; fences close the ends,
  // a gate where the middle lane meets each; an invisible wall just behind
  // keeps everything in, and another along the quay's edge.
  for (let x = -190; x < 190;) {
    const width = between(24, 40)
    const depth = between(22, 32)
    place(
      building({
        width: width - 0.6,
        depth,
        storeys: whole(3, 5),
        style: pick(BRICK),
        seed: nextSeed++,
        crown: 'cornice',
        roof: pick(['tank', 'plant', 'bare'] as const),
        fireEscape: rng() < 0.35,
      }),
      x + width / 2,
      NORTH - depth / 2,
      0,
      0,
      walls,
    )
    x += width
  }
  for (const side of [-1, 1]) {
    for (const [a, b] of [
      [NORTH, MIDDLE - 8],
      [MIDDLE + 8, QUAY],
    ]) {
      place(fence(b - a), side * (X_EDGE + 1), (a + b) / 2, (-side * Math.PI) / 2, 0, walls)
    }
    place(gatehouse(14), side * (X_EDGE + 3), side < 0 ? MIDDLE + 10 : MIDDLE - 10, (-side * Math.PI) / 2, 0, walls)
    for (const dz of [-6, -3, 0, 3]) place(jerseyBarrier(), side * (X_EDGE + 6), MIDDLE + dz + 1.5, Math.PI / 2, 0, walls)
  }
  for (const [x, z, hx, hz] of [
    [0, NORTH - 1.5, X_EDGE + 10, 0.5],
    [0, QUAY + 0.5, X_EDGE + 10, 0.5],
    [-(X_EDGE + 1.5), (NORTH + QUAY) / 2, 0.5, (QUAY - NORTH) / 2 + 10],
    [X_EDGE + 1.5, (NORTH + QUAY) / 2, 0.5, (QUAY - NORTH) / 2 + 10],
  ]) {
    colliders.push({ box: new THREE.Vector3(hx, 6, hz), position: new THREE.Vector3(x, 6, z), rotation: new THREE.Quaternion() })
  }

  // Floodlights over the crews' starts.
  for (const side of [-1, 1]) {
    const flood = new THREE.SpotLight('#ffd9a8', 1100, 70, 0.42, 0.6, 2)
    flood.position.set(side * (X_EDGE + 1), 18, MIDDLE)
    flood.target.position.set(side * 92, 0, MIDDLE)
    root.add(flood, flood.target)
  }

  // --- beyond --------------------------------------------------------------------
  // The terminal runs on past the fences: stacks to the haze (a road kept
  // clear from each gate), more cranes along the quay; the city behind the
  // warehouses, taller to the north, with smoke from its fires.
  for (const side of [-1, 1]) {
    for (let x = X_EDGE + 8; x < 280; x += CONTAINER.long + 5) {
      for (let z = NORTH + 10; z < APRON; z += CONTAINER.width + 0.16) {
        if (Math.abs(z - MIDDLE) < 10 || rng() < 0.12) continue
        const tiers = whole(1, 4)
        for (let t = 0; t < tiers; t++) far.add(side * (x + CONTAINER.long / 2), t * CONTAINER.height, z, 0, true, pick(PAINTS))
      }
    }
    for (const x of [190, 265]) place(stsCrane().structure, side * x, UNDER, 0, 0, walls)
    place(floodMast(24), side * 160, MIDDLE + 14, 0, 0, walls)
  }
  for (let a = -7; a < 7; a++) {
    for (let b = -10; b < -3; b++) {
      const lot: Lot = { x0: a * 56 + 7, x1: (a + 1) * 56 - 7, z0: b * 56 + 7, z1: (b + 1) * 56 - 7 }
      const [cx, cz] = middle(lot)
      const count = whole(1, 3)
      for (let k = 0; k < count; k++) {
        const w = (lot.x1 - lot.x0) / count
        const storeys = cz < -330 && Math.abs(cx) < 250 ? whole(12, 40) : whole(4, 12)
        const style = storeys > 16 ? pick(['blueGlass', 'bronzeGlass'] as const) : pick([...BRICK, 'greyPanel', 'beigePanel'] as const)
        const tall = building({ width: w - 1, depth: lot.z1 - lot.z0 - between(0, 12), storeys, style, seed: nextSeed++, roof: storeys > 25 ? 'mast' : 'bare' })
        place(tall, lot.x0 + w * (k + 0.5), cz, 0, 0, backdrop)
      }
    }
  }
  for (const [x, z] of [
    [-240, -400],
    [310, -330],
  ]) {
    emitters.push({ kind: 'plume', position: new THREE.Vector3(x, 30, z) })
  }

  // --- ground ------------------------------------------------------------------
  // It stops at the quay's edge, where the wall drops to the water.
  const ground = createGround({
    size: 1500,
    layoutExtent: 2 * (X_EDGE + 12),
    surface: materials.asphalt(),
    paintLayout: (tint, wet) => paintDocks(tint, wet, rng, scorches),
  })
  ground.position.z = QUAY - 750
  root.add(ground)

  // Physics footprint of the scenery, then everything merged down.
  for (const group of scenery.groups) collectColliders(group, colliders)
  const merge = (groups: THREE.Group[], castShadow: boolean, receiveShadow = true) =>
    groups
      .filter((group) => group.children.length)
      .map((group) => {
        const merged = mergeByMaterial(group)
        merged.children.forEach((mesh) => {
          mesh.castShadow &&= castShadow
          mesh.receiveShadow = receiveShadow
        })
        return merged
      })
  root.add(
    ...merge(scenery.groups, true),
    ...merge(walls.groups, true),
    ...merge(flat.groups, false),
    ...merge(backdrop.groups, false, false),
    ...swinging,
    ...clutter.build(),
    ...boxes.build(),
    ...far.build(),
  )

  // --- bots' roads -------------------------------------------------------------
  // Every lane and road, stopping at the crossings and halfway between; the
  // apron's two roads joined between the cranes; a ring of four round the
  // carrier on the main lane's crossing.
  const points: Array<[number, number]> = []
  const pairs: Array<[number, number]> = []
  const index = new Map<string, number>()
  const node = (x: number, z: number) => {
    const key = `${x.toFixed(1)},${z.toFixed(1)}`
    if (!index.has(key)) {
      index.set(key, points.length)
      points.push([x, z])
    }
    return index.get(key)!
  }
  const chain = (stops: Array<[number, number]>) => stops.forEach(([x, z], i) => i && pairs.push([node(...stops[i - 1]), node(x, z)]))
  const alongZ = [Z_LINES[0], -75, Z_LINES[1], -19.5, MIDDLE, 36, LANE]
  const alongX = [-109, -79, -50, -25, 0, 25, 50, 79, 109]
  for (const x of X_LINES) {
    if (x !== 0) chain(alongZ.map((z) => [x, z]))
    else {
      chain(
        alongZ
          .filter((z) => z < MIDDLE)
          .map((z): [number, number] => [0, z])
          .concat([[0, MIDDLE - ISLAND]]),
      )
      chain([[0, MIDDLE + ISLAND], ...alongZ.filter((z) => z > MIDDLE).map((z): [number, number] => [0, z])])
    }
  }
  for (const z of Z_LINES) {
    if (z !== MIDDLE) chain(alongX.map((x) => [x, z]))
    else {
      chain(
        alongX
          .filter((x) => x < 0)
          .map((x): [number, number] => [x, z])
          .concat([[-ISLAND, z]]),
      )
      chain([[ISLAND, z], ...alongX.filter((x) => x > 0).map((x): [number, number] => [x, z])])
    }
  }
  const ring: Array<[number, number]> = [
    [-ISLAND, MIDDLE],
    [0, MIDDLE - ISLAND],
    [ISLAND, MIDDLE],
    [0, MIDDLE + ISLAND],
  ]
  ring.forEach((at, k) => pairs.push([node(...at), node(...ring[(k + 1) % 4])]))
  chain([-109, -84, -50, -30, 0, 30, 50, 84, 109].map((x) => [x, LANE]))
  chain([-109, -84, -60, -30, 0, 30, 60, 84, 109].map((x) => [x, UNDER]))
  for (const x of [-109, -84, -30, 30, 84, 109]) pairs.push([node(x, LANE), node(x, UNDER)])

  // Free-for-all hot zones: a berth under each crane, and the blocks with a trade of their own.
  const [west, , , east] = COLS.map(([a, b]) => (a + b) / 2)
  const [north, inner, south] = ROWS.map(([a, b]) => (a + b) / 2)
  const zones: Area[] = [
    { name: 'The Quay', x: 0, z: 80, radius: 34 },
    { name: 'West Berth', x: -70, z: 80, radius: 34 },
    { name: 'East Berth', x: 70, z: 80, radius: 34 },
    { name: 'Tank Farm', x: west, z: north, radius: 40 },
    { name: 'Customs', x: 26, z: north, radius: 38 },
    { name: 'Reefer Rows', x: east, z: north, radius: 40 },
    { name: 'The Canyon', x: -26, z: inner, radius: 36 },
    { name: 'The Fire', x: 26, z: inner, radius: 36 },
    { name: 'Forklift Yard', x: west, z: south, radius: 40 },
    { name: 'Transit Shed', x: 26, z: south, radius: 38 },
  ]

  return {
    name: 'The Docks',
    root,
    spawns,
    bases,
    zones,
    colliders,
    nav: navGraph(points, pairs),
    emitters,
    extent: X_EDGE + 8,
    mapRange: 78,
    paintMap(ctx) {
      ctx.fillStyle = 'rgba(64, 52, 43, 0.75)'
      ctx.fillRect(-X_EDGE, NORTH, 2 * X_EDGE, QUAY - NORTH)
      ctx.fillStyle = 'rgba(38, 60, 70, 0.6)'
      ctx.fillRect(-X_EDGE - 30, QUAY, 2 * X_EDGE + 60, 40)
      ctx.strokeStyle = 'rgba(150, 128, 102, 0.45)'
      X_LINES.forEach((line, i) => {
        ctx.lineWidth = X_WIDTHS[i]
        ctx.beginPath()
        ctx.moveTo(line, NORTH)
        ctx.lineTo(line, APRON)
        ctx.stroke()
      })
      Z_LINES.forEach((line, i) => {
        ctx.lineWidth = Z_WIDTHS[i]
        ctx.beginPath()
        ctx.moveTo(-X_EDGE, line)
        ctx.lineTo(X_EDGE, line)
        ctx.stroke()
      })
      ctx.fillStyle = 'rgba(150, 128, 102, 0.45)'
      ctx.fillRect(-X_EDGE, APRON, 2 * X_EDGE, QUAY - APRON)
    },
    update(time) {
      facadeClock.value = time
      BEACON.emissiveIntensity = time % 1.6 < 0.25 ? 9 : 0.15
      fireLight.intensity = 700 * (0.75 + 0.25 * Math.sin(time * 11) * Math.sin(time * 6.3 + 1))
      swinging.forEach((spreader, i) => {
        spreader.rotation.x = Math.sin(time * 0.27 + i) * 0.02
        spreader.rotation.z = Math.sin(time * 0.21 + i * 2) * 0.015
      })
    },
  }
}

// Macro look of the ground, in world metres: the apron's concrete paler than
// the yard's asphalt, the blocks' slabs between, patched lanes, oil and rust
// under the stacks, scorch marks under the fires; water standing along the
// lanes' edges, in the rails' grooves and in the apron's dips.
function paintDocks(tint: CanvasRenderingContext2D, wet: CanvasRenderingContext2D, rng: () => number, scorches: Array<[number, number, number]>) {
  const reach = X_EDGE + 12
  const blob = (ctx: CanvasRenderingContext2D, x: number, z: number, rx: number, rz: number) => {
    ctx.beginPath()
    ctx.ellipse(x, z, rx, rz, rng() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  tint.fillStyle = 'rgb(150,146,140)'
  tint.fillRect(-reach, APRON, 2 * reach, QUAY - APRON)
  tint.fillStyle = 'rgb(136,132,126)'
  for (const [z0, z1] of ROWS) for (const [x0, x1] of COLS) tint.fillRect(x0, z0, x1 - x0, z1 - z0)
  // patches of newer and older surfacing along the lanes
  for (let i = 0; i < 160; i++) {
    const alongZ = rng() < 0.5
    const line = alongZ ? X_LINES[Math.floor(rng() * X_LINES.length)] : Z_LINES[Math.floor(rng() * Z_LINES.length)]
    const along = (rng() * 2 - 1) * reach
    const [w, l] = [2 + rng() * 6, 3 + rng() * 14]
    tint.fillStyle = rng() < 0.5 ? 'rgb(112,112,112)' : 'rgb(146,144,140)'
    if (alongZ) tint.fillRect(line + (rng() - 0.5) * 12 - w / 2, along - l / 2, w, l)
    else tint.fillRect(along - l / 2, line + (rng() - 0.5) * 12 - w / 2, l, w)
  }
  // oil and rust where the boxes stand and the machines park
  for (let i = 0; i < 500; i++) {
    const [x0, x1] = COLS[Math.floor(rng() * COLS.length)]
    const [z0, z1] = ROWS[Math.floor(rng() * ROWS.length)]
    tint.fillStyle = rng() < 0.6 ? 'rgba(40,38,36,0.35)' : 'rgba(96,58,36,0.3)'
    blob(tint, x0 + rng() * (x1 - x0), z0 + rng() * (z1 - z0), 0.4 + rng() * 1.6, 0.3 + rng() * 1.2)
  }
  for (let i = 0; i < 160; i++) {
    tint.fillStyle = 'rgba(40,38,36,0.3)'
    blob(tint, (rng() * 2 - 1) * reach, APRON + rng() * (QUAY - APRON), 0.4 + rng() * 2, 0.3 + rng() * 1)
  }
  // scorched ground under everything burning
  for (const [x, z, radius] of scorches) {
    const burn = tint.createRadialGradient(x, z, 0, x, z, radius)
    burn.addColorStop(0, 'rgba(10,8,7,0.85)')
    burn.addColorStop(1, 'rgba(10,8,7,0)')
    tint.fillStyle = burn
    tint.fillRect(x - radius, z - radius, 2 * radius, 2 * radius)
  }

  // damp along the lanes' edges, the rails' grooves, puddles
  wet.lineWidth = 1.2
  wet.strokeStyle = 'rgba(150,150,150,0.8)'
  for (const [z0, z1] of ROWS) for (const [x0, x1] of COLS) wet.strokeRect(x0 - 0.4, z0 - 0.4, x1 - x0 + 0.8, z1 - z0 + 0.8)
  wet.lineWidth = 0.5
  wet.strokeStyle = 'rgba(220,220,220,0.9)'
  for (const z of RAILS) {
    wet.beginPath()
    wet.moveTo(-reach, z)
    wet.lineTo(reach, z)
    wet.stroke()
  }
  wet.fillStyle = '#fff'
  for (let i = 0; i < 180; i++) {
    const roll = rng()
    if (roll < 0.45) {
      const x = X_LINES[Math.floor(rng() * X_LINES.length)] + (rng() - 0.5) * 12
      blob(wet, x, NORTH + rng() * (APRON - NORTH), 0.5 + rng() * 1.6, 0.5 + rng() * 3)
    } else if (roll < 0.8) {
      const z = Z_LINES[Math.floor(rng() * Z_LINES.length)] + (rng() - 0.5) * 12
      blob(wet, (rng() * 2 - 1) * X_EDGE, z, 0.5 + rng() * 3, 0.5 + rng() * 1.6)
    } else {
      blob(wet, (rng() * 2 - 1) * X_EDGE, APRON + 4 + rng() * (QUAY - APRON - 8), 1 + rng() * 3.5, 0.6 + rng() * 2.4)
    }
  }
}
