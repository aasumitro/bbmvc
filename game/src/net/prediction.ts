import type RAPIER from '@dimforge/rapier3d-compat'
import { PHYSICS_STEP } from '../sim/physics.ts'
import { driveCar, rightIfUpended, type Car, type DriveInput } from '../sim/drive.ts'
import type { CarState, MeState } from './protocol.ts'

// The player's own car, driven the moment the keys go down instead of a
// round trip later: each local step drives it through the same drive.ts on
// the same Rapier, from the same controls the server gets, and remembers
// where that left it. When the server's word arrives — where the car was
// after a given input — the two are compared; within tolerance the
// prediction stands, beyond it the server's state is taken and the inputs
// since are driven again on top of it. The server decides; this only
// guesses ahead of it. It needs no DOM.

const TOLERANCE = { position: 0.25, angle: (3 * Math.PI) / 180, speed: 1 } // metres, radians, m/s
const WRECKED: DriveInput = { throttle: 0, steer: 0, handbrake: true } // held on the grid, or the match over: as the server holds it
const HISTORY = 256 // local steps kept (over 4 s)

interface Pose {
  p: { x: number; y: number; z: number }
  q: { x: number; y: number; z: number; w: number }
  v: { x: number; y: number; z: number }
  w: { x: number; y: number; z: number }
  steer: number
  upended: number
}

interface Step {
  seq: number
  input: DriveInput
  boost: number
  pose: Pose
}

const blankPose = (): Pose => ({
  p: { x: 0, y: 0, z: 0 },
  q: { x: 0, y: 0, z: 0, w: 1 },
  v: { x: 0, y: 0, z: 0 },
  w: { x: 0, y: 0, z: 0 },
  steer: 0,
  upended: 0,
})

export function createPrediction(world: RAPIER.World, car: Car) {
  const ring: Step[] = Array.from({ length: HISTORY }, () => ({ seq: -1, input: { ...WRECKED }, boost: 1, pose: blankPose() }))
  let newest = -1 // the newest seq driven
  const slot = (seq: number) => ring[((seq % HISTORY) + HISTORY) % HISTORY]
  const stats = { corrections: 0, replayed: 0, compared: 0, maxError: 0, lastError: 0, lastAngle: 0, lastSpeed: 0 }

  function record(pose: Pose) {
    const { body } = car
    Object.assign(pose.p, body.translation())
    Object.assign(pose.q, body.rotation())
    Object.assign(pose.v, body.linvel())
    Object.assign(pose.w, body.angvel())
    pose.steer = car.steer
    pose.upended = car.upended
  }

  // The controls for local step `seq` into the car, before the world steps
  // (`held`: the server holds it this step).
  function drive(seq: number, input: DriveInput, held: boolean, boost: number, dt = PHYSICS_STEP) {
    const step = slot(seq)
    step.seq = seq
    Object.assign(step.input, held ? WRECKED : { throttle: input.throttle, steer: input.steer, handbrake: input.handbrake })
    step.boost = boost
    newest = seq
    driveCar(car, step.input, dt, boost)
    rightIfUpended(car, dt)
  }

  // After the world has stepped: where step `seq` left the car.
  function settled(seq: number) {
    const step = slot(seq)
    if (step.seq === seq) record(step.pose)
  }

  // Puts the car in the server's state.
  function take(server: CarState, me: MeState) {
    const { body } = car
    body.setTranslation(server.position, true)
    body.setRotation(server.rotation, true)
    body.setLinvel(server.velocity, true)
    body.setAngvel(me.spin, true)
    car.steer = me.steer
    car.upended = me.upended
  }

  // The server had the car at `server` after input `ack`. Returns whether
  // the car was put right (the server's state, the later inputs driven again).
  // `hard`: take the server's word whatever the prediction says (a respawn,
  // a recovery, a new match, the first word).
  function reconcile(ack: number, server: CarState, me: MeState, hard: boolean) {
    if (!hard && ack < 0) return false // the server hasn't used an input yet: nothing to compare
    const known = ack >= 0 && slot(ack).seq === ack // the server has used an input the page still remembers
    const step = slot(ack)
    if (!hard && known) {
      const { p, q, v } = step.pose
      const error = Math.hypot(p.x - server.position.x, p.y - server.position.y, p.z - server.position.z)
      const dot = Math.min(1, Math.abs(q.x * server.rotation.x + q.y * server.rotation.y + q.z * server.rotation.z + q.w * server.rotation.w))
      const angle = 2 * Math.acos(dot)
      const speed = Math.hypot(v.x - server.velocity.x, v.y - server.velocity.y, v.z - server.velocity.z)
      stats.compared++
      stats.lastError = error
      stats.lastAngle = angle
      stats.lastSpeed = speed
      stats.maxError = Math.max(stats.maxError, error)
      if (error <= TOLERANCE.position && angle <= TOLERANCE.angle && speed <= TOLERANCE.speed) return false
    }
    take(server, me)
    if (!hard) stats.corrections++
    if (!known || hard) newest = Math.max(newest, ack)
    for (let seq = Math.max(ack + 1, 1); seq <= newest; seq++) {
      const later = slot(seq)
      if (later.seq !== seq) break
      driveCar(car, later.input, PHYSICS_STEP, later.boost)
      rightIfUpended(car, PHYSICS_STEP)
      world.step()
      record(later.pose)
      stats.replayed++
    }
    return true
  }

  // Nothing to compare with any more (the car was wrecked: it's shown as the server has it).
  function forget() {
    for (const step of ring) step.seq = -1
  }

  return { drive, settled, reconcile, forget, take, stats }
}
