import './headless.ts'
import * as THREE from 'three'
import type { Arena } from '../src/content/arenas/arena.ts'
import { disposeGeometries } from '../src/render/geometry.ts'
import { MAPS, type MapId } from '../src/content/arenas/maps.ts'

// The arenas as the game server needs them: what a match is played on — the
// colliders, starts, team bases, hot zones and road graph — built by the
// browser's own builders (MAPS[id].build(), run headless: headless.ts), then
// stripped of everything that is only looked at. Built once per map and kept
// for the life of the process; every room on that map shares it (nothing in
// it changes during play).

const built = new Map<MapId, Arena>()

export function arenaData(id: MapId): Arena {
  let arena = built.get(id)
  if (!arena) built.set(id, (arena = strip(MAPS[id].build())))
  return arena
}

// A fresh object, so nothing keeps the meshes alive: the arena's own update()
// and paintMap() close over its scenery.
function strip({ name, root, spawns, bases, zones, colliders, nav, extent, mapRange }: Arena): Arena {
  disposeGeometries(root)
  root.clear()
  return { name, root: new THREE.Group(), spawns, bases, zones, colliders, nav, emitters: [], extent, mapRange, paintMap() {}, update() {} }
}
