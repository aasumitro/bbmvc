import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { Arena } from './arena/arena'
import { playSound, setListener, startEngine, startLoop, type Loop } from './audio'
import { createChaseCamera } from './camera'
import { createEffects } from './effects'
import { disposeGeometries } from './geometry'
import { LIVERIES, materials } from './materials/library'
import type { Combatant, SimEvents } from './simulation'
import { poseWheels } from './vehicle/drive'
import { MODELS } from './vehicle/vehicle'
import { VEHICLES } from './vehicle/vehicles'

// The match as the local player sees and hears it: a model per machine,
// mirroring the simulation and interpolated between its steps, turrets laid
// on their aim, effects, engines and the rest of the sound, the chase camera
// and the HUD's feedback pulses. It hears about shots, blasts and wrecks
// through the simulation's SimEvents; it decides nothing about the match.

const WHIZ_RANGE = 4 // metres: a rival's round passing this close to the player is heard going by

// A machine's model, and the parts of it gameplay moves.
export interface CarView {
  model: THREE.Group
  wheels: THREE.Object3D[] // in the chassis' wheel order
  turret: THREE.Object3D
  gun: THREE.Object3D
  paint: Map<THREE.Mesh, THREE.Material | THREE.Material[]> // restored after a wreck respawns
}

// What the HUD shows for a moment after something happens to the player:
// decaying 0..1 pulses, and lines on a timer (written by the feed).
export interface Feedback {
  hit: number
  kill: number
  damage: number
  damageFrom: THREE.Vector3
  message: string
  messageTime: number
  pickup: string
  pickupColor: string
  pickupTime: number
  killer: string // who last wrecked the player
}

export interface ViewOptions {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  surface: HTMLCanvasElement // the canvas drawn into: particle sizes follow its height
  world: RAPIER.World // the chase camera keeps its lens out of walls
  arena: Arena
  combatants: readonly Combatant[]
  player: Combatant // whose eyes and ears these are
}

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

// Sideways speed across the car's nose (m/s): how hard it is sliding.
const slip = (c: Combatant) => {
  const { x, y, z, w } = c.rotation
  return Math.abs(c.velocity.x * (1 - 2 * (y * y + z * z)) + c.velocity.z * 2 * (x * z - w * y))
}

export function createMatchView({ scene, camera, surface, world, arena, combatants, player }: ViewOptions) {
  const chase = createChaseCamera(camera, world, player.car.handling.maxSpeed)
  const effects = createEffects(scene)
  // Liveries by side, as the player sees it: theirs, their crew's, everyone else's.
  function build(c: Combatant): CarView {
    const livery = c === player ? LIVERIES.hazard : c.team === player.team ? LIVERIES.cobalt : LIVERIES.crimson
    const model = MODELS[c.vehicle]({ livery, seed: c.seed, turret: c.weapon.spec.model })
    const paint = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) paint.set(object, object.material)
    })
    scene.add(model)
    return { model, wheels: c.car.chassis.wheels.map(([id]) => model.getObjectByName(`wheel_${id}`)!), turret: model.getObjectByName('turret')!, gun: model.getObjectByName('gun')!, paint }
  }
  const cars = combatants.map(build)

  // Engine note per car (the player's centred, the rest placed in the
  // world), the player's gun spin-up and tyre squeal, the wind, fire on wrecks.
  const engines = combatants.map(() => startEngine())
  const gunSpin = startLoop('spin')
  const tyres = startLoop('skid')
  const wind = startLoop('ambience')
  wind.set(1)
  const burning = new Map<Combatant, Loop>()

  const muzzleLight = new THREE.PointLight('#ffb35c', 0, 9, 2) // lights the roof and yard around the player's gun
  muzzleLight.position.set(0, 0, VEHICLES[player.vehicle].turret.barrel + 0.2)
  cars[player.id].gun.add(muzzleLight)
  let muzzleFlash = 0

  const feedback: Feedback = { hit: 0, kill: 0, damage: 0, damageFrom: new THREE.Vector3(), message: '', messageTime: 0, pickup: '', pickupColor: '', pickupTime: 0, killer: '' }

  // A rival's round that flew close by the player's cab, heard where it passed.
  const path = new THREE.Vector3()
  const pass = new THREE.Vector3()
  const nearest = new THREE.Vector3()
  function whizPast(from: THREE.Vector3, to: THREE.Vector3) {
    path.subVectors(to, from)
    pass.copy(player.position).y += 1.2
    const along = THREE.MathUtils.clamp(nearest.subVectors(pass, from).dot(path) / path.lengthSq(), 0, 1)
    nearest.copy(from).addScaledVector(path, along)
    if (nearest.distanceTo(pass) < WHIZ_RANGE) playSound('whiz', nearest)
  }

  const blast = new THREE.Vector3()
  const away = new THREE.Vector3()
  const struck = new THREE.Vector3()
  const events: SimEvents = {
    fired(c, muzzle, heading) {
      effects.muzzle(muzzle, heading)
      const cue = c.weapon.spec.rocket ? 'launch' : 'shot'
      if (c !== player) return playSound(cue, muzzle)
      muzzleFlash = 1
      if (cue === 'launch') chase.shake(0.06)
      playSound(cue)
    },
    shot(c, muzzle, shot, victim) {
      effects.tracer(muzzle, shot.point)
      if (c !== player && player.alive && victim !== player) whizPast(muzzle, shot.point)
      if (!shot.collider) return
      effects.impact(shot.point, shot.normal, !!victim)
      if (victim !== player) playSound(victim ? 'hitMetal' : 'hitGround', shot.point)
    },
    rocket(from, to) {
      effects.rocket(from, to)
    },
    burst(at) {
      effects.explosion(at)
      playSound('explosion', at)
      chase.shake(Math.max(0, 1 - at.distanceTo(player.position) / 30) * 0.4)
    },
    hurt(victim, attacker) {
      if (victim === player) {
        feedback.damage = 1
        feedback.damageFrom.copy(attacker.position)
        chase.shake(0.08)
        playSound('damage')
      }
      if (attacker === player) {
        feedback.hit = 1
        playSound('hitmarker')
      }
    },
    wrecked(victim, attacker) {
      cars[victim.id].model.traverse((object) => {
        if (object instanceof THREE.Mesh) object.material = materials.charred()
      })
      blast.copy(victim.position).y += 1
      effects.explosion(blast)
      playSound('explosion', blast)
      burning.set(victim, startLoop('fire'))
      chase.shake(Math.max(0, 1 - victim.position.distanceTo(player.position) / 40) * 0.6)
      if (victim === player) {
        feedback.killer = attacker.name
      } else if (attacker === player) {
        feedback.kill = 1
        playSound('kill')
      }
    },
    crashed(c, x, z, force) {
      away.set(x, 0.25, z).normalize()
      struck.set(c.position.x - x * 1.8, c.position.y + 0.8, c.position.z - z * 1.8)
      effects.crash(struck, away, force)
      playSound('crash', struck, force)
      if (c === player) chase.shake(0.2 * force)
    },
    reloading(c, started) {
      if (c === player) playSound(started ? 'reload' : 'ready')
    },
    respawned(c) {
      burning.get(c)?.stop()
      burning.delete(c)
      const car = cars[c.id]
      car.paint.forEach((material, mesh) => (mesh.material = material))
      car.turret.rotation.y = 0
      car.gun.rotation.x = 0
      if (c === player) chase.snap()
    },
    recovered(c) {
      if (c === player) chase.snap()
    },
  }

  // Turret yaw and gun pitch ease onto the machine's aim point.
  const local = new THREE.Vector3()
  const mount = new THREE.Vector3()
  const inverse = new THREE.Quaternion()
  function layTurret(c: Combatant, dt: number) {
    if (!c.alive) return
    const { model, turret, gun } = cars[c.id]
    local.copy(c.control.aim).sub(model.position).applyQuaternion(inverse.copy(model.quaternion).invert()).sub(mount.set(...VEHICLES[c.vehicle].turret.mount))
    const k = 1 - Math.exp(-14 * dt)
    turret.rotation.y += wrap(Math.atan2(local.x, local.z) - turret.rotation.y) * k
    const pitch = Math.atan2(local.y, Math.hypot(local.x, local.z))
    gun.rotation.x += (THREE.MathUtils.clamp(-pitch, -0.45, 0.2) - gun.rotation.x) * k
  }

  // Smoke from damaged cars, fire on wrecks, dust and tyre smoke off the rear
  // wheels; the arena's own fires, steam and smoke columns.
  const spot = new THREE.Vector3()
  function ambient(dt: number) {
    for (const { kind, position } of arena.emitters) {
      if (kind === 'plume') effects.plume(position, dt) // tall enough to see from anywhere
      else if (position.distanceToSquared(camera.position) < 150 * 150) effects[kind === 'fire' ? 'burn' : 'steam'](position, dt)
    }
    for (const c of combatants) {
      if (!c.present) continue // an empty seat: nothing there
      const { model } = cars[c.id]
      if (!c.alive) {
        effects.burn(spot.set(0, 1.1, 1.3).applyQuaternion(model.quaternion).add(model.position), dt)
        continue
      }
      if (c.health < c.maxHealth / 2) effects.smoke(spot.set(0, 1.4, 1.5).applyQuaternion(model.quaternion).add(model.position), 1 - (2 * c.health) / c.maxHealth, dt)
      const pace = Math.abs(c.speed) / c.car.handling.maxSpeed + (c.control.handbrake ? 0.6 : 0)
      const sliding = Math.min((slip(c) - 2.5) / 5, 1)
      if (pace < 0.2 && sliding <= 0) continue
      for (let i = 2; i < 4; i++) {
        if (!c.car.controller.wheelIsInContact(i)) continue
        const [, x, z] = c.car.chassis.wheels[i]
        spot.set(x, 0.15, z).applyQuaternion(model.quaternion).add(model.position)
        effects.dust(spot, Math.min(pace, 1.2), dt)
        if (sliding > 0) effects.tyreSmoke(spot, sliding, dt)
      }
    }
  }

  function sound(dt: number) {
    setListener(camera.position, chase.forward)
    combatants.forEach((c, i) => {
      engines[i].update(Math.min(Math.abs(c.speed) / c.car.handling.maxSpeed, 1), c.alive ? c.control.throttle : 0, c.alive, dt, c === player ? undefined : cars[i].model.position)
    })
    const firing = player.alive && player.control.fire && player.weapon.reload === 0 && !player.weapon.spec.rocket
    gunSpin.set(firing ? 1 : 0, firing ? 1 : 0.6)
    const grounded = player.car.controller.wheelIsInContact(2) || player.car.controller.wheelIsInContact(3)
    const braking = player.control.throttle * player.speed < 0 && Math.abs(player.speed) > 6 ? 0.35 : 0
    tyres.set(player.alive && grounded ? THREE.MathUtils.clamp((slip(player) - 1.5) / 5 + braking, 0, 1) : 0)
    burning.forEach((loop, c) => loop.set(c.present ? 1 : 0, undefined, cars[c.id].model.position))
  }

  return {
    chase,
    cars, // by combatant id
    feedback,
    events,
    // Every model between the last two steps (`alpha` of the way there), wheels on their suspension; an empty seat's hidden.
    place(alpha: number) {
      for (const c of combatants) {
        const { model, wheels } = cars[c.id]
        model.visible = c.present
        model.position.lerpVectors(c.last.position, c.position, alpha)
        model.quaternion.slerpQuaternions(c.last.rotation, c.rotation, alpha)
        poseWheels(c.car, wheels)
      }
    },
    // Once the camera and the aim are set: turrets, effects, sound, the HUD's pulses fading.
    animate(dt: number) {
      for (const c of combatants) layTurret(c, dt)
      ambient(dt)
      sound(dt)
      effects.update(camera, surface.height, dt)
      muzzleLight.intensity = 60 * muzzleFlash
      muzzleFlash = Math.max(0, muzzleFlash - dt * 25)
      feedback.hit = Math.max(0, feedback.hit - dt * 5)
      feedback.kill = Math.max(0, feedback.kill - dt * 1.2)
      feedback.damage = Math.max(0, feedback.damage - dt * 1.8)
      feedback.messageTime = Math.max(0, feedback.messageTime - dt)
      feedback.pickupTime = Math.max(0, feedback.pickupTime - dt)
    },
    // The machine's gun changed (online: someone took the seat over): its model is built again with that turret.
    refit(c: Combatant) {
      const car = cars[c.id]
      scene.remove(car.model)
      disposeGeometries(car.model)
      Object.assign(car, build(c)) // the same CarView: the HUD keeps hold of it
      if (c === player) car.gun.add(muzzleLight)
    },
    restart() {
      effects.clear()
      Object.assign(feedback, { hit: 0, kill: 0, damage: 0, messageTime: 0, pickupTime: 0 })
    },
    dispose() {
      for (const voice of [...engines, gunSpin, tyres, wind, ...burning.values()]) voice.stop()
      effects.dispose()
      for (const { model } of cars) {
        scene.remove(model)
        disposeGeometries(model)
      }
    },
  }
}
