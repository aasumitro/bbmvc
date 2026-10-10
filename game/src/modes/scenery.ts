import type * as THREE from 'three'
import { createHotZone } from './ffa/zone.ts'
import type { Mode } from './ids.ts'
import { createPickups } from './items/pickups.ts'
import type { MODES } from './modes.ts'

// What the browser draws of a running mode besides the machines: the
// pickups' tokens, from any mode's supply, and a mode's own scenery (free
// for all's hot zone). Client-only: the modes run headless on the server,
// and none of this reaches its bundle. Each piece is pooled and parked at
// its creation, so the scene's shader compile covers it up front.

export type RunningMode = ReturnType<(typeof MODES)[Mode]['create']>

export interface Scenery {
  update(camera: THREE.Camera): void // per frame
  clear(): void // a new match
  dispose(): void
}

const MODE_SCENERY: Partial<Record<Mode, (scene: THREE.Scene, mode: RunningMode) => Scenery>> = {
  ffa(scene, mode) {
    const zone = createHotZone(scene)
    return {
      update: (camera) => zone.update('zone' in mode.rules ? mode.rules.zone : null, camera),
      clear: () => zone.clear(),
      dispose: () => zone.dispose(),
    }
  },
}

export function createScenery(scene: THREE.Scene, kind: Mode, mode: RunningMode): Scenery {
  const pickups = mode.supply && createPickups(scene)
  const own = MODE_SCENERY[kind]?.(scene, mode)
  return {
    update(camera) {
      if (pickups && mode.supply) pickups.update(mode.supply.items, mode.rules.now, camera)
      own?.update(camera)
    },
    clear() {
      pickups?.clear()
      own?.clear()
    },
    dispose() {
      pickups?.dispose()
      own?.dispose()
    },
  }
}
