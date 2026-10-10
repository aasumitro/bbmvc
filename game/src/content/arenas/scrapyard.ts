import * as THREE from 'three'
import { mergeByMaterial, part, tube } from '../../render/geometry.ts'
import { materials } from '../../render/materials/library.ts'
import { createRng } from '../../shared/rng.ts'
import {
  chunks,
  clutterKit,
  collectColliders,
  navGraph,
  polar,
  spreadOut,
  type Arena,
  type ArenaCollider,
  type Area,
  type Emitter,
  type SpawnPoint,
} from './arena.ts'
import { createGround } from './kit/ground.ts'
import {
  banner,
  crane,
  crusher,
  gantry,
  iBeam,
  jerseyBarrier,
  junkMound,
  lampPost,
  pipeBridge,
  planeWreck,
  shed,
  shippingContainer,
  storageTank,
  watchTower,
} from './kit/props.ts'
import { bus } from './kit/street.ts'

// The Scrapyard: a walled salvage yard at dusk, the City's size, built for
// eight cars. North is -Z, east +X. An octagonal yard with the old one at
// its heart — the Crest, a barrier-ringed pit round a raised platform, then
// cover islands and the ring road. Eight roads, walled in stacked wrecks,
// run out from the ring: haul roads to barred gates on the four cardinal
// edges of the wall, tracks to open work sheds on the diagonal ones. A perimeter road runs round just
// inside the wall, and a middle track crosses every spoke square, halfway
// out, so there is always another way round. Between the spokes lie eight
// yards, each with its own trade: cranes, stacked containers, a tank farm,
// a tyre fire, a crashed airliner, dead buses, a mountain of scrap and a car
// crusher. Free for all starts on the perimeter road; the crews line up on
// the north and south gate aprons. Beyond the wall, heaps and towers fade
// into the haze.

const APOTHEM = 124 // centre to each straight edge of the wall
const BOUNDARY = APOTHEM + 3.5 // invisible wall behind it, through the gate towers
const EDGE_HALF = APOTHEM * Math.tan(Math.PI / 8)
const GATE_WIDTH = 16
const CENTRE_RADIUS = 17 // the Crest's barrier ring
const RING_RADIUS = 36 // ring road round the Crest's islands
const RING_WIDTH = 10
const ROAD_WIDTH = 12 // the spokes
const TRACK = 66 // middle track: an octagon crossing each spoke square this far out
const TRACK_WIDTH = 9
const PERIMETER = 106 // perimeter road, from the centre to its centre line
const PERIMETER_WIDTH = 14
const SHED_LENGTH = 36
const SPOKES = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4) // east, then round through south, west and north

const CONTAINER_PAINTS = ['#7a2a1d', '#2c4a63', '#a4561f', '#4b5130']
const TANK_PAINTS = ['#9a948a', '#7c6a52']

// Yaw that turns a prop's +Z toward the centre from `angle`; its x axis then runs tangentially.
const facingCentre = (angle: number) => Math.atan2(-Math.cos(angle), -Math.sin(angle))
// A point `r` metres out along `angle`, `w` metres to its side (toward larger angles).
const beside = (angle: number, r: number, w: number): [number, number] => [Math.cos(angle) * r - Math.sin(angle) * w, Math.sin(angle) * r + Math.cos(angle) * w]
// An octagon square to the spokes, `apothem` from the centre: its corners, on the yards' bisectors.
const octagon = (apothem: number) => SPOKES.map((angle) => polar(apothem / Math.cos(Math.PI / 8), angle + Math.PI / 8))

// A yard between two spokes, in its own frame. `at(u, v)`: u metres out
// along its bisector, v to the side (toward the later spoke). `arm(side, r,
// w)`: r metres out along the spoke on that side (-1 the earlier, +1 the
// later) and w in from it. Room in every yard: an island inside the middle
// track (u 44 to 62 on the bisector) and a V-shaped band between the track
// and the perimeter road — r 73 to 97 on either arm, where it runs square to
// that arm's spoke. The walls down the spokes stand at w 8 to 10.
interface Yard {
  angle: number // the bisector
  at: (u: number, v: number) => [number, number]
  arm: (side: number, r: number, w: number) => [number, number]
  across: number // yaw laying a prop's x axis across the bisector, +Z toward the centre
  along: (side: number) => number // yaw laying x along an arm, square to its spoke
}

export function buildScrapyard(seed = 1): Arena {
  const rng = createRng(seed)
  const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)]
  const root = new THREE.Group()
  root.name = 'arena'
  const scenery = chunks(3, 2 * (APOTHEM + 16)) // inside the walls and the walls themselves: merged per chunk
  const skyline = chunks(2, 700) // beyond: merged too, casting nothing
  const colliders: ArenaCollider[] = []
  const emitters: Emitter[] = []
  const scorches: Array<[number, number, number]> = [] // x, z, radius: burnt ground under fires
  const clutter = clutterKit(rng, true, colliders)
  const wallClutter = clutterKit(rng, false) // the wrecks banked behind the wall: hundreds, so no shadows
  const skylineClutter = clutterKit(rng, false)
  const claws: THREE.Object3D[] = []

  const place = <T extends THREE.Object3D>(object: T, x: number, z: number, yaw = 0, y = 0, into = scenery): T => {
    object.position.set(x, y, z)
    object.rotation.y = yaw
    into.at(x, z).add(object)
    return object
  }
  const fire = (x: number, y: number, z: number, scorch = 3) => {
    emitters.push({ kind: 'fire', position: new THREE.Vector3(x, y, z) })
    scorches.push([x, z, scorch])
  }
  const fireLight = new THREE.PointLight('#ff6a24', 700, 40, 2)
  root.add(fireLight)

  // Shipping containers stacked `levels` high, the upper ones askew; `wide`:
  // two side by side at the bottom.
  function containers(x: number, z: number, yaw: number, levels: number, wide = false) {
    const stack = new THREE.Group()
    for (const side of wide ? [-1.25, 1.25] : [0]) stack.add(shippingContainer(pick(CONTAINER_PAINTS)).translateZ(side))
    for (let level = 1; level < levels; level++) {
      const top = shippingContainer(pick(CONTAINER_PAINTS))
      top.position.set((rng() - 0.5) * 0.8, level * 2.6, (rng() - 0.5) * (wide ? 1.5 : 0.4))
      top.rotation.y = (rng() - 0.5) * 0.3
      stack.add(top)
    }
    place(stack, x, z, yaw)
  }

  function barrierArc(radius: number, from: number, to: number) {
    for (let angle = from; angle <= to; angle += 3.1 / radius) place(jerseyBarrier(), ...polar(radius, angle), facingCentre(angle))
  }

  // A crawler crane whose claw sways from its boom tip.
  function craneAt(x: number, z: number, yaw: number) {
    const { structure, claw } = crane()
    place(structure, x, z, yaw)
    structure.updateMatrixWorld()
    claw.position.applyMatrix4(structure.matrixWorld)
    claw.rotation.y = yaw
    claws.push(claw)
  }

  // A heap of junk: a mound, strewn with shells and tyres.
  function heap(x: number, z: number, radius: number, height: number, shells: number, tyres: number, material = materials.rustySteel()) {
    const mound = junkMound(radius, height, x * 0.37 + z)
    mound.material = material
    place(mound, x, z, rng() * Math.PI)
    clutter.heap(x, z, radius, height, shells, tyres)
  }

  // --- the wall: barred gates on the cardinal edges, open sheds on the diagonals ---
  for (let k = 0; k < 8; k++) {
    const angle = SPOKES[k]
    const yaw = facingCentre(angle)
    const along = (s: number, inward = 0) => beside(angle, APOTHEM - inward, s) // `s` along the edge, `inward` toward the centre
    const gate = k % 2 === 0

    // barrier line backed by a wall of stacked wrecks, either side of the gate or shed
    for (let s = gate ? GATE_WIDTH / 2 + 1.5 : SHED_LENGTH / 2 + 1; s < EDGE_HALF; s += 3.1) {
      for (const side of [-1, 1]) {
        place(jerseyBarrier(), ...along(side * s), yaw)
        for (const depth of [2.8, 5.6]) {
          const [wx, wz] = along(side * (s + rng() - 0.5), -depth - rng())
          for (let level = 0; level < 2; level++) {
            if (level === 0 || rng() < 0.75) wallClutter.wreck(wx, level * 1.15, wz, level ? 0.5 : 0.25)
          }
        }
      }
    }

    if (gate) {
      // the gate itself is barred; towers flank it, a gantry with the crest banner spans it
      for (let s = -6.2; s <= 6.3; s += 3.1) place(jerseyBarrier(), ...along(s), yaw)
      for (const side of [-1, 1]) place(watchTower(14), ...along(side * (GATE_WIDTH / 2 + 3), -3.5), yaw)
      place(gantry(GATE_WIDTH + 6), ...along(0, -3.5), yaw, 12.5)
      const backstop = new THREE.Group()
      backstop.add(shippingContainer(pick(CONTAINER_PAINTS), 12.19), shippingContainer(pick(CONTAINER_PAINTS), 12.19).translateY(2.6))
      place(backstop, ...along(0, -15), yaw)
      // light pool over the gate apron, not a stadium wash over the whole yard
      const floodlight = new THREE.SpotLight('#ffd9a8', 900, 60, 0.45, 0.6, 2)
      const [lx, lz] = along(0, -3.5)
      const [tx, tz] = along(0, 16)
      floodlight.position.set(lx, 16, lz)
      floodlight.target.position.set(tx, 0, tz)
      root.add(floodlight, floodlight.target)
      // east and west: checkpoint cabins either side of the gate (north and south hold the crews' grids)
      if (k === 0 || k === 4) {
        for (const side of [-1, 1]) containers(...along(side * 14, 4.5), yaw, 1)
        clutter.drums(...along(-19, 2.5), 5)
      }
    } else {
      place(shed(SHED_LENGTH), ...along(0, 5.4), yaw)
      const glow = new THREE.PointLight('#ff9a48', 350, 30, 2)
      const [gx, gz] = along(0, 4)
      glow.position.set(gx, 5, gz)
      root.add(glow)
      // work in progress inside: shells up on the floor, drums, tyre stacks, a burning barrel
      for (const s of [-12, -2, 9]) {
        const [x, z] = along(s + rng() * 2, 3 + rng())
        clutter.wreck(x, 0, z, 0.1, true)
      }
      clutter.drums(...along(-7, 1.5), 6)
      clutter.tyreStack(...along(4, 1.2), 5)
      clutter.tyreStack(...along(4.8, 1.4), 3)
      const [bx, bz] = along(14, 1.8)
      clutter.drums(bx, bz, 1)
      fire(bx, 0.95, bz, 1.5)
      for (const side of [-1, 1]) clutter.tyreStack(...along(side * 21, 2), 2 + Math.floor(rng() * 4))
    }
    // junk piles along the verge, clear of the starts and the crews' grids
    for (const side of [-1, 1]) clutter.junkPile(...along(side * 35, 5.5), 3.5, 10)
    // a container stack in each corner
    const corner = angle + Math.PI / 8
    containers(...polar(128, corner), facingCentre(corner), 2, true)
  }

  // --- the Crest: barrier ring with four road gaps, raised crest platform ---
  const gap = (ROAD_WIDTH / 2 + 1.5) / CENTRE_RADIUS
  for (let q = 0; q < 4; q++) barrierArc(CENTRE_RADIUS, (q * Math.PI) / 2 + gap, ((q + 1) * Math.PI) / 2 - gap)
  const crest = scenery.at(0, 0)
  crest.add(part(new THREE.CylinderGeometry(7, 8.6, 0.7, 48), materials.concrete(), [0, 0.35, 0]))
  crest.add(part(new THREE.PlaneGeometry(10, 10), materials.floorCrest(), [0, 0.705, 0], [-Math.PI / 2, 0, 0]))
  for (let q = 0; q < 4; q++) {
    const angle = Math.PI / 4 + (q * Math.PI) / 2
    place(lampPost(7), ...polar(7.6, angle), facingCentre(angle), 0.7)
  }
  crest.add(part(tube([0, 0.7, 0], [0, 12, 0], 0.14, 12), materials.rustySteel()))
  crest.add(part(tube([-1.6, 11.6, 0], [1.6, 11.6, 0], 0.07, 8), materials.rustySteel()))
  place(banner(2.8, 6), 0, 0.25, 0, 11.6)

  // --- islands between the Crest and the ring road ---
  for (let q = 0; q < 4; q++) {
    const angle = Math.PI / 4 + (q * Math.PI) / 2
    if (q % 2 === 0) {
      containers(...polar(25, angle), facingCentre(angle), 2, true)
      clutter.drums(...polar(29.5, angle + 0.12), 5)
    } else {
      barrierArc(23, angle - 0.28, angle + 0.28)
      clutter.drums(...polar(27, angle - 0.1), 6)
      clutter.tyreStack(...polar(27.5, angle + 0.14), 4)
      clutter.tyreStack(...polar(28.2, angle + 0.18), 3)
    }
  }

  // --- roadside: walls of wrecks down both sides of every spoke (open where
  // the middle track crosses), lamps, pipe racks over the east and west roads,
  // cover on the shoulders, parked wrecks ---
  const half = ROAD_WIDTH / 2
  SPOKES.forEach((angle, k) => {
    const yaw = facingCentre(angle)
    for (const side of [-1, 1]) {
      for (const [from, to] of [
        [44, 58],
        [75, 95],
      ]) {
        clutter.wall(...beside(angle, from, side * (half + 3)), ...beside(angle, to, side * (half + 3)))
      }
    }
    if (k % 2 === 0) place(lampPost(7), ...polar(28, angle + (half + 1) / 28), yaw - Math.PI / 2) // between the Crest and the ring
    place(lampPost(7), ...beside(angle, 50, half + 1), yaw - Math.PI / 2)
    place(lampPost(7), ...beside(angle, 82, -half - 1), yaw + Math.PI / 2)
    if (k === 0 || k === 4) place(pipeBridge(24, 7), ...polar(88, angle), yaw)
    // jersey barriers end to end along the shoulders, a side each
    for (const [r, side] of [
      [58, 1],
      [92, -1],
    ]) {
      for (const d of [-1.55, 1.55]) place(jerseyBarrier(), ...beside(angle, r + d, side * (half - 0.7)), -angle)
    }
    // the perimeter road: lamps on its inner kerb by the junction, wrecks parked along it, now and then one burning
    for (const s of [-14, 14]) place(lampPost(8), ...beside(angle, PERIMETER - PERIMETER_WIDTH / 2 - 1, s), yaw + Math.PI)
    for (const s of [-36, 36]) {
      const [x, z] = beside(angle, PERIMETER - PERIMETER_WIDTH / 2 + 1.8, s + (rng() - 0.5) * 4)
      clutter.wreck(x, 0, z, 0.1, true, -angle + (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.3)
      if (rng() < 0.3) fire(x, 1.1, z, 4)
    }
  })

  // --- the yards between the spokes ---
  const yards: Array<{ name: string; build: (yard: Yard) => void }> = [
    // Crane Yard: two crawler cranes, claws swinging over the middle track, a junk mound between
    {
      name: 'Crane Yard',
      build({ at, arm, across }) {
        clutter.junkPile(...at(54, 0), 4.5, 14)
        const [px, pz] = at(92, 0)
        clutter.junkPile(px, pz, 5, 18)
        clutter.wreck(px, 2.4, pz, 0.6)
        fire(px, 3.2, pz, 5)
        for (const side of [-1, 1]) {
          craneAt(...arm(side, 82, 18), across - side * 0.35)
          for (let i = 0; i < 3; i++) place(iBeam(3.5 + rng() * 3), ...arm(side, 92 + rng() * 2, 21 + rng() * 3), rng() * Math.PI, (i % 2) * 0.4)
        }
        clutter.drums(...arm(-1, 78, 27), 6)
        clutter.tyreStack(...arm(1, 77, 26), 4)
      },
    },
    // The Stacks: rows of containers along both arms, an alley between them, a tower of them at the tip
    {
      name: 'The Stacks',
      build({ at, arm, across, along }) {
        containers(...at(54, 0), across, 2, true)
        for (const side of [-1, 1]) {
          for (const w of [14, 27]) containers(...arm(side, 78.5, w), along(side), 1 + Math.floor(rng() * 3))
          for (const w of [16, 23.5, 31]) containers(...arm(side, 91.5, w), along(side), 1 + Math.floor(rng() * 3))
        }
        containers(...at(99, 0), across, 3)
        clutter.drums(...at(88, 0), 4)
      },
    },
    // Tank Farm: a big tank burning at the tip, two smaller ones on the arms, pipes slung between
    {
      name: 'Tank Farm',
      build({ at, arm, across, along }) {
        place(storageTank(3.5, 6, TANK_PAINTS[1]), ...at(53, 0), across)
        const [bx, bz] = at(90, 0)
        place(storageTank(7, 11), bx, bz, across)
        for (const side of [-1, 1]) {
          const [sx, sz] = arm(side, 84, 16)
          place(storageTank(4.5, 8, pick(TANK_PAINTS)), sx, sz, along(side) + Math.PI / 2)
          for (const y of [5.4, 6.1]) scenery.at((bx + sx) / 2, (bz + sz) / 2).add(part(tube([bx, y, bz], [sx, y, sz], 0.28, 10), materials.rustySteel()))
          clutter.drums(...arm(side, 94, 24), 5)
        }
        for (const [dx, dz] of [
          [3, 2],
          [-4, 1],
        ]) {
          fire(bx + dx, 12.1, bz + dz, 0) // on the roof
        }
        emitters.push({ kind: 'plume', position: new THREE.Vector3(bx, 16, bz) })
        fireLight.position.set(bx, 14, bz)
        clutter.drums(...at(79, 0), 4)
      },
    },
    // Tyre Fire: a hill of tyres burning under a black column, walls of stacked tyres on the arms
    {
      name: 'Tyre Fire',
      build({ at, arm }) {
        heap(...at(54, 0), 5.5, 3, 0, 60, materials.rubber())
        const [hx, hz] = at(90, 0)
        heap(hx, hz, 9, 5.5, 4, 180, materials.rubber())
        for (const [dx, dz, y] of [
          [0, 0, 5],
          [3.5, -2, 4.4],
          [-3, 3, 4.4],
        ]) {
          fire(hx + dx, y, hz + dz, 10)
        }
        emitters.push({ kind: 'plume', position: new THREE.Vector3(hx, 12, hz) })
        for (const side of [-1, 1]) {
          for (let w = 12; w <= 20; w += 0.95) clutter.tyreStack(...arm(side, 80, w), 2 + Math.floor(rng() * 4))
          for (let w = 14; w <= 22; w += 0.95) clutter.tyreStack(...arm(side, 92, w), 1 + Math.floor(rng() * 4))
        }
      },
    },
    // Crash Site: an airliner broken up across the tip, its wing out toward the wall, salvage round it
    {
      name: 'Crash Site',
      build({ at, arm, across, along, angle }) {
        clutter.junkPile(...at(54, 0), 4, 12)
        place(planeWreck(), ...at(88, -1.2), across + Math.PI / 2)
        const [ex, ez] = at(83.5, 4.3) // an engine torn off beside the fuselage, burning
        fire(ex, 1.4, ez, 5)
        containers(...arm(-1, 92, 14), along(-1), 2, true)
        clutter.junkPile(...arm(-1, 79, 17), 3.5, 10)
        clutter.junkPile(...arm(1, 84, 19), 3.5, 10)
        for (let i = 0; i < 6; i++) place(iBeam(3 + rng() * 5), ...arm(1, 91 + rng() * 3, 14 + rng() * 6), angle + (rng() - 0.5) * 0.6, (i % 3) * 0.4)
      },
    },
    // Bus Graveyard: dead buses parked in rows along the arms, three stacked at the tip
    {
      name: 'Bus Graveyard',
      build({ at, arm, across, along }) {
        place(bus(true), ...at(54, 0), across)
        for (const v of [-1.5, 1.5]) place(bus(rng() < 0.5), ...at(90, v), across + Math.PI / 2)
        place(bus(true), ...at(90, 0), across + 0.2, 3.05)
        for (const side of [-1, 1]) {
          for (const w of [13, 17.5]) {
            const burnt = rng() < 0.6
            const [x, z] = arm(side, 85, w)
            place(bus(burnt), x, z, along(side) + Math.PI / 2 + (rng() - 0.5) * 0.08)
            if (burnt && rng() < 0.5) fire(x, 2, z, 5)
          }
        }
      },
    },
    // Scrap Mountain: a mound of wrecks at the tip, lesser heaps on the arms
    {
      name: 'Scrap Mountain',
      build({ at, arm }) {
        clutter.junkPile(...at(54, 0), 4, 12)
        heap(...at(90, 0), 9.5, 8, 26, 20)
        for (const side of [-1, 1]) heap(...arm(side, 84, 15), 4.5, 3.2, 8, 6)
        clutter.drums(...at(78, 0), 5)
      },
    },
    // The Crusher: the press at the tip, a car in its bed, crushed bales stacked along the arms
    {
      name: 'The Crusher',
      build({ at, arm, across, along, angle }) {
        clutter.bales(...at(54, 0), across, 3, 2)
        const [cx, cz] = at(91, -1.6)
        place(crusher(), cx, cz, across)
        clutter.wreck(cx, 1, cz, 0.05, false, -angle)
        const [sx, sz] = at(92, 5.7) // out of the power pack's exhaust
        emitters.push({ kind: 'steam', position: new THREE.Vector3(sx, 5.4, sz) })
        for (const side of [-1, 1]) {
          clutter.bales(...arm(side, 80, 16), along(side), 3, 3)
          clutter.bales(...arm(side, 90, 18), along(side), 2, 2)
        }
      },
    },
  ]
  const zones: Area[] = [{ name: 'The Crest', x: 0, z: 0, radius: 38 }]
  yards.forEach(({ name, build }, k) => {
    const angle = SPOKES[k] + Math.PI / 8
    const [early, late] = [SPOKES[k], SPOKES[k] + Math.PI / 4]
    build({
      angle,
      at: (u, v) => beside(angle, u, v),
      arm: (side, r, w) => (side < 0 ? beside(early, r, w) : beside(late, r, -w)),
      across: facingCentre(angle),
      along: (side) => facingCentre(side < 0 ? early : late),
    })
    const [x, z] = polar(80, angle) // free-for-all hot zone: the yard and the roads round it
    zones.push({ name, x, z, radius: 38 })
  })

  // --- starts ---
  // Free for all: two on each edge of the perimeter road, facing along it
  // toward the spoke's junction. Crews: a row of six on the north (the
  // player's) and south gate aprons, facing in — the middle four first (a
  // crew of four starts there), then the outer pair (six a side).
  const spawns: SpawnPoint[] = []
  for (const angle of SPOKES) {
    for (const s of [-24, 24]) {
      const [x, z] = beside(angle, PERIMETER, s)
      spawns.push({ position: new THREE.Vector3(x, 0, z), heading: s > 0 ? Math.PI - angle : -angle })
    }
  }
  spreadOut(spawns)
  const bases: [SpawnPoint[], SpawnPoint[]] = [[], []]
  for (const [team, angle] of [
    [0, SPOKES[6]],
    [1, SPOKES[2]],
  ]) {
    for (const s of [-4.5, 4.5, -13.5, 13.5, -22.5, 22.5]) {
      const [x, z] = beside(angle, APOTHEM - 5.5, s)
      bases[team].push({ position: new THREE.Vector3(x, 0, z), heading: facingCentre(angle) })
    }
  }

  // --- skyline beyond the walls: heaps, towers, cranes fading into the haze ---
  for (let i = 0; i < 36; i++) {
    const angle = (i / 36) * Math.PI * 2 + rng() * 0.15
    const [x, z] = polar(160 + rng() * 110, angle)
    const radius = 9 + rng() * 11
    place(junkMound(radius, 4 + rng() * 7, i), x, z, rng() * Math.PI, 0, skyline)
    skylineClutter.junkPile(x, z, radius * 0.9, 8)
  }
  for (const angle of SPOKES) place(watchTower(18), ...polar(141, angle + Math.PI / 8), facingCentre(angle + Math.PI / 8), 0, skyline) // a tower on every corner of the wall
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.2
    place(watchTower(16 + rng() * 10), ...polar(175 + rng() * 50, angle), facingCentre(angle), 0, skyline)
  }
  for (const angle of [0.9, 2.6, 4.4]) {
    const { structure, claw } = crane()
    structure.add(claw)
    place(structure, ...polar(215, angle), facingCentre(angle) + 0.6, 0, skyline)
  }

  // --- ground ---
  root.add(createGround({ size: 1200, layoutExtent: 2 * (APOTHEM + 26), paintLayout: (tint, wet) => paintYard(tint, wet, rng, scorches) }))

  // Physics footprint: solid props, the ramped crest platform and its mast,
  // and an invisible octagon behind the wall so nothing leaves the yard.
  for (const group of scenery.groups) collectColliders(group, colliders)
  const platform: THREE.Vector3[] = []
  for (let i = 0; i < 24; i++) {
    const [x, z] = polar(1, (i / 24) * Math.PI * 2)
    platform.push(new THREE.Vector3(x * 8.6, 0, z * 8.6), new THREE.Vector3(x * 7, 0.7, z * 7))
  }
  colliders.push({ hull: platform }, { cylinder: [0.2, 5.65], position: new THREE.Vector3(0, 6.35, 0) })
  const wallHalf = BOUNDARY * Math.tan(Math.PI / 8) + 1
  for (const angle of SPOKES) {
    const [x, z] = polar(BOUNDARY + 0.5, angle)
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingCentre(angle))
    colliders.push({ box: new THREE.Vector3(wallHalf, 4, 0.5), position: new THREE.Vector3(x, 4, z), rotation })
  }

  const merge = (groups: THREE.Group[], castShadow: boolean) =>
    groups
      .filter((group) => group.children.length)
      .map((group) => {
        const merged = mergeByMaterial(group)
        merged.children.forEach((mesh) => {
          mesh.castShadow &&= castShadow
          mesh.receiveShadow = castShadow
        })
        return merged
      })
  root.add(...merge(scenery.groups, true), ...merge(skyline.groups, false), ...claws, ...clutter.build(), ...wallClutter.build(), ...skylineClutter.build())

  // --- bots' roads ---
  // Every spoke from the ring road out to the perimeter road, stopping where
  // the middle track crosses; the ring, the track and the perimeter road
  // round through the yards' corners; the cardinal roads in to the Crest.
  const points: Array<[number, number]> = []
  const pairs: Array<[number, number]> = []
  const node = (at: [number, number]) => points.push(at) - 1
  const centre = [0, 2, 4, 6].map((k) => node(polar(12.5, SPOKES[k])))
  centre.forEach((n, q) => pairs.push([n, centre[(q + 1) % 4]]))
  const stops = SPOKES.map((angle) => [RING_RADIUS, 52, TRACK, 84, PERIMETER].map((r) => node(polar(r, angle))))
  stops.forEach((spoke, k) => {
    const next = stops[(k + 1) % 8]
    for (let i = 1; i < spoke.length; i++) pairs.push([spoke[i - 1], spoke[i]])
    pairs.push([spoke[0], next[0]])
    const track = node(octagon(TRACK)[k])
    const perimeter = node(octagon(PERIMETER)[k])
    pairs.push([spoke[2], track], [track, next[2]], [spoke[4], perimeter], [perimeter, next[4]])
    if (k % 2 === 0) pairs.push([spoke[0], centre[k / 2]])
  })

  return {
    name: 'Scrapyard',
    root,
    spawns,
    bases,
    zones,
    colliders,
    nav: navGraph(points, pairs),
    emitters,
    extent: BOUNDARY + 8,
    mapRange: 78,
    paintMap,
    update(time) {
      claws.forEach((claw, i) => {
        claw.rotation.x = Math.sin(time * 0.37 + i * 2.1) * 0.035
        claw.rotation.z = Math.sin(time * 0.29 + i) * 0.03
      })
      fireLight.intensity = 700 * (0.75 + 0.25 * Math.sin(time * 11) * Math.sin(time * 6.3 + 1))
    },
  }
}

// The road network as strokes: spokes (to the gates on the cardinals, the
// sheds on the diagonals), the ring road, the middle track and the perimeter
// road, then the Crest's floor.
function strokeRoads(ctx: CanvasRenderingContext2D, reach: number) {
  const line = (points: Array<[number, number]>, width: number, closed = false) => {
    ctx.lineWidth = width
    ctx.beginPath()
    points.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)))
    if (closed) ctx.closePath()
    ctx.stroke()
  }
  SPOKES.forEach((angle, k) => line([polar(CENTRE_RADIUS, angle), polar(k % 2 ? PERIMETER + 7 : reach, angle)], ROAD_WIDTH))
  line(octagon(TRACK), TRACK_WIDTH, true)
  line(octagon(PERIMETER), PERIMETER_WIDTH, true)
  ctx.lineWidth = RING_WIDTH
  ctx.beginPath()
  ctx.arc(0, 0, RING_RADIUS, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, CENTRE_RADIUS, 0, Math.PI * 2)
  ctx.fill()
}

// Minimap floor: the yard octagon and its roads.
function paintMap(ctx: CanvasRenderingContext2D) {
  ctx.beginPath()
  octagon(BOUNDARY).forEach(([x, z]) => ctx.lineTo(x, z))
  ctx.closePath()
  ctx.fillStyle = 'rgba(64, 52, 43, 0.75)'
  ctx.fill()
  ctx.strokeStyle = ctx.fillStyle = 'rgba(150, 128, 102, 0.4)'
  strokeRoads(ctx, BOUNDARY)
}

// Macro look of the yard floor, in world metres. Roads are packed and paler,
// tyre ruts hold water, puddles pool on the roads, the ground is burnt black
// under fires.
function paintYard(tint: CanvasRenderingContext2D, wet: CanvasRenderingContext2D, rng: () => number, scorches: Array<[number, number, number]>) {
  const reach = APOTHEM + 26
  tint.fillStyle = 'rgb(110,104,98)'
  tint.fillRect(-reach, -reach, 2 * reach, 2 * reach)
  wet.fillStyle = 'rgb(25,25,25)'
  wet.fillRect(-reach, -reach, 2 * reach, 2 * reach)
  for (const [ctx, style] of [
    [tint, 'rgb(146,136,122)'],
    [wet, 'rgb(50,50,50)'],
  ] as const) {
    ctx.strokeStyle = ctx.fillStyle = style
    strokeRoads(ctx, APOTHEM)
  }

  // Ruts: two wheel tracks per lane, wobbling slightly.
  const rut = (points: Array<[number, number]>) => {
    for (const [ctx, style, width] of [
      [tint, 'rgb(92,84,76)', 0.45],
      [wet, 'rgb(200,200,200)', 0.35],
    ] as const) {
      ctx.strokeStyle = style
      ctx.lineWidth = width
      ctx.beginPath()
      points.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)))
      ctx.stroke()
    }
  }
  // along an octagon `apothem` out, wobbling in and out
  const loop = (apothem: number) => {
    const points: Array<[number, number]> = []
    const edge = apothem * Math.tan(Math.PI / 8)
    for (const angle of SPOKES) {
      for (let s = -edge; s < edge; s += 2) points.push(beside(angle, apothem + Math.sin(s * 0.21 + angle * 3) * 0.3, s))
    }
    points.push(points[0])
    return points
  }
  for (const offset of [-3.7, -1.8, 1.8, 3.7]) {
    SPOKES.forEach((angle, k) => {
      const points: Array<[number, number]> = []
      for (let r = CENTRE_RADIUS; r <= (k % 2 ? PERIMETER : APOTHEM); r += 2) points.push(beside(angle, r, offset + Math.sin(r * 0.21 + offset) * 0.35))
      rut(points)
    })
    const ring: Array<[number, number]> = []
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) ring.push(polar(RING_RADIUS + offset * 0.8 + Math.sin(a * 5) * 0.3, a))
    rut(ring)
    rut(loop(PERIMETER + offset))
  }
  for (const offset of [-2.6, -1, 1, 2.6]) rut(loop(TRACK + offset))

  // Puddles pool on the roads: clusters of overlapping blobs.
  wet.fillStyle = '#fff'
  for (let i = 0; i < 320; i++) {
    const angle = SPOKES[Math.floor(rng() * 8)]
    const roll = rng()
    const [x, z] =
      roll < 0.35
        ? beside(angle, RING_RADIUS + rng() * (PERIMETER - RING_RADIUS), (rng() - 0.5) * 8)
        : roll < 0.5
          ? polar(RING_RADIUS + (rng() - 0.5) * 7, rng() * Math.PI * 2)
          : roll < 0.7
            ? beside(angle, TRACK + (rng() - 0.5) * 6, (rng() - 0.5) * 2 * TRACK * Math.tan(Math.PI / 8))
            : beside(angle, PERIMETER + (rng() - 0.5) * 10, (rng() - 0.5) * 2 * PERIMETER * Math.tan(Math.PI / 8))
    const blobs = 2 + Math.floor(rng() * 4)
    for (let b = 0; b < blobs; b++) {
      wet.beginPath()
      wet.ellipse(x + (rng() - 0.5) * 3, z + (rng() - 0.5) * 3, 0.6 + rng() * 2, 0.4 + rng() * 1.2, rng() * Math.PI, 0, Math.PI * 2)
      wet.fill()
    }
  }

  // scorched ground under everything burning
  for (const [x, z, radius] of scorches) {
    if (radius <= 0) continue
    const burn = tint.createRadialGradient(x, z, 0, x, z, radius)
    burn.addColorStop(0, 'rgba(10,8,7,0.85)')
    burn.addColorStop(1, 'rgba(10,8,7,0)')
    tint.fillStyle = burn
    tint.fillRect(x - radius, z - radius, 2 * radius, 2 * radius)
  }
}
