import * as THREE from 'three'
import { scatter, transform } from '../../render/geometry.ts'
import { materials } from '../../render/materials/library.ts'
import { baleGeometry, drumGeometry, tyreGeometry, WRECK_VARIANTS, wreckGeometry, type LocalCollider } from './kit/props.ts'

export interface SpawnPoint {
  position: THREE.Vector3
  heading: number // rotation.y for a vehicle facing +Z
}

// World-space collision shapes for gameplay physics (see physics.ts).
export type ArenaCollider =
  | { box: THREE.Vector3; position: THREE.Vector3; rotation: THREE.Quaternion } // half extents
  | { cylinder: [number, number]; position: THREE.Vector3 } // upright: [radius, half height]
  | { hull: THREE.Vector3[] } // convex

// Where bots can drive: waypoints joined by straight, unobstructed hops.
export interface NavGraph {
  nodes: THREE.Vector3[]
  links: number[][] // per node, the nodes a car reaches from it in a straight line
}

// A continuous effect the match keeps emitting (effects.ts): a burning wreck
// or barrel, steam off a manhole, a smoke column over a fire.
export interface Emitter {
  kind: 'fire' | 'steam' | 'plume'
  position: THREE.Vector3
}

// A named part of the map, metres: where a free-for-all hot zone can open.
export interface Area {
  name: string
  x: number
  z: number
  radius: number
}

export interface Arena {
  name: string
  root: THREE.Group
  spawns: SpawnPoint[] // free-for-all starts, spread: each far from the ones before it
  bases?: [SpawnPoint[], SpawnPoint[]] // team starts, one list per crew: team deathmatch needs them
  zones?: Area[] // free-for-all hot zones: free for all needs them
  colliders: ArenaCollider[] // the drivable area's solid footprint, boundary included
  nav: NavGraph
  emitters: Emitter[]
  extent: number // half the side of the square the minimap covers, metres
  mapRange: number // metres from the minimap's centre to its rim
  paintMap(ctx: CanvasRenderingContext2D): void // minimap floor in world metres (x east, y south); solid footprints are drawn over it
  update(time: number): void
}

// A nav graph from (x, z) points and the index pairs linked both ways.
export function navGraph(points: Array<[number, number]>, pairs: Array<[number, number]>): NavGraph {
  const nodes = points.map(([x, z]) => new THREE.Vector3(x, 0, z))
  const links = nodes.map((): number[] => [])
  for (const [a, b] of pairs) {
    links[a].push(b)
    links[b].push(a)
  }
  return { nodes, links }
}

const WRECK_TINTS = ['#7a2a20', '#2a4256', '#4f5a35', '#8b8578', '#2e2e2c', '#6e2a2a', '#9a8f7a', '#4a3b2e', '#3f5e6e']
const DRUM_TINTS = ['#7d1e14', '#23405a', '#6a6a30', '#3a3a38']
const UP = new THREE.Vector3(0, 1, 0)

// Angles run from +X toward +Z (east = 0, south = π/2, west = π, north = -π/2).
export const polar = (radius: number, angle: number): [number, number] => [Math.cos(angle) * radius, Math.sin(angle) * radius]

// Static scenery is merged per material in square chunks, so the camera and
// the shadow map skip what is out of view.
export function chunks(count: number, size: number) {
  const groups = Array.from({ length: count * count }, () => new THREE.Group())
  const cell = size / count
  const index = (v: number) => Math.min(count - 1, Math.max(0, Math.floor((v + size / 2) / cell)))
  return { groups, at: (x: number, z: number) => groups[index(x) * count + index(z)] }
}

// Reorders spawns so each is as far as possible from every one before it.
export function spreadOut(spawns: SpawnPoint[]) {
  for (let i = 1; i < spawns.length; i++) {
    let best = i
    let bestRoom = -1
    for (let j = i; j < spawns.length; j++) {
      const room = Math.min(...spawns.slice(0, i).map((s) => s.position.distanceTo(spawns[j].position)))
      if (room > bestRoom) {
        bestRoom = room
        best = j
      }
    }
    ;[spawns[i], spawns[best]] = [spawns[best], spawns[i]]
  }
  return spawns
}

// Instanced junk — car shells, bales, tyres, drums — gathered while laying
// out and built at the end, one draw call per kind. Pass `colliders` to make it solid.
export function clutterKit(rng: () => number, castShadow: boolean, colliders?: ArenaCollider[]) {
  const pick = <T>(items: T[]) => items[Math.floor(rng() * items.length)]
  const wrecks = Array.from({ length: WRECK_VARIANTS }, () => ({ matrices: [] as THREE.Matrix4[], tints: [] as THREE.Color[] }))
  const tyres: THREE.Matrix4[] = []
  const drums: THREE.Matrix4[] = []
  const drumTints: THREE.Color[] = []
  const bales: THREE.Matrix4[] = []
  const baleTints: THREE.Color[] = []
  const cylinder = (x: number, z: number, radius: number, height: number) =>
    colliders?.push({ cylinder: [radius, height / 2], position: new THREE.Vector3(x, height / 2, z) })

  const kit = {
    // `yaw` lines a shell up (parked cars); otherwise it lands any way round.
    wreck(x: number, y: number, z: number, tilt: number, isSolid = false, yaw?: number, tint?: string) {
      const flipped = rng() < 0.12
      const slot = wrecks[Math.floor(rng() * WRECK_VARIANTS)]
      const pitch = (rng() - 0.5) * tilt
      const spin = rng() * Math.PI * 2
      const matrix = transform([x, y + (flipped ? 1.45 : 0), z], [pitch, yaw ?? spin, (rng() - 0.5) * tilt + (flipped ? Math.PI : 0)])
      slot.matrices.push(matrix)
      const paint = pick(WRECK_TINTS)
      slot.tints.push(new THREE.Color(tint ?? paint))
      if (isSolid) {
        const rotation = new THREE.Quaternion().setFromRotationMatrix(matrix)
        colliders?.push({ box: new THREE.Vector3(0.9, 0.75, 2.3), position: new THREE.Vector3(0, 0.75, 0).applyMatrix4(matrix), rotation })
      }
    },
    tyreStack(x: number, z: number, count: number) {
      for (let i = 0; i < count; i++) tyres.push(transform([x + (rng() - 0.5) * 0.1, i * 0.3, z + (rng() - 0.5) * 0.1], [0, rng() * Math.PI, 0]))
      cylinder(x, z, 0.45, count * 0.3)
    },
    drums(x: number, z: number, count: number) {
      for (let i = 0; i < count; i++) {
        const [dx, dz] = polar(0.3 + rng() * 1.4, rng() * Math.PI * 2)
        const tipped = rng() < 0.2
        drums.push(transform([x + dx, tipped ? 0.29 : 0, z + dz], [tipped ? Math.PI / 2 : 0, rng() * Math.PI * 2, 0]))
        drumTints.push(new THREE.Color(pick(DRUM_TINTS)))
        if (tipped) cylinder(x + dx, z + dz, 0.46, 0.58)
        else cylinder(x + dx, z + dz, 0.3, 0.88)
      }
    },
    // Mound of shells, taller in the middle, ringed by loose tyres.
    junkPile(x: number, z: number, radius: number, count: number) {
      for (let i = 0; i < count; i++) {
        const layer = i < count * 0.55 ? 0 : i < count * 0.85 ? 1 : 2
        const [dx, dz] = polar(radius * (1 - layer * 0.3) * Math.sqrt(rng()), rng() * Math.PI * 2)
        kit.wreck(x + dx, layer * 1.15, z + dz, layer ? 0.5 : 0.2)
      }
      for (let i = 0; i < count / 3; i++) {
        const [dx, dz] = polar(radius + 1 + rng() * 2, rng() * Math.PI * 2)
        kit.tyreStack(x + dx, z + dz, 1 + Math.floor(rng() * 4))
      }
      cylinder(x, z, radius + 1, 3.2) // shells overhang the scatter radius
    },
    // Shells and loose tyres strewn over a heap `radius` across and `height`
    // tall (a junkMound the caller places), sunk in so they read as buried.
    // Solid as a squat cylinder: only the slopes' foot matters at car height.
    heap(x: number, z: number, radius: number, height: number, shells: number, loose: number) {
      const surface = (d: number) => height * Math.sqrt(Math.max(0, 1 - d * d))
      for (let i = 0; i < shells + loose; i++) {
        const d = Math.sqrt(rng()) * 0.9
        const [dx, dz] = polar(radius * d, rng() * Math.PI * 2)
        if (i < shells) kit.wreck(x + dx, surface(d) - 0.9, z + dz, 1.2)
        else tyres.push(transform([x + dx, surface(d) - 0.35, z + dz], [(rng() - 0.5) * 1.4, rng() * Math.PI * 2, (rng() - 0.5) * 1.4]))
      }
      cylinder(x, z, radius * 0.8, height)
    },
    // A wall of shells stacked `levels` high along the line from a to b, lying
    // lengthwise, askew. Solid as one box.
    wall(ax: number, az: number, bx: number, bz: number, levels = 2) {
      const length = Math.hypot(bx - ax, bz - az)
      const [ux, uz] = [(bx - ax) / length, (bz - az) / length]
      const yaw = Math.atan2(ux, uz)
      for (let level = 0; level < levels; level++) {
        for (let s = 2 + level * 1.8; s < length - 1.5; s += 3.6 + rng() * 0.8) {
          if (level && rng() < 0.25) continue
          const off = (rng() - 0.5) * 0.6
          kit.wreck(
            ax + ux * s - uz * off,
            level * 1.15,
            az + uz * s + ux * off,
            level ? 0.5 : 0.2,
            false,
            yaw + (rng() - 0.5) * 0.5 + (rng() < 0.5 ? 0 : Math.PI),
          )
        }
      }
      colliders?.push({
        box: new THREE.Vector3(1.1, levels * 0.6, length / 2),
        position: new THREE.Vector3((ax + bx) / 2, levels * 0.6, (az + bz) / 2),
        rotation: new THREE.Quaternion().setFromAxisAngle(UP, yaw),
      })
    },
    // A block of crushed-car bales `rows` long along `yaw` and `levels`
    // high, a few missing off the top. Solid as one box.
    bales(x: number, z: number, yaw: number, rows: number, levels: number) {
      const [ax, az] = [Math.cos(yaw), -Math.sin(yaw)] // the block's x axis
      for (let i = 0; i < rows; i++) {
        for (let level = 0; level < levels; level++) {
          if (level && rng() < 0.2) continue
          const s = (i - (rows - 1) / 2) * 2.5
          bales.push(transform([x + ax * s + (rng() - 0.5) * 0.2, level * 1.1, z + az * s + (rng() - 0.5) * 0.2], [0, yaw + (rng() - 0.5) * 0.12, 0]))
          baleTints.push(new THREE.Color(pick(WRECK_TINTS)))
        }
      }
      colliders?.push({
        box: new THREE.Vector3(rows * 1.25, levels * 0.55, 0.85),
        position: new THREE.Vector3(x, levels * 0.55, z),
        rotation: new THREE.Quaternion().setFromAxisAngle(UP, yaw),
      })
    },
    build() {
      const meshes = wrecks.flatMap(({ matrices, tints }, variant) =>
        matrices.length ? [scatter(wreckGeometry(variant), materials.wreck(), matrices, tints)] : [],
      )
      if (tyres.length) meshes.push(scatter(tyreGeometry(), materials.rubber(), tyres))
      if (drums.length) meshes.push(scatter(drumGeometry(), materials.drum(), drums, drumTints))
      if (bales.length) meshes.push(scatter(baleGeometry(), materials.wreck(), bales, baleTints))
      meshes.forEach((mesh) => (mesh.castShadow = castShadow))
      return meshes
    },
  }
  return kit
}

// World-space shapes of every solid() prop under `root`, which must not be merged yet.
export function collectColliders(root: THREE.Object3D, out: ArenaCollider[]) {
  root.updateMatrixWorld(true)
  root.traverse((object) => {
    for (const shape of (object.userData.colliders ?? []) as LocalCollider[]) {
      const position = new THREE.Vector3(...(shape.at ?? [0, 0, 0])).applyMatrix4(object.matrixWorld)
      if ('box' in shape)
        out.push({ box: new THREE.Vector3(...shape.box), position, rotation: new THREE.Quaternion().setFromRotationMatrix(object.matrixWorld) })
      else out.push({ cylinder: shape.cylinder, position })
    }
  })
}
