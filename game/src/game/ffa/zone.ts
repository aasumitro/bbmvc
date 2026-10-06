import * as THREE from 'three'
import { materials } from '../materials/library'
import type { Zone } from './rules'

// What the hot zone looks like: a ring on the streets and posts of light
// round it, turned to the camera. View only — it follows the rules' zone.

const POSTS = 10 // light posts round the hot zone
const ZONE_COLOR = '#ff5a1f'

export type HotZone = ReturnType<typeof createHotZone>

export function createHotZone(scene: THREE.Scene) {
  const ring = new THREE.RingGeometry(0.985, 1, 128).rotateX(-Math.PI / 2)
  const post = new THREE.PlaneGeometry(2.4, 22)
  const zone = new THREE.Group()
  zone.name = 'hot zone'
  const band = new THREE.Mesh(ring, materials.light(ZONE_COLOR, 2.5))
  band.position.y = 0.2 // over the kerbs
  const posts = Array.from({ length: POSTS }, () => new THREE.Mesh(post, materials.glow(ZONE_COLOR, 0.5)))
  zone.add(band, ...posts)
  zone.position.y = -100 // parked out of sight, but visible: the scene compile covers every material up front
  scene.add(zone)
  let shown: Zone | null | undefined

  return {
    update(hot: Zone | null, camera: THREE.Camera) {
      if (hot !== shown) {
        shown = hot
        zone.visible = !!hot
        if (hot) {
          zone.position.set(hot.x, 0, hot.z)
          band.scale.setScalar(hot.radius)
          posts.forEach((p, i) => p.position.set(Math.cos((i / POSTS) * Math.PI * 2) * hot.radius, 0, Math.sin((i / POSTS) * Math.PI * 2) * hot.radius))
        }
      }
      if (hot) for (const p of posts) p.rotation.y = Math.atan2(camera.position.x - hot.x - p.position.x, camera.position.z - hot.z - p.position.z)
    },
    clear() {
      zone.visible = false
      shown = null
    },
    // Geometries are this view's own; materials belong to the library.
    dispose() {
      scene.remove(zone)
      ring.dispose()
      post.dispose()
    },
  }
}
