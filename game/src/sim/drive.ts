import RAPIER from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import type { Chassis, Handling } from '../content/vehicles/types.ts'
import { GRAVITY, PHYSICS_STEP } from './physics.ts'

export interface DriveInput {
  throttle: number // 1 accelerate, -1 brake then reverse
  steer: number // 1 full left, -1 full right (the driver's left is +X)
  handbrake: boolean
}

// Arcade handling on Rapier's ray-cast vehicle: responsive, but with weight.
// One driving model for every vehicle; each brings its own numbers
// (content/vehicles/vehicles.ts, of the types in content/vehicles/types.ts).
export interface Car {
  body: RAPIER.RigidBody
  controller: RAPIER.DynamicRayCastVehicleController
  handling: Handling
  chassis: Chassis
  hardpoint: number // wheel hard points' height: the settled suspension holds each wheel where the model draws it, centre wheelRadius above the ground
  steer: number // current front wheel angle
  upended: number // seconds spent on its side or roof
}

export function createCar(world: RAPIER.World, handling: Handling, chassis: Chassis): Car {
  const { mass } = handling
  const [width, height, length] = chassis.box
  const inertia = { x: (mass / 12) * (height ** 2 + length ** 2), y: (mass / 12) * (width ** 2 + length ** 2), z: (mass / 12) * (width ** 2 + height ** 2) }
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setAdditionalMassProperties(mass, { x: 0, y: handling.centreOfMass, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(handling.linearDamping)
      .setAngularDamping(0.6)
      .setCanSleep(false) // Rapier only wakes a chassis for positive engine force
      .setCcdEnabled(true),
  )
  // Massless shells: the body's mass properties are set explicitly above.
  for (const [hx, hy, hz, y, z] of chassis.shells) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, y, z).setDensity(0).setFriction(0.3).setRestitution(0.15), body)
  }

  const hardpoint = chassis.wheelRadius + handling.suspensionRest - GRAVITY / (4 * handling.suspensionStiffness)
  const controller = world.createVehicleController(body)
  controller.setIndexForwardAxis = 2 // +Z forward; Rapier defaults to +X
  for (const [, x, z] of chassis.wheels) {
    const i = controller.numWheels()
    controller.addWheel({ x, y: hardpoint, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, handling.suspensionRest, chassis.wheelRadius)
    controller.setWheelSuspensionStiffness(i, handling.suspensionStiffness)
    controller.setWheelSuspensionCompression(i, handling.suspensionCompression)
    controller.setWheelSuspensionRelaxation(i, handling.suspensionRelaxation)
    controller.setWheelMaxSuspensionTravel(i, handling.suspensionTravel)
    controller.setWheelMaxSuspensionForce(i, 1e6) // the default caps a heavy car into the ground
    controller.setWheelFrictionSlip(i, handling.frictionSlip)
  }
  return { body, controller, handling, chassis, hardpoint, steer: 0, upended: 0 }
}

// Teleports the car, at rest, onto its wheels facing `heading` (rotation.y).
export function placeCar(car: Car, position: RAPIER.Vector, heading: number) {
  car.body.setTranslation({ x: position.x, y: position.y + 0.2, z: position.z }, true)
  car.body.setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true)
  car.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  car.steer = 0
  car.upended = 0
}

// Engine pull at full throttle (newtons, all four wheels), fading to nothing
// at maxSpeed. `boost` scales pull and top speed together (a speed pickup).
const pull = (h: Handling, speed: number, boost = 1) => h.engineForce * boost * Math.max(0, 1 - (speed / (h.maxSpeed * boost)) ** 2)

// Flat out from a standstill on level ground, stepped the way the simulation
// steps it: the engine's pull against the body's damping (Rapier scales the
// velocity by 1 / (1 + dt * damping) every step). The garage quotes these.
export function drivePerformance(h: Handling) {
  let speed = 0
  let power = 0 // watts at the wheels, peak
  let zeroTo80 = 0 // seconds to 80 km/h
  for (let time = 0; time < 120; time += PHYSICS_STEP) {
    const force = pull(h, speed)
    power = Math.max(power, force * speed)
    speed = (speed + (force / h.mass) * PHYSICS_STEP) / (1 + PHYSICS_STEP * h.linearDamping)
    if (!zeroTo80 && speed >= 80 / 3.6) zeroTo80 = time + PHYSICS_STEP
  }
  return { topSpeed: speed, zeroTo80, power }
}

const impulse = { x: 0, y: 0, z: 0 }
const rotation = { x: 0, y: 0, z: 0, w: 1 }
const velocity = { x: 0, y: 0, z: 0 }

// Ground speed along the car's nose (m/s, negative reversing). Unlike
// Rapier's currentVehicleSpeed it ignores bouncing and sliding sideways.
export function forwardSpeed(car: Car) {
  const q = car.body.rotation(rotation)
  const v = car.body.linvel(velocity)
  return v.x * 2 * (q.x * q.z + q.w * q.y) + v.z * (1 - 2 * (q.x * q.x + q.y * q.y))
}

// One physics step of engine, brakes and steering. Call before world.step().
// `boost` multiplies the engine for this step only; the handling never changes.
export function driveCar(car: Car, input: DriveInput, dt: number, boost = 1) {
  const { body, controller, handling: h } = car
  const speed = forwardSpeed(car)
  let engine = 0
  let brake = input.throttle ? 0 : h.coastBrake
  if (input.throttle > 0) {
    if (speed < -1) brake = h.brake
    else engine = pull(h, speed, boost) * input.throttle
  } else if (input.throttle < 0) {
    if (speed > 1) brake = h.brake * -input.throttle
    else engine = h.reverseForce * input.throttle * Math.max(0, 1 - (speed / h.maxReverseSpeed) ** 2)
  }

  // Less lock at speed, and the wheels turn at a finite rate.
  const lock = h.steerLock + (h.steerLockAtSpeed - h.steerLock) * Math.min(Math.abs(speed) / h.maxSpeed, 1)
  const turn = h.steerRate * dt
  car.steer += Math.max(-turn, Math.min(turn, input.steer * lock - car.steer))

  for (let i = 0; i < 4; i++) {
    const locked = input.handbrake && i >= 2 // rear wheels slide out
    controller.setWheelSteering(i, i < 2 ? car.steer : 0)
    controller.setWheelEngineForce(i, locked ? 0 : engine / 4)
    controller.setWheelBrake(i, locked ? h.handbrake : brake)
    controller.setWheelSideFrictionStiffness(i, locked ? h.driftGrip : h.sideGrip)
  }
  controller.updateVehicle(dt)

  impulse.y = -h.downforce * speed * speed * dt // keeps it planted over bumps
  body.applyImpulse(impulse, true)
}

// A car left on its side or roof is set back on its wheels after a moment.
export function rightIfUpended(car: Car, dt: number) {
  const q = car.body.rotation(rotation)
  const v = car.body.linvel(velocity)
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z)
  car.upended = upY < 0.35 && v.x * v.x + v.y * v.y + v.z * v.z < 9 ? car.upended + dt : 0
  if (car.upended > 2) {
    const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
    const p = car.body.translation()
    placeCar(car, { x: p.x, y: p.y + 1, z: p.z }, heading)
  }
}

export function wheelsOnGround(car: Car) {
  let count = 0
  for (let i = 0; i < 4; i++) if (car.controller.wheelIsInContact(i)) count++
  return count
}

// Wheel meshes (in the chassis' wheel order) follow suspension travel, steering and spin.
export function poseWheels(car: Car, wheels: THREE.Object3D[]) {
  const { controller } = car
  for (let i = 0; i < wheels.length; i++) {
    const side = i % 2 ? -1 : 1 // right-hand wheels are turned around to show their face
    wheels[i].position.y = car.hardpoint - (controller.wheelSuspensionLength(i) ?? car.handling.suspensionRest)
    wheels[i].rotation.set(side * (controller.wheelRotation(i) ?? 0), (side > 0 ? 0 : Math.PI) + (controller.wheelSteering(i) ?? 0), 0, 'YXZ')
  }
}
