import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { wrap } from '../shared/math.ts'
import { settings } from './settings.ts'

// Third-person chase camera tuning. Metres, radians, rates per second.
const CHASE_CAMERA = {
  fov: 60,
  speedFov: 10, // extra degrees of FOV at top speed
  followDistance: 8.5, // behind the pivot, along the aim line
  followHeight: 1.7, // lens raised above the aim line, so the car sits low in frame, under the crosshair
  pivotHeight: 1.6, // orbit pivot above the car's ground contact
  pitch: -0.05, // resting aim pitch (negative looks down)
  minPitch: -0.35,
  maxPitch: 0.3,
  lookSensitivity: 0.0022, // radians per mouse pixel
  positionSmoothing: 9, // follow lag
  rotationSmoothing: 5, // how quickly it swings behind the car's heading
  recenterDelay: 1.2, // seconds of idle mouse before swinging back behind
  recenterRate: 2.5,
  collisionPadding: 0.35, // kept between the lens and walls
  shake: 0.3, // metres of jitter at full trauma
}

export type ChaseCamera = ReturnType<typeof createChaseCamera>

const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)

// Orbits a pivot above the car: follows its heading with lag, mouse look
// swings it around (and it drifts back behind the car once the mouse rests),
// and a ray-cast against the static yard pulls the lens in front of walls.
export function createChaseCamera(camera: THREE.PerspectiveCamera, world: RAPIER.World, maxSpeed: number) {
  const c = CHASE_CAMERA
  const forward = new THREE.Vector3(0, 0, 1) // view and aim direction
  const pivot = new THREE.Vector3()
  const follow = new THREE.Vector3() // smoothed, unobstructed lens position
  const desired = new THREE.Vector3()
  const toLens = new THREE.Vector3()
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  let heading = 0 // smoothed car heading
  let lookYaw = 0 // mouse offsets from the resting view
  let lookPitch = 0
  let idle = 0
  let reach = c.followDistance // current pivot-to-lens distance after collision
  let trauma = 0
  let fov = c.fov
  let snap = true

  return {
    forward,
    get yaw() {
      return heading + lookYaw // view heading as rotation.y: 0 = +Z (south)
    },
    shake(amount: number) {
      trauma = Math.min(1, trauma + amount)
    },
    // Jump straight to the resting view (spawns, respawns).
    snap() {
      snap = true
      lookYaw = lookPitch = 0
    },
    // `trackHeading` false holds the current heading (a tumbling wreck would spin the view).
    update(target: THREE.Object3D, speed: number, lookX: number, lookY: number, aiming: boolean, dt: number, trackHeading = true) {
      const q = target.quaternion
      const carHeading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
      if (lookX || lookY) {
        const sensitivity = c.lookSensitivity * settings.mouseSensitivity
        lookYaw = wrap(lookYaw - lookX * sensitivity)
        lookPitch = THREE.MathUtils.clamp(lookPitch - lookY * sensitivity, c.minPitch - c.pitch, c.maxPitch - c.pitch)
        idle = 0
      } else {
        idle += dt
        if (idle > c.recenterDelay && !aiming) {
          lookYaw -= lookYaw * ease(c.recenterRate, dt)
          lookPitch -= lookPitch * ease(c.recenterRate, dt)
        }
      }
      if (snap) heading = carHeading
      else if (trackHeading) heading = wrap(heading + wrap(carHeading - heading) * ease(c.rotationSmoothing, dt))

      const yaw = heading + lookYaw
      const pitch = c.pitch + lookPitch
      forward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      pivot.copy(target.position).y += c.pivotHeight
      desired.copy(pivot).addScaledVector(forward, -c.followDistance).y += c.followHeight
      if (snap) follow.copy(desired)
      else follow.lerp(desired, ease(c.positionSmoothing, dt))

      // Pull in sharply when something solid is between car and lens; ease back out.
      toLens.subVectors(follow, pivot)
      const distance = toLens.length()
      toLens.divideScalar(distance)
      ray.origin = pivot
      ray.dir = toLens
      const hit = world.castRay(ray, distance + c.collisionPadding, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
      const clear = hit ? Math.max(hit.timeOfImpact - c.collisionPadding, 0.4) : distance
      reach = clear < reach || snap ? clear : reach + (clear - reach) * ease(4, dt)
      camera.position.copy(pivot).addScaledVector(toLens, reach)
      camera.position.y = Math.max(camera.position.y, 0.5)

      trauma = Math.max(0, trauma - dt * 1.6)
      const jolt = trauma * trauma * c.shake * settings.cameraShake
      if (jolt) camera.position.add(desired.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(jolt * 2))
      camera.lookAt(desired.copy(camera.position).add(forward))

      const targetFov = c.fov + c.speedFov * Math.min(Math.abs(speed) / maxSpeed, 1)
      if (Math.abs(targetFov - fov) > 0.01) {
        fov += (targetFov - fov) * ease(3, dt)
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
      snap = false
    },
  }
}
