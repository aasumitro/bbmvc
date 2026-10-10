import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { ChaseCamera } from './camera.ts'
import { createInput, type InputState } from './input.ts'
import type { Combatant } from '../sim/simulation.ts'
import { wrap } from '../shared/math.ts'

// The local player as a control source. Before the steps: keyboard and
// mouse into the player's controls. After the camera has moved: the aim
// from the crosshair, pulled onto a hostile inside the lock-on window, and
// which rivals are in plain view (the HUD marks those). Bots are the other
// control source (sim/ai/); a network player would be a third, writing the
// same controls.

// Lock-on window around the crosshair, radians. Taller below: the camera
// looks over the car, so hostiles on the same ground sit under the crosshair.
const ASSIST = { side: 0.045, below: 0.14, above: 0.05 }

export interface PilotOptions {
  surface: HTMLElement // takes the mouse and pointer lock
  camera: THREE.PerspectiveCamera
  world: RAPIER.World
  chase: ChaseCamera
  player: Combatant
  combatants: readonly Combatant[]
  combatantOf: (collider: RAPIER.Collider) => Combatant | undefined
}

export function createPilot({ surface, camera, world, chase, player, combatants, combatantOf }: PilotOptions) {
  const input = createInput(surface)
  const controls: InputState = { throttle: 0, steer: 0, handbrake: false, recover: false, fire: false, lookX: 0, lookY: 0 }
  const others = combatants.filter((c) => c !== player)
  const seen = combatants.map(() => false) // by id: in plain view of the camera; refreshed a few times a second
  const aim = { target: null as Combatant | null, distance: 0 } // the hostile under the crosshair
  const hostile = (c: Combatant) => c.team !== player.team

  // The player aims where the crosshair (screen centre) points; a hostile
  // inside the lock-on window, in plain view, pulls the aim onto itself.
  const aimRay = new RAPIER.Ray(new THREE.Vector3(), new THREE.Vector3())
  const toRival = new THREE.Vector3()
  function layAim() {
    const range = player.weapon.spec.range
    const view = chase.forward
    aimRay.origin = camera.position
    aimRay.dir = view
    const hit = world.castRay(aimRay, range, true, undefined, undefined, undefined, player.car.body)
    player.control.aim.copy(camera.position).addScaledVector(view, hit ? hit.timeOfImpact : range)
    const struck = hit && combatantOf(hit.collider)
    let target = struck && struck.alive && hostile(struck) ? struck : null
    if (!target) {
      let best = Infinity
      for (const rival of others) {
        if (!rival.alive || !hostile(rival)) continue
        toRival.copy(rival.position).y += 1
        toRival.sub(camera.position)
        const distance = toRival.length()
        const side = Math.abs(wrap(Math.atan2(toRival.x, toRival.z) - Math.atan2(view.x, view.z)))
        const rise = Math.asin(toRival.y / distance) - Math.asin(view.y)
        const miss = side + Math.abs(rise) * 0.3
        if (distance > range || side > ASSIST.side || rise < -ASSIST.below || rise > ASSIST.above || miss >= best) continue
        aimRay.dir = toRival.divideScalar(distance)
        const sight = world.castRay(aimRay, distance, true, undefined, undefined, undefined, player.car.body)
        if (sight && combatantOf(sight.collider) !== rival) continue
        best = miss
        target = rival
      }
      if (target) player.control.aim.copy(target.position).y += 1
    }
    aim.target = player.alive ? target : null
    aim.distance = target ? target.position.distanceTo(player.position) : 0
  }

  // Which rivals the camera can see, for the HUD markers.
  const sightRay = new RAPIER.Ray(new THREE.Vector3(), new THREE.Vector3())
  const toBody = new THREE.Vector3()
  let sightCheck = 0
  function look(dt: number) {
    sightCheck -= dt
    if (sightCheck > 0) return
    sightCheck = 0.15
    for (const rival of others) {
      toBody.copy(rival.position).y += 1.2
      toBody.sub(camera.position)
      const distance = toBody.length()
      sightRay.origin = camera.position
      sightRay.dir = toBody.divideScalar(distance)
      const hit = world.castRay(sightRay, distance, true, undefined, undefined, undefined, player.car.body)
      seen[rival.id] = rival.alive && (!hit || combatantOf(hit.collider) === rival)
    }
  }

  return {
    controls, // this frame's sample: the chase camera takes the look
    others, // everyone but the player
    seen,
    aim,
    locked: input.locked,
    lock: input.lock, // captures the mouse again (resume, play again)
    // Samples the devices once per frame: driving and firing only when
    // `driving`, looking around only when `looking`.
    read(looking: boolean, driving: boolean) {
      input.read(controls)
      const control = player.control
      control.throttle = driving ? controls.throttle : 0
      control.steer = driving ? controls.steer : 0
      control.handbrake = driving && controls.handbrake
      control.recover = driving && controls.recover
      control.fire = driving && controls.fire
      if (!looking) controls.lookX = controls.lookY = 0
    },
    layAim,
    look,
    unlock: input.unlock,
    dispose: input.dispose,
  }
}
