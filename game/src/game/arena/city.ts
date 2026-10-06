import * as THREE from 'three'
import { mergeByMaterial, part, tube } from '../geometry'
import { facadeClock, type FacadeStyle } from '../materials/facade'
import { materials } from '../materials/library'
import { createRng } from '../rng'
import { chunks, clutterKit, collectColliders, navGraph, spreadOut, type Arena, type ArenaCollider, type Area, type Emitter, type SpawnPoint } from './arena'
import { BEACON, building, tower, type BuildingOptions } from './buildings'
import { createGround } from './ground'
import { iBeam, jerseyBarrier, junkMound, lampPost, shed, shippingContainer, solid } from './props'
import { bench, billboard, bus, busShelter, canopy, concreteFrame, decal, dumpster, hoarding, hydrant, planter, pump, towerCrane, trafficSignal, tree, type SignalLamps } from './street'

// The City: a burning downtown at dusk, built for eight cars. North is -Z,
// east +X. Five streets each way cut it into sixteen blocks: Main Avenue and
// Market Street (24 m) cross at a monument plaza in the middle, secondary
// streets (14 m) run between, and a perimeter road (16 m) rings it, walled in
// by buildings that face inward. The streets that would run on out are
// barricaded. Beyond, the same grid carries on as a lit skyline sinking into
// the haze.
//
// Blocks sit on raised sidewalks; each has a theme — tenements with alleys,
// panel housing, glass offices, a tower, a park, a building site, a gutted
// ruin still burning, a petrol station, a parking lot, a bus depot.

const LINES = [-110, -56, 0, 56, 110] // street centre lines, the same on both axes
const WIDTHS = [16, 14, 24, 14, 16]
const THROUGH = [1, 2, 3] // lines whose streets run out through the boundary, barricaded
const SIDEWALK = 3
const KERB = 0.15 // sidewalk height
const EDGE = 121 // back of the outer sidewalk: the drivable limit
const RING = 161 // outside face of the boundary buildings
const PLAZA = 13 // radius of the roundabout around the monument
const SPANS = LINES.slice(0, -1).map((line, i): [number, number] => [line + WIDTHS[i] / 2, LINES[i + 1] - WIDTHS[i + 1] / 2]) // blocks between neighbouring lines

type BlockKind = 'mixed' | 'gas' | 'parking' | 'park' | 'tower' | 'ruin' | 'warehouse' | 'court' | 'site' | 'panels' | 'depot'
const BLOCKS: BlockKind[][] = [
  ['gas', 'mixed', 'mixed', 'parking'], // north row
  ['mixed', 'park', 'tower', 'ruin'],
  ['warehouse', 'court', 'site', 'mixed'],
  ['panels', 'mixed', 'mixed', 'depot'],
]

interface Lot {
  x0: number
  x1: number
  z0: number
  z1: number
}

const inset = (lot: Lot, by: number): Lot => ({ x0: lot.x0 + by, x1: lot.x1 - by, z0: lot.z0 + by, z1: lot.z1 - by })
const middle = (lot: Lot): [number, number] => [(lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2]

const BRICK: FacadeStyle[] = ['redBrick', 'brownBrick', 'creamBrick']
const PANEL: FacadeStyle[] = ['greyPanel', 'beigePanel']
const GLASS: FacadeStyle[] = ['blueGlass', 'bronzeGlass']
const SHOPS: FacadeStyle[] = ['shops', 'redShops']
const DUMPSTERS = ['#2e4636', '#5a3b1c', '#2b3a4d']

export function buildCity(seed = 7): Arena {
  const rng = createRng(seed)
  const between = (a: number, b: number) => a + rng() * (b - a)
  const whole = (a: number, b: number) => Math.floor(between(a, b + 1))
  const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)]
  const root = new THREE.Group()
  root.name = 'city'
  const colliders: ArenaCollider[] = []
  const emitters: Emitter[] = []
  const scorches: Array<[number, number, number]> = [] // x, z, radius: burnt ground under fires
  const clutter = clutterKit(rng, true, colliders)
  const scenery = chunks(3, 2 * RING)
  const flat = chunks(3, 2 * RING) // ground paint and light pools: merged apart, casting nothing
  const skyline = chunks(2, 1000)
  const swinging: THREE.Object3D[] = []
  let nextSeed = 1

  const place = <T extends THREE.Object3D>(object: T, x: number, z: number, yaw = 0, y = 0, into = scenery): T => {
    object.position.set(x, y, z)
    object.rotation.y = yaw
    into.at(x, z).add(object)
    return object
  }
  const paint = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, z: number, yaw = 0, y = 0.02) => flat.at(x, z).add(decal(geometry, material, x, z, yaw, y))
  const fire = (x: number, y: number, z: number, scorch = 3) => {
    emitters.push({ kind: 'fire', position: new THREE.Vector3(x, y, z) })
    scorches.push([x, z, scorch])
  }
  const whitePaint = materials.roadPaint('#c4beb2')
  const yellowPaint = materials.roadPaint('#b8912a')
  const pool = materials.glow('#ffb46a', 0.12)

  // --- starts ----------------------------------------------------------------
  // Free-for-all starts on the perimeter road, facing along it; the crews'
  // bases hold the two ends of Main Avenue, three rows of two (a crew of
  // four starts on the two outer rows).
  const spawns: SpawnPoint[] = []
  for (const along of [-83, -28, 28, 83]) {
    const inward = along < 0 ? 1 : -1
    spawns.push(
      { position: new THREE.Vector3(along, 0, 110), heading: (inward * Math.PI) / 2 },
      { position: new THREE.Vector3(along, 0, -110), heading: (inward * Math.PI) / 2 },
      { position: new THREE.Vector3(110, 0, along), heading: inward > 0 ? 0 : Math.PI },
      { position: new THREE.Vector3(-110, 0, along), heading: inward > 0 ? 0 : Math.PI },
    )
  }
  spreadOut(spawns)
  const bases: [SpawnPoint[], SpawnPoint[]] = [[], []]
  for (const [team, side] of [
    [0, -1],
    [1, 1],
  ]) {
    for (const [x, back] of [
      [-5, 100],
      [5, 100],
      [-5, 88],
      [5, 88],
      [-5, 76],
      [5, 76],
    ]) {
      bases[team].push({ position: new THREE.Vector3(x, 0, side * back), heading: side < 0 ? 0 : Math.PI })
    }
  }
  const keepClear = [...spawns, ...bases[0], ...bases[1]].map((s) => s.position) // no parked cars here: starts, alley mouths
  const clearOfStarts = (x: number, z: number, room = 10) => keepClear.every((p) => Math.hypot(p.x - x, p.z - z) > room)

  // --- buildings ---------------------------------------------------------------

  // A random building for a width x depth plot: brick tenements over shops
  // most often, then panel housing, then glass offices over their lobbies.
  function randomBuilding(width: number, depth: number, tall = 1): BuildingOptions {
    const roll = rng()
    const seed = nextSeed++
    if (roll < 0.55) {
      return { width, depth, seed, style: pick(BRICK), storeys: Math.round(whole(3, 7) * tall), shops: rng() < 0.75 ? pick(SHOPS) : undefined, crown: 'cornice', roof: rng() < 0.6 ? 'tank' : 'plant', fireEscape: rng() < 0.75 }
    }
    if (roll < 0.8) {
      return { width, depth, seed, style: pick(PANEL), storeys: Math.round(whole(5, 10) * tall), shops: rng() < 0.3 ? pick(SHOPS) : undefined, crown: 'parapet', roof: 'plant', balconies: rng() < 0.7 }
    }
    return { width, depth, seed, style: pick(GLASS), storeys: Math.round(whole(8, 16) * tall), shops: 'lobby', crown: 'parapet', roof: rng() < 0.5 ? 'mast' : 'plant' }
  }

  // Buildings side by side along a strip, their fronts turned by `yaw`
  // (0 faces south, pi north, pi/2 east, -pi/2 west).
  function frontage(strip: Lot, yaw: number, y = KERB, tall = 1) {
    const alongX = Math.abs(Math.sin(yaw)) < 0.5
    const [a, b] = alongX ? [strip.x0, strip.x1] : [strip.z0, strip.z1]
    const deep = alongX ? strip.z1 - strip.z0 : strip.x1 - strip.x0
    const [cx, cz] = middle(strip)
    const count = b - a > 26 ? pick([1, 2, 2, 3]) : b - a > 14 ? pick([1, 2]) : 1
    const shares = Array.from({ length: count }, () => 0.6 + rng())
    const total = shares.reduce((sum, share) => sum + share, 0)
    let cursor = a
    for (const share of shares) {
      const length = ((b - a) * share) / total
      const centre = cursor + length / 2
      place(building(randomBuilding(length, deep, tall)), alongX ? centre : cx, alongX ? cz : centre, yaw, y)
      cursor += length
    }
  }

  // Alley clutter against one wall, leaving the lane open.
  function alley(from: [number, number], to: [number, number], width: number) {
    const [ax, az] = from
    const [bx, bz] = to
    const length = Math.hypot(bx - ax, bz - az)
    const ux = (bx - ax) / length
    const uz = (bz - az) / length
    const yaw = Math.atan2(ux, uz)
    keepClear.push(new THREE.Vector3(ax - ux * 2, 0, az - uz * 2), new THREE.Vector3(bx + ux * 2, 0, bz + uz * 2))
    for (let s = 4; s < length - 4; s += between(6, 10)) {
      const side = rng() < 0.5 ? -1 : 1
      const off = side * (width / 2 - 0.9)
      const x = ax + ux * s - uz * off
      const z = az + uz * s + ux * off
      const roll = rng()
      if (roll < 0.45) place(dumpster(pick(DUMPSTERS)), x, z, yaw + Math.PI / 2 + (side > 0 ? Math.PI : 0), KERB)
      else if (roll < 0.75) clutter.drums(x, z, 3)
      else if (roll < 0.87) {
        clutter.drums(x, z, 1)
        fire(x, KERB + 0.9, z, 1.5) // a burning barrel
      } else clutter.tyreStack(x, z, 3)
    }
  }

  // Raised block: kerbstones round the edge, pavement (or `inner`) inside, one collider for the slab.
  function slab(block: Lot, inner: THREE.Material = materials.pavement()) {
    const w = block.x1 - block.x0
    const d = block.z1 - block.z0
    const group = new THREE.Group()
    const kerb = materials.concrete()
    group.add(part(new THREE.BoxGeometry(w - 0.6, KERB, d - 0.6), inner, [0, KERB / 2, 0]))
    for (const side of [-1, 1]) {
      group.add(part(new THREE.BoxGeometry(w, KERB + 0.01, 0.3), kerb, [0, (KERB + 0.01) / 2, side * (d / 2 - 0.15)]))
      group.add(part(new THREE.BoxGeometry(0.3, KERB + 0.01, d - 0.6), kerb, [side * (w / 2 - 0.15), (KERB + 0.01) / 2, 0]))
    }
    place(solid(group, { box: [w / 2, KERB / 2, d / 2], at: [0, KERB / 2, 0] }), ...middle(block))
  }

  // --- blocks ------------------------------------------------------------------

  // Two rows of buildings back to back across a through-alley.
  function mixed(lot: Lot) {
    const [cx, cz] = middle(lot)
    const lane = 8
    if (rng() < 0.5) {
      frontage({ ...lot, z1: cz - lane / 2 }, Math.PI)
      frontage({ ...lot, z0: cz + lane / 2 }, 0)
      alley([lot.x0 - SIDEWALK, cz], [lot.x1 + SIDEWALK, cz], lane)
    } else {
      frontage({ ...lot, x1: cx - lane / 2 }, -Math.PI / 2)
      frontage({ ...lot, x0: cx + lane / 2 }, Math.PI / 2)
      alley([cx, lot.z0 - SIDEWALK], [cx, lot.z1 + SIDEWALK], lane)
    }
  }

  // Park: four lawns between crossing paths, dead trees, benches, a memorial obelisk.
  function park(lot: Lot) {
    const [cx, cz] = middle(lot)
    const lawn = materials.grass()
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x0 = sx < 0 ? lot.x0 + 1 : cx + 1.6
        const x1 = sx < 0 ? cx - 1.6 : lot.x1 - 1
        const z0 = sz < 0 ? lot.z0 + 1 : cz + 1.6
        const z1 = sz < 0 ? cz - 1.6 : lot.z1 - 1
        place(part(new THREE.BoxGeometry(x1 - x0, 0.06, z1 - z0), lawn, [0, 0.03, 0]), (x0 + x1) / 2, (z0 + z1) / 2, 0, KERB)
        const plaza = sx > 0 && sz > 0 // the corner by the monument stays open
        for (let i = plaza ? 1 : 3; i > 0; i--) place(tree(nextSeed++, between(6, 9)), between(x0 + 2, x1 - 2), between(z0 + 2, z1 - 2), rng() * Math.PI * 2, KERB)
        place(bench(), sx < 0 ? cx - 3 : cx + 3, sz < 0 ? cz - 4.5 : cz + 4.5, sz < 0 ? 0 : Math.PI, KERB)
      }
    }
    const obelisk = new THREE.Group()
    obelisk.add(part(new THREE.BoxGeometry(2.6, 1, 2.6), materials.concrete(), [0, 0.5, 0]))
    obelisk.add(part(new THREE.CylinderGeometry(0.35, 0.75, 9, 4, 1).rotateY(Math.PI / 4), materials.concrete(), [0, 5.5, 0]))
    place(solid(obelisk, { box: [1.3, 1.5, 1.3], at: [0, 1.5, 0] }), cx, cz, 0, KERB)
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
    ]) {
      place(lampPost(6), cx + dx * 13, cz + dz * 13, Math.atan2(-dx, -dz), KERB)
    }
  }

  // Landmark glass tower at the back of its block, a forecourt of planters and a steel ring toward the plaza.
  function towerBlock(lot: Lot) {
    const size = 22
    place(tower(size, size, nextSeed++), lot.x1 - size / 2, lot.z0 + size / 2, 0, KERB)
    for (const [x, z] of [
      [lot.x0 + 4, lot.z1 - 4],
      [lot.x0 + 12, lot.z1 - 3],
      [lot.x0 + 3, lot.z1 - 13],
      [lot.x0 + 13, lot.z1 - 12],
    ]) {
      place(planter(2.2, nextSeed++), x, z, 0, KERB)
    }
    const ring = new THREE.Group()
    ring.add(part(new THREE.BoxGeometry(2.4, 0.6, 1.2), materials.concrete(), [0, 0.3, 0]))
    ring.add(part(new THREE.TorusGeometry(2.4, 0.28, 10, 36), materials.steel(), [0, 3, 0]))
    place(solid(ring, { box: [1.2, 1.5, 0.6], at: [0, 1.5, 0] }), lot.x0 + 8, lot.z1 - 8, Math.PI / 4, KERB)
  }

  // Building site: a concrete frame you can drive under, a tower crane, site
  // cabins, steel waiting to go up, hoarding along the far streets.
  function site(lot: Lot) {
    place(concreteFrame(18, 18, 3), lot.x1 - 10, lot.z1 - 10, 0, KERB)
    const { structure, hook, trolley } = towerCrane(40, 34)
    place(structure, lot.x1 - 4, lot.z0 + 5, Math.PI, KERB)
    structure.updateMatrixWorld()
    hook.position.set(...trolley).applyMatrix4(structure.matrixWorld)
    swinging.push(hook)
    const cabins = new THREE.Group()
    cabins.add(shippingContainer('#c2c0b8').translateZ(-1.25), shippingContainer('#2c4a63').translateZ(1.25), shippingContainer('#c2c0b8').translateY(2.6))
    place(cabins, lot.x0 + 6, lot.z1 - 6, Math.PI / 2, KERB)
    for (let i = 0; i < 5; i++) place(iBeam(6 + rng() * 4), lot.x0 + 7 + (rng() - 0.5) * 2, lot.z0 + 12 + i * 0.5, (rng() - 0.5) * 0.2, KERB + (i % 2) * 0.4)
    // hoarding on the two street sides away from the plaza, a gate in each
    for (let x = lot.x0 + 8; x < lot.x1 - 1; x += 7.2) if (Math.abs(x - (lot.x0 + lot.x1) / 2) > 5) place(hoarding(7.2), x, lot.z1 + 1, 0, KERB)
    for (let z = lot.z0 + 8; z < lot.z1 - 1; z += 7.2) if (Math.abs(z - (lot.z0 + lot.z1) / 2) > 5) place(hoarding(7.2), lot.x1 + 1, z, Math.PI / 2, KERB)
    for (let i = 0; i < 3; i++) place(jerseyBarrier(), lot.x0 + 2 + i * 3.1, lot.z0 + 1.5, 0, KERB)
    const flood = new THREE.SpotLight('#ffe2b0', 900, 60, 0.6, 0.5, 2)
    flood.position.set(lot.x0 + 2, 14, lot.z0 + 2)
    flood.target.position.set(lot.x1 - 10, 0, lot.z1 - 10)
    root.add(flood, flood.target)
  }

  // L of tenements around a courtyard open to the plaza: a basketball court, a burnt car, a fire.
  function court(lot: Lot) {
    const wing = 12
    frontage({ ...lot, x1: lot.x0 + wing }, -Math.PI / 2)
    frontage({ ...lot, x0: lot.x0 + wing, z0: lot.z1 - wing }, 0)
    const yard: Lot = { ...lot, x0: lot.x0 + wing, z1: lot.z1 - wing }
    const [cx, cz] = middle(yard)
    for (const [w, d, x, z] of [
      [15, 0.1, cx, cz - 4.5],
      [15, 0.1, cx, cz + 4.5],
      [0.1, 9, cx - 7.5, cz],
      [0.1, 9, cx + 7.5, cz],
      [0.1, 9, cx, cz],
    ]) {
      paint(new THREE.PlaneGeometry(w, d), whitePaint, x, z, 0, KERB + 0.012)
    }
    for (const side of [-1, 1]) {
      const hoop = new THREE.Group()
      hoop.add(part(tube([0, 0, 0], [0, 3.6, 0], 0.08, 8), materials.darkSteel()))
      hoop.add(part(new THREE.BoxGeometry(0.05, 1.05, 1.8), materials.steel(), [side * -0.5, 3.4, 0]))
      hoop.add(part(new THREE.TorusGeometry(0.23, 0.015, 5, 16).rotateX(Math.PI / 2), materials.rustySteel(), [side * -0.8, 3.05, 0]))
      place(solid(hoop, { cylinder: [0.15, 1.8], at: [0, 1.8, 0] }), cx + side * 8.3, cz, 0, KERB)
    }
    clutter.wreck(cx - 3, KERB, cz + 2, 0.15, true, 1.1, '#2e2e2c')
    fire(cx - 3, KERB + 1.1, cz + 2)
    clutter.drums(yard.x1 - 2, yard.z0 + 2, 3)
  }

  // Gutted six-storey tenement still burning, a collapsed wing, rubble spilling out.
  function ruin(lot: Lot) {
    const ruinSeed = nextSeed++
    place(building({ width: 20, depth: 16, storeys: 6, style: 'burntBrick', seed: ruinSeed, shops: 'redShops', burnt: true, fireEscape: true }), lot.x0 + 10, lot.z0 + 11, -Math.PI / 2, KERB)
    place(building({ width: 9, depth: 16, storeys: 2, style: 'burntBrick', seed: ruinSeed + 1, burnt: true }), lot.x0 + 10, lot.z1 - 5.5, -Math.PI / 2, KERB)
    frontage({ ...lot, x0: lot.x0 + 21 }, Math.PI / 2)
    for (const [x, z, r] of [
      [lot.x0 - 1, lot.z0 + 8, 3],
      [lot.x0 + 2, lot.z1 - 3, 3.5],
    ]) {
      const heap = junkMound(r, 1.6, x + z)
      heap.material = materials.charred()
      place(solid(heap, { cylinder: [r * 0.8, 0.8], at: [0, 0.8, 0] }), x, z, rng() * Math.PI, KERB)
    }
    for (const z of [lot.z0 + 6, lot.z0 + 12, lot.z0 + 18]) fire(lot.x0 - 0.5, KERB + 1.2, z, 2.5)
    emitters.push({ kind: 'plume', position: new THREE.Vector3(lot.x0 + 10, 26, lot.z0 + 11) })
    fireLight.position.set(lot.x0 - 2, 4, lot.z0 + 12)
  }

  // Petrol station: canopy over three pump islands, the kiosk behind, a price pylon on the corner.
  function gas(lot: Lot) {
    const [cx, cz] = middle(lot)
    place(canopy(21, 11), cx + 2, cz + 3, 0, KERB)
    for (const dx of [-6, 0, 6]) place(pump(), cx + 2 + dx, cz + 3, 0, KERB)
    place(building({ width: 16, depth: 9, storeys: 0, style: 'redShops', shops: 'redShops', seed: nextSeed++, crown: 'parapet' }), cx - 6, lot.z0 + 5, 0, KERB)
    const pylon = new THREE.Group()
    pylon.add(part(new THREE.BoxGeometry(0.5, 7, 0.5), materials.steel(), [0, 3.5, 0]))
    pylon.add(part(new THREE.BoxGeometry(2.6, 3, 0.5), materials.darkSteel(), [0, 8, 0]))
    for (const side of [-1, 1]) pylon.add(part(new THREE.PlaneGeometry(2.3, 0.9), materials.neon('FUEL', '#ff5a3b'), [0, 8.8, side * 0.26], [0, side > 0 ? 0 : Math.PI, 0]))
    place(solid(pylon, { box: [0.3, 1.5, 0.3], at: [0, 1.5, 0] }), lot.x1 - 2, lot.z1 - 2, Math.PI / 4, KERB)
    clutter.wreck(cx - 1, KERB, cz + 5.8, 0.1, true, Math.PI / 2)
    clutter.wreck(cx + 9, KERB, cz + 0.2, 0.1, true, Math.PI / 2 + 0.2, '#2e2e2c')
    fire(cx + 9, KERB + 1.1, cz + 0.2)
    canopyLight.position.set(cx + 2, 4.6, cz + 3)
  }

  // Parking lot: painted bays, dead cars in half of them, lamps, a billboard.
  function parking(lot: Lot) {
    const rows = [lot.z0 + 6, lot.z0 + 16.5, lot.z1 - 6]
    for (const z of rows) {
      for (let x = lot.x0 + 2; x < lot.x1 - 2; x += 3) {
        paint(new THREE.PlaneGeometry(0.12, 5), whitePaint, x, z, 0, KERB + 0.012)
        if (x + 3 < lot.x1 - 2 && rng() < 0.5) clutter.wreck(x + 1.5, KERB, z, 0.1, true, rng() < 0.5 ? 0 : Math.PI)
      }
    }
    for (const x of [lot.x0 + 10, lot.x1 - 10]) place(lampPost(8), x, lot.z0 + 11.2, 0, KERB)
    place(billboard(0), lot.x1 - 6, lot.z1 - 3, Math.atan2(-(lot.x1 - 6), -(lot.z1 - 3)), KERB) // facing the middle of town
  }

  // Warehouse on a steel frame with a band of glazing up high, roller doors
  // onto a loading dock, trailers backed up to it.
  function warehouse(lot: Lot) {
    const [cx] = middle(lot)
    const shell = new THREE.Group()
    shell.add(part(new THREE.BoxGeometry(30, 11, 20), materials.corrugated('#6a665e'), [0, 5.5, 0]))
    shell.add(part(new THREE.BoxGeometry(31, 0.5, 21), materials.roof(), [0, 11.25, 0]))
    for (let x = -15; x <= 15; x += 6) {
      for (const z of [-10.1, 10.1]) shell.add(part(new THREE.BoxGeometry(0.35, 11, 0.25), materials.darkSteel(), [x, 5.5, z]))
    }
    for (const z of [-10.06, 10.06]) shell.add(part(new THREE.BoxGeometry(29, 1.1, 0.06), materials.glass(), [0, 9.3, z]))
    for (const x of [-10.5, -4.5, 1.5]) {
      shell.add(part(new THREE.BoxGeometry(4.4, 4.8, 0.14), materials.corrugated('#34414b'), [x, 2.4 + 1.2, 10.08]))
      shell.add(part(new THREE.BoxGeometry(0.6, 0.25, 0.3), materials.light('#ffd9a0', 4), [x, 6.4, 10.3]))
    }
    shell.add(part(new THREE.PlaneGeometry(9, 1.6), materials.neon('SALVAGE', '#ffb03b'), [9, 7.4, 10.3]))
    place(solid(shell, { box: [15, 5.5, 10], at: [0, 5.5, 0] }), cx, lot.z0 + 10, 0, KERB)
    place(solid(part(new THREE.BoxGeometry(30, 1.2, 3.5), materials.concrete(), [0, 0.6, 0])), cx, lot.z0 + 21.75, 0, KERB)
    for (const x of [cx - 8, cx + 5]) place(shippingContainer(pick(['#7a2a1d', '#2c4a63', '#a4561f'])), x, lot.z0 + 26.6, Math.PI / 2 + (rng() - 0.5) * 0.1, KERB)
    clutter.drums(lot.x1 - 3, lot.z1 - 2, 5)
  }

  // Two long prefab blocks facing out, a narrow yard between them.
  function panels(lot: Lot) {
    const [, cz] = middle(lot)
    for (const [z0, z1, yaw] of [
      [lot.z0, cz - 4.5, Math.PI],
      [cz + 4.5, lot.z1, 0],
    ]) {
      place(building({ width: lot.x1 - lot.x0, depth: z1 - z0, storeys: whole(8, 10), style: pick(PANEL), seed: nextSeed++, crown: 'parapet', roof: 'plant', balconies: true }), (lot.x0 + lot.x1) / 2, (z0 + z1) / 2, yaw, KERB)
    }
    alley([lot.x0 - SIDEWALK, cz], [lot.x1 + SIDEWALK, cz], 9)
  }

  // Bus depot: an open shed along the back, buses parked and burnt out on the apron.
  function depot(lot: Lot) {
    const [cx] = middle(lot)
    place(shed(32, 10, 7), cx, lot.z1 - 5.5, Math.PI, KERB)
    for (const [x, z, yaw, burnt] of [
      [cx - 9, lot.z0 + 6, 0.05, false],
      [cx + 6, lot.z0 + 7, -0.1, true],
      [cx - 6, lot.z0 + 14, Math.PI + 0.3, true],
      [cx + 8, lot.z0 + 16, Math.PI - 0.15, false],
    ] as Array<[number, number, number, boolean]>) {
      place(bus(burnt), x, z, yaw, KERB)
      if (burnt) fire(x, KERB + 2, z, 5)
    }
    clutter.drums(lot.x0 + 3, lot.z1 - 12, 6)
    clutter.tyreStack(lot.x1 - 3, lot.z0 + 3, 5)
  }

  const canopyLight = new THREE.PointLight('#fff1d6', 350, 24, 2)
  const fireLight = new THREE.PointLight('#ff6a24', 700, 34, 2)
  root.add(canopyLight, fireLight)

  const build: Record<BlockKind, (lot: Lot) => void> = { mixed, park, tower: towerBlock, site, court, ruin, gas, parking, warehouse, panels, depot }
  SPANS.forEach(([z0, z1], row) =>
    SPANS.forEach(([x0, x1], col) => {
      const kind = BLOCKS[row][col]
      const block: Lot = { x0, x1, z0, z1 }
      slab(block, kind === 'parking' || kind === 'depot' ? materials.asphalt() : kind === 'site' ? materials.mud() : materials.pavement())
      build[kind](inset(block, SIDEWALK))
    }),
  )

  // --- streets -----------------------------------------------------------------

  const signalLamp = (color: string) => new THREE.MeshStandardMaterial({ name: `signal:${color}`, color: '#050505', emissive: color, emissiveIntensity: 0.1 })
  const lampSet = (): SignalLamps => ({ red: signalLamp('#ff2a1a'), amber: signalLamp('#ffb020'), green: signalLamp('#35ff9a') })
  const northSouthLamps = lampSet()
  const eastWestLamps = lampSet()

  // One street between two junctions: centre line `line`, running from
  // `from` to `to` (along z if `northSouth`, else along x).
  function segment(line: number, width: number, from: number, to: number, northSouth: boolean) {
    const at = (across: number, along: number): [number, number] => (northSouth ? [line + across, along] : [along, line + across])
    const lengthwise = northSouth ? 0 : Math.PI / 2 // yaw along the street
    const facing = (sign: number) => (northSouth ? (sign * Math.PI) / 2 : sign > 0 ? 0 : Math.PI) // yaw turning +Z across the street
    const half = width / 2
    const strip = (across: number, a: number, b: number, material: THREE.Material, w = 0.14) => paint(new THREE.PlaneGeometry(w, b - a), material, ...at(across, (a + b) / 2), lengthwise)

    // markings: crossings and stop lines at both ends, lane lines between
    for (const [end, dir] of [
      [from, 1],
      [to, -1],
    ]) {
      for (let across = -half + 1; across <= half - 1; across += 1.2) strip(across, Math.min(end + dir * 1, end + dir * 4), Math.max(end + dir * 1, end + dir * 4), whitePaint, 0.55)
      const right = (northSouth ? 1 : -1) * dir // arriving traffic keeps to its right
      paint(new THREE.PlaneGeometry(half - 0.6, 0.4), whitePaint, ...at((right * half) / 2, end + dir * 5.2), lengthwise)
    }
    const a = from + 6
    const b = to - 6
    if (width === 24) {
      for (const across of [-0.18, 0.18]) strip(across, a, b, yellowPaint, 0.12)
      for (const side of [-1, 1]) for (let s = a; s < b - 3; s += 9) strip(side * 5.5, s, s + 3, whitePaint)
    } else if (width === 14) {
      for (const across of [-0.18, 0.18]) strip(across, a, b, yellowPaint, 0.12)
    } else {
      for (let s = a; s < b - 3; s += 9) strip(0, s, s + 3, whitePaint)
    }

    // lamps on alternating sidewalks, arms out over the road, a pool of light under each
    for (let s = from + 8, k = 0; s < to - 4; s += 26, k++) {
      const side = k % 2 ? 1 : -1
      place(lampPost(9), ...at(side * (half + 1), s), facing(-side), KERB)
      paint(new THREE.PlaneGeometry(14, 14), pool, ...at(side * (half - 1.2), s), 0, 0.03)
    }
    // avenue trees in their pits, and a bus stop
    if (width === 24) {
      const shelter = from + (to - from) * between(0.3, 0.7)
      const shelterSide = rng() < 0.5 ? -1 : 1
      place(busShelter(), ...at(shelterSide * (half + 1.8), shelter), facing(-shelterSide), KERB)
      for (let s = from + 14.5; s < to - 4; s += 13) {
        for (const side of [-1, 1]) {
          if (side === shelterSide && Math.abs(s - shelter) < 5) continue
          place(tree(nextSeed++, between(6, 8.5)), ...at(side * (half + 1.9), s), rng() * Math.PI * 2, KERB)
          paint(new THREE.PlaneGeometry(1.3, 1.3), materials.mud(), ...at(side * (half + 1.9), s), 0, KERB + 0.012)
        }
      }
    }
    place(hydrant(), ...at((rng() < 0.5 ? -1 : 1) * (half + 0.55), from + 4 + rng() * 4), 0, KERB)

    // parked and crashed cars along the kerbs; one in eight still burning
    for (let s = from + 5; s < to - 5; s += between(9, 16)) {
      if (rng() < 0.4) continue
      const crashed = rng() < 0.15
      const [x, z] = at((rng() < 0.5 ? -1 : 1) * (crashed ? between(3, half - 2) : half - 1.5), s) // the centre line stays open for the bots
      if (!clearOfStarts(x, z)) continue
      clutter.wreck(x, 0, z, 0.1, true, crashed ? rng() * Math.PI * 2 : lengthwise + (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.2)
      if (rng() < 0.12) fire(x, 1.1, z, 4)
    }
    // a manhole mid-street, some breathing steam
    const [mx, mz] = at((rng() - 0.5) * half, (from + to) / 2 + between(-8, 8))
    paint(new THREE.CircleGeometry(0.45, 20), materials.darkSteel(), mx, mz)
    if (rng() < 0.4) emitters.push({ kind: 'steam', position: new THREE.Vector3(mx, 0.1, mz) })
  }

  LINES.forEach((line, i) =>
    SPANS.forEach(([from, to]) => {
      segment(line, WIDTHS[i], from, to, true)
      segment(line, WIDTHS[i], from, to, false)
    }),
  )

  // Junctions: signals on the inner ones, a steaming manhole now and then.
  LINES.forEach((x, i) =>
    LINES.forEach((z, j) => {
      if (i === 2 && j === 2) return
      const wx = WIDTHS[i]
      const wz = WIDTHS[j]
      if (i > 0 && i < 4 && j > 0 && j < 4) {
        const cx = wx / 2 + 1.2
        const cz = wz / 2 + 1.2
        place(trafficSignal(wx / 2, northSouthLamps), x - cx, z - cz, 0, KERB)
        place(trafficSignal(wx / 2, northSouthLamps), x + cx, z + cz, Math.PI, KERB)
        place(trafficSignal(wz / 2, eastWestLamps), x + cx, z - cz, -Math.PI / 2, KERB)
        place(trafficSignal(wz / 2, eastWestLamps), x - cx, z + cz, Math.PI / 2, KERB)
      }
      paint(new THREE.CircleGeometry(0.45, 20), materials.darkSteel(), x + 2.5, z - 2)
      if (rng() < 0.3) emitters.push({ kind: 'steam', position: new THREE.Vector3(x + 2.5, 0.1, z - 2) })
    }),
  )

  // The plaza: a war rig on a plinth in a dry fountain basin, the roundabout round it.
  const monument = new THREE.Group()
  monument.add(part(new THREE.LatheGeometry([new THREE.Vector2(6.0, 0.5), new THREE.Vector2(6.0, 0.8), new THREE.Vector2(6.5, 0.8), new THREE.Vector2(6.65, 0)], 48), materials.concrete()))
  monument.add(part(new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2), materials.glass(), [0, 0.5, 0]))
  monument.add(part(new THREE.BoxGeometry(3.4, 3, 3.4), materials.concrete(), [0, 1.5, 0]))
  monument.add(part(new THREE.BoxGeometry(3.8, 0.4, 3.8), materials.concrete(), [0, 3.2, 0]))
  place(solid(monument, { cylinder: [6.6, 0.45], at: [0, 0.45, 0] }, { box: [1.9, 1.7, 1.9], at: [0, 1.7, 0] }), 0, 0)
  clutter.wreck(0, 3.4, 0, 0, false, 0.6, '#7a2a20')
  for (let q = 0; q < 4; q++) {
    const angle = Math.PI / 4 + (q * Math.PI) / 2
    place(lampPost(7), Math.cos(angle) * 17.5, Math.sin(angle) * 17.5, Math.atan2(-Math.cos(angle), -Math.sin(angle)), KERB)
  }
  for (let q = 0; q < 8; q++) paint(new THREE.PlaneGeometry(0.3, 2.5), whitePaint, Math.cos((q * Math.PI) / 4) * 9.5, Math.sin((q * Math.PI) / 4) * 9.5, (-q * Math.PI) / 4)

  // Cover where the avenues run long and open: a burnt bus, barrier chicanes.
  place(bus(true), 7, -34, 0.1 + Math.PI / 2)
  place(bus(false), -7, 32, Math.PI / 2 - 0.12)
  place(bus(true), 34, 6.5, 0.08)
  for (const [x, z, yaw] of [
    [-30, -5.5, 0],
    [-33.1, -5.5, 0],
    [-36.2, -5.5, 0],
    [56 - 6, -30, Math.PI / 2],
    [56 - 6, -33.1, Math.PI / 2],
    [-56 + 6, 30, Math.PI / 2],
    [-56 + 6, 33.1, Math.PI / 2],
    [30, 56 + 6, 0],
    [33.1, 56 + 6, 0],
    [-30, -56 - 6, 0],
    [-33.1, -56 - 6, 0],
  ]) {
    place(jerseyBarrier(), x, z, yaw)
  }
  fire(7, 1.6, -34, 5)

  // --- boundary ----------------------------------------------------------------
  // Buildings face in all round; the streets running out are walled off with
  // containers; an invisible wall just behind keeps everything in.
  const gaps = THROUGH.map((i): [number, number] => [LINES[i] - WIDTHS[i] / 2, LINES[i] + WIDTHS[i] / 2])
  for (const side of [-1, 1]) {
    for (const alongX of [true, false]) {
      const [from, to] = alongX ? [-RING, RING] : [-EDGE, EDGE]
      const cuts = [from, ...gaps.flat(), to]
      for (let k = 0; k < cuts.length; k += 2) {
        const [a, b] = [cuts[k], cuts[k + 1]]
        // outer sidewalk along the row's front
        const [sa, sb] = alongX ? [Math.max(a, -EDGE), Math.min(b, EDGE)] : [Math.max(a, -EDGE + SIDEWALK), Math.min(b, EDGE - SIDEWALK)]
        const across = side * (EDGE - SIDEWALK / 2)
        slab(alongX ? { x0: sa, x1: sb, z0: across - SIDEWALK / 2, z1: across + SIDEWALK / 2 } : { x0: across - SIDEWALK / 2, x1: across + SIDEWALK / 2, z0: sa, z1: sb })
        // the buildings
        const deep = between(20, 34)
        const front = side * EDGE
        const strip: Lot = alongX ? { x0: a, x1: b, z0: Math.min(front, front + side * deep), z1: Math.max(front, front + side * deep) } : { x0: Math.min(front, front + side * deep), x1: Math.max(front, front + side * deep), z0: a, z1: b }
        frontage(strip, alongX ? (side > 0 ? Math.PI : 0) : (-side * Math.PI) / 2, KERB, 1.4)
      }
    }
    // containers stacked across each street running out, a burnt car in front
    for (const i of THROUGH) {
      for (const alongX of [true, false]) {
        const [a, b] = gaps[THROUGH.indexOf(i)]
        const out = side * (EDGE + 2.5)
        for (let s = a + 3.03; s < b; s += 6.06) {
          const stack = new THREE.Group()
          stack.add(shippingContainer(pick(['#7a2a1d', '#2c4a63', '#a4561f', '#4b5130'])))
          if (rng() < 0.6) stack.add(shippingContainer(pick(['#7a2a1d', '#2c4a63', '#a4561f'])).translateY(2.6).rotateY((rng() - 0.5) * 0.2))
          place(stack, alongX ? s : out, alongX ? out : s, alongX ? 0 : Math.PI / 2)
        }
        const mid = (a + b) / 2 + between(-3, 3)
        const inside = side * (EDGE - 0.5) // in the mouth of the dead end, clear of the junction
        clutter.wreck(alongX ? mid : inside, 0, alongX ? inside : mid, 0.2, true)
      }
    }
  }
  for (const [x, z, hx, hz] of [
    [0, -(EDGE + 1.5), RING, 0.5],
    [0, EDGE + 1.5, RING, 0.5],
    [-(EDGE + 1.5), 0, 0.5, RING],
    [EDGE + 1.5, 0, 0.5, RING],
  ]) {
    colliders.push({ box: new THREE.Vector3(hx, 6, hz), position: new THREE.Vector3(x, 6, z), rotation: new THREE.Quaternion() })
  }

  // Floodlights over the crews' bases at either end of Main Avenue.
  for (const side of [-1, 1]) {
    const flood = new THREE.SpotLight('#ffd9a8', 1100, 70, 0.42, 0.6, 2)
    flood.position.set(0, 18, side * (EDGE + 1))
    flood.target.position.set(0, 0, side * 92)
    root.add(flood, flood.target)
  }

  // --- skyline -----------------------------------------------------------------
  // The grid carries on past the boundary, taller to the north (into the
  // sunset: silhouettes), with smoke from fires further off.
  for (let a = -8; a < 8; a++) {
    for (let b = -8; b < 8; b++) {
      const lot: Lot = { x0: a * 56 + 7, x1: (a + 1) * 56 - 7, z0: b * 56 + 7, z1: (b + 1) * 56 - 7 }
      if (Math.max(Math.abs(lot.x0), Math.abs(lot.x1)) <= 175 && Math.max(Math.abs(lot.z0), Math.abs(lot.z1)) <= 175) continue
      const [cx, cz] = middle(lot)
      const downtown = cz < -175 && Math.abs(cx) < 320
      const count = whole(1, 3)
      for (let k = 0; k < count; k++) {
        const w = (lot.x1 - lot.x0) / count
        const storeys = downtown ? whole(12, 42) : whole(4, 13)
        const style = storeys > 16 ? pick(GLASS) : pick([...BRICK, ...PANEL, ...GLASS])
        const tall = building({ width: w - 1, depth: lot.z1 - lot.z0 - between(0, 12), storeys, style, seed: nextSeed++, roof: storeys > 25 ? 'mast' : 'bare' })
        place(tall, lot.x0 + w * (k + 0.5), cz, 0, 0, skyline)
      }
    }
  }
  for (const [x, z] of [
    [-260, -340],
    [390, 120],
    [-170, 410],
    [150, -420],
  ]) {
    emitters.push({ kind: 'plume', position: new THREE.Vector3(x, 30, z) })
  }

  // --- ground ------------------------------------------------------------------
  root.add(createGround({ size: 1500, layoutExtent: 2 * (EDGE + 20), surface: materials.asphalt(), paintLayout: (tint, wet) => paintStreets(tint, wet, rng, scorches) }))

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
  root.add(...merge(scenery.groups, true), ...merge(flat.groups, false), ...merge(skyline.groups, false, false), ...swinging, ...clutter.build())

  // --- bots' roads -------------------------------------------------------------
  // Junctions and mid-block points along every street, plus a ring of eight
  // round the monument that the avenues feed into.
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
  const stops = LINES.flatMap((line, j) => (j ? [(LINES[j - 1] + line) / 2, line] : [line]))
  for (const line of LINES) {
    for (const northSouth of [true, false]) {
      let previous = -1
      for (const s of stops) {
        const [x, z] = northSouth ? [line, s] : [s, line]
        if (x === 0 && z === 0) {
          previous = -1 // the monument: the ring takes over
          continue
        }
        const current = node(x, z)
        if (previous >= 0) pairs.push([previous, current])
        previous = current
      }
    }
  }
  const ring = Array.from({ length: 8 }, (_, k) => node(Math.cos((k * Math.PI) / 4) * PLAZA, Math.sin((k * Math.PI) / 4) * PLAZA))
  ring.forEach((n, k) => pairs.push([n, ring[(k + 1) % 8]]))
  pairs.push([node(28, 0), ring[0]], [node(0, 28), ring[2]], [node(-28, 0), ring[4]], [node(0, -28), ring[6]])

  const buzz = (time: number, seed: number) => {
    const h = Math.sin(Math.floor(time * 14 + seed) * 12.9898) * 43758.5453
    return h - Math.floor(h) > 0.92 ? 0.12 : 1
  }
  const flickering = [materials.neon('HOTEL', '#b44bff'), materials.neon('BAR', '#ff3b5c'), materials.neon('PAWN', '#ffb03b', true)]
  const lit = (material: THREE.MeshStandardMaterial, on: boolean) => (material.emissiveIntensity = on ? 6 : 0.08)

  // Free-for-all hot zones: the plaza and the landmark blocks, each taking in
  // the streets round it (the items land on those).
  const [west, inner, , east] = SPANS.map(([a, b]) => (a + b) / 2)
  const zones: Area[] = [
    { name: 'Downtown', x: 0, z: 0, radius: 34 },
    { name: 'Gas Station', x: west, z: west, radius: 40 },
    { name: 'Parking Lot', x: east, z: west, radius: 40 },
    { name: 'The Park', x: inner, z: inner, radius: 40 },
    { name: 'Glass Tower', x: -inner, z: inner, radius: 40 },
    { name: 'The Ruin', x: east, z: inner, radius: 40 },
    { name: 'Warehouse', x: west, z: -inner, radius: 40 },
    { name: 'Courtyard', x: inner, z: -inner, radius: 40 },
    { name: 'Building Site', x: -inner, z: -inner, radius: 40 },
    { name: 'Panel Blocks', x: west, z: east, radius: 40 },
    { name: 'Bus Depot', x: east, z: east, radius: 40 },
  ]

  return {
    name: 'The City',
    root,
    spawns,
    bases,
    zones,
    colliders,
    nav: navGraph(points, pairs),
    emitters,
    extent: EDGE + 8,
    mapRange: 78,
    paintMap(ctx) {
      ctx.fillStyle = 'rgba(64, 52, 43, 0.75)'
      ctx.fillRect(-EDGE, -EDGE, 2 * EDGE, 2 * EDGE)
      ctx.strokeStyle = 'rgba(150, 128, 102, 0.45)'
      LINES.forEach((line, i) => {
        ctx.lineWidth = WIDTHS[i]
        ctx.beginPath()
        ctx.moveTo(line, -EDGE)
        ctx.lineTo(line, EDGE)
        ctx.moveTo(-EDGE, line)
        ctx.lineTo(EDGE, line)
        ctx.stroke()
      })
      ctx.fillStyle = 'rgba(96, 110, 70, 0.45)'
      const [px0, px1] = SPANS[1]
      ctx.fillRect(px0 + 4, px0 + 4, px1 - px0 - 8, px1 - px0 - 8) // the park
      ctx.fillStyle = 'rgba(150, 128, 102, 0.45)'
      ctx.beginPath()
      ctx.arc(0, 0, PLAZA + 6, 0, Math.PI * 2)
      ctx.fill()
    },
    update(time) {
      facadeClock.value = time
      const phase = time % 26 // north-south green 0-10 s, amber to 13, then east-west gets its turn
      lit(northSouthLamps.green as THREE.MeshStandardMaterial, phase < 10)
      lit(northSouthLamps.amber as THREE.MeshStandardMaterial, phase >= 10 && phase < 13)
      lit(northSouthLamps.red as THREE.MeshStandardMaterial, phase >= 13)
      lit(eastWestLamps.green as THREE.MeshStandardMaterial, phase >= 13 && phase < 23)
      lit(eastWestLamps.amber as THREE.MeshStandardMaterial, phase >= 23)
      lit(eastWestLamps.red as THREE.MeshStandardMaterial, phase < 13)
      BEACON.emissiveIntensity = time % 1.6 < 0.25 ? 9 : 0.15
      flickering.forEach((material, i) => material.color.setScalar(2.2 * buzz(time, i * 7.3)))
      fireLight.intensity = 700 * (0.75 + 0.25 * Math.sin(time * 11) * Math.sin(time * 6.3 + 1))
      swinging.forEach((hook, i) => {
        hook.rotation.x = Math.sin(time * 0.31 + i) * 0.03
        hook.rotation.z = Math.sin(time * 0.23 + i * 2) * 0.025
      })
    },
  }
}

// Macro look of the road surface, in world metres: patched asphalt, oil,
// scorch marks under the fires, water standing along every kerb and in the
// dips at junctions.
function paintStreets(tint: CanvasRenderingContext2D, wet: CanvasRenderingContext2D, rng: () => number, scorches: Array<[number, number, number]>) {
  const reach = EDGE + 20
  const blob = (ctx: CanvasRenderingContext2D, x: number, z: number, rx: number, rz: number) => {
    ctx.beginPath()
    ctx.ellipse(x, z, rx, rz, rng() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  // patches of newer and older surfacing along the streets
  for (let i = 0; i < 220; i++) {
    const line = LINES[Math.floor(rng() * LINES.length)]
    const along = (rng() * 2 - 1) * reach
    const northSouth = rng() < 0.5
    const [w, l] = [2 + rng() * 6, 3 + rng() * 14]
    tint.fillStyle = rng() < 0.5 ? 'rgb(112,112,112)' : 'rgb(146,144,140)'
    if (northSouth) tint.fillRect(line + (rng() - 0.5) * 16 - w / 2, along - l / 2, w, l)
    else tint.fillRect(along - l / 2, line + (rng() - 0.5) * 16 - w / 2, l, w)
  }
  // oil drips down the middle of the lanes
  tint.fillStyle = 'rgba(40,38,36,0.35)'
  for (let i = 0; i < 400; i++) {
    const line = LINES[Math.floor(rng() * LINES.length)] + (rng() < 0.5 ? -3 : 3)
    const along = (rng() * 2 - 1) * reach
    if (rng() < 0.5) blob(tint, line, along, 0.3 + rng() * 0.6, 0.3 + rng() * 1.2)
    else blob(tint, along, line, 0.3 + rng() * 1.2, 0.3 + rng() * 0.6)
  }
  // scorched ground under everything burning
  for (const [x, z, radius] of scorches) {
    const burn = tint.createRadialGradient(x, z, 0, x, z, radius)
    burn.addColorStop(0, 'rgba(10,8,7,0.85)')
    burn.addColorStop(1, 'rgba(10,8,7,0)')
    tint.fillStyle = burn
    tint.fillRect(x - radius, z - radius, 2 * radius, 2 * radius)
  }

  // gutters: a damp band and puddles along every kerb
  wet.lineWidth = 1.4
  wet.strokeStyle = 'rgba(150,150,150,0.8)'
  wet.fillStyle = '#fff'
  for (const [z0, z1] of SPANS) {
    for (const [x0, x1] of SPANS) {
      wet.strokeRect(x0 - 0.5, z0 - 0.5, x1 - x0 + 1, z1 - z0 + 1)
      for (let i = 0; i < 10; i++) {
        const t = rng()
        const side = Math.floor(rng() * 4)
        const x = side < 2 ? x0 + (x1 - x0) * t : side === 2 ? x0 - 0.8 : x1 + 0.8
        const z = side >= 2 ? z0 + (z1 - z0) * t : side === 0 ? z0 - 0.8 : z1 + 0.8
        blob(wet, x, z, 0.8 + rng() * 2.2, 0.5 + rng() * 0.9)
      }
    }
  }
  wet.strokeRect(-EDGE + SIDEWALK - 0.5, -EDGE + SIDEWALK - 0.5, 2 * (EDGE - SIDEWALK) + 1, 2 * (EDGE - SIDEWALK) + 1)
  // standing water in the dips at junctions and in potholes down the lanes
  for (const x of LINES) {
    for (const z of LINES) {
      for (let i = 0; i < 4; i++) blob(wet, x + (rng() - 0.5) * 12, z + (rng() - 0.5) * 12, 1 + rng() * 3.5, 0.6 + rng() * 2)
    }
  }
  for (let i = 0; i < 160; i++) {
    const line = LINES[Math.floor(rng() * LINES.length)] + (rng() - 0.5) * 10
    const along = (rng() * 2 - 1) * reach
    if (rng() < 0.5) blob(wet, line, along, 0.4 + rng() * 1.4, 0.4 + rng() * 2.5)
    else blob(wet, along, line, 0.4 + rng() * 2.5, 0.4 + rng() * 1.4)
  }
}
