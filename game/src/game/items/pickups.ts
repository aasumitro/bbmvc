import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { materials } from '../materials/library'
import { SUPPLY } from './config'
import { ITEMS, RARITY_COLORS, type Item, type ItemType, type Rarity } from './items'

// What items look like on the ground. Each item: a glowing token in its
// type's colour, spinning over a soft pool of its rarity's colour, with a
// light column to spot it from down the street; it blinks through its last
// seconds. View only — it mirrors the supply every frame from a fixed pool,
// so nothing is created or left behind during play.

const TYPES = Object.keys(ITEMS) as ItemType[]
const RARITIES: Rarity[] = ['common', 'rare', 'epic']
const HOVER = 1.3 // token height, metres
const BLINK = 5 // seconds before expiry the token starts blinking

function tokenGeometry(type: ItemType) {
  switch (type) {
    case 'health':
      return mergeGeometries([new THREE.BoxGeometry(0.95, 0.3, 0.3), new THREE.BoxGeometry(0.3, 0.95, 0.3)])
    case 'repair':
      return new THREE.TorusGeometry(0.34, 0.12, 8, 6) // a nut
    case 'ammo':
      return mergeGeometries([-0.26, 0, 0.26].flatMap((x) => [new THREE.CylinderGeometry(0.1, 0.1, 0.55, 10).translate(x, -0.1, 0), new THREE.ConeGeometry(0.1, 0.25, 10).translate(x, 0.3, 0)]))
    case 'speed':
      return new THREE.ConeGeometry(0.42, 0.95, 3)
    case 'armor':
      return new THREE.CylinderGeometry(0.5, 0.5, 0.16, 6).rotateX(Math.PI / 2) // hex plate, face on
    case 'damage':
      return new THREE.OctahedronGeometry(0.5)
  }
}

export type Pickups = ReturnType<typeof createPickups>

export function createPickups(scene: THREE.Scene) {
  const root = new THREE.Group()
  root.name = 'pickups'
  const tokens = Object.fromEntries(TYPES.map((type) => [type, tokenGeometry(type)])) as Record<ItemType, THREE.BufferGeometry>
  const pool = new THREE.CircleGeometry(1.7, 32).rotateX(-Math.PI / 2)
  const column = new THREE.PlaneGeometry(1.3, 16) // centred on the ground: the ground hides the lower half

  const slots = Array.from({ length: SUPPLY.maxActive }, (_, k) => {
    const group = new THREE.Group()
    const token = new THREE.Mesh(tokens[TYPES[k % TYPES.length]], materials.light(ITEMS[TYPES[k % TYPES.length]].color, 3))
    const glow = new THREE.Mesh(pool, materials.glow(RARITY_COLORS[RARITIES[k % 3]], 0.55))
    const beam = new THREE.Mesh(column, materials.glow(RARITY_COLORS[RARITIES[k % 3]], 0.3))
    glow.position.y = 0.2
    token.castShadow = true
    group.add(token, glow, beam)
    group.position.y = -100 // parked out of sight, but visible: the scene compile covers every material up front
    root.add(group)
    return { group, token, glow, beam, id: -1 }
  })
  scene.add(root)

  function assign(slot: (typeof slots)[number], item: Item) {
    slot.id = item.id
    slot.token.geometry = tokens[item.type]
    slot.token.material = materials.light(ITEMS[item.type].color, 3)
    slot.glow.material = materials.glow(RARITY_COLORS[item.rarity], 0.55)
    slot.beam.material = materials.glow(RARITY_COLORS[item.rarity], item.rarity === 'common' ? 0.2 : 0.35)
    slot.group.position.set(item.x, 0, item.z)
  }

  return {
    // Mirrors the live items; `now` is the match clock.
    update(items: readonly Item[], now: number, camera: THREE.Camera) {
      for (let k = 0; k < slots.length; k++) {
        const slot = slots[k]
        const item = items[k]
        slot.group.visible = !!item
        if (!item) {
          slot.id = -1
          continue
        }
        if (slot.id !== item.id) assign(slot, item)
        slot.token.position.y = HOVER + Math.sin(now * 2.2 + item.id) * 0.15
        slot.token.rotation.y = now * 1.8 + item.id
        slot.token.visible = item.expires - now > BLINK || Math.floor(now * 6) % 2 === 0
        slot.beam.rotation.y = Math.atan2(camera.position.x - item.x, camera.position.z - item.z)
      }
    },
    clear() {
      for (const slot of slots) {
        slot.group.visible = false
        slot.id = -1
      }
    },
    // Geometries are this view's own; materials belong to the library.
    dispose() {
      scene.remove(root)
      for (const geometry of [...Object.values(tokens), pool, column]) geometry.dispose()
    },
  }
}
