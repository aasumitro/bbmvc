import type * as THREE from 'three'
import type { Vec3 } from '../../render/geometry.ts'
import type { Livery } from '../../render/materials/library.ts'
import type { TurretKey } from '../weapons/weapons.ts'

// How a vehicle drives: sim/drive.ts drives every vehicle on Rapier's ray-cast
// vehicle with its own numbers (vehicles.ts). Forces in newtons; brakes are
// per-wheel impulses per step (Rapier's unit).
export interface Handling {
  mass: number
  centreOfMass: number // metres above the ground: low, so it corners flat instead of rolling
  linearDamping: number // stands in for air and rolling drag; it caps the real top speed below maxSpeed
  engineForce: number
  reverseForce: number
  maxSpeed: number // m/s: where the engine's pull reaches zero (see drivePerformance() for what the car actually does)
  maxReverseSpeed: number
  brake: number
  coastBrake: number // engine braking with no pedal held
  handbrake: number // locks the rears without killing momentum
  steerLock: number // radians at a standstill...
  steerLockAtSpeed: number // ...and at top speed
  steerRate: number // radians per second
  downforce: number // newtons per (m/s)²
  suspensionRest: number
  suspensionTravel: number
  suspensionStiffness: number // Rapier scales it by the chassis mass
  suspensionCompression: number
  suspensionRelaxation: number
  frictionSlip: number
  sideGrip: number
  driftGrip: number // rear side grip under the handbrake (applied per step, so small values still bite)
}

// The body the physics builds. Wheels in fl, fr, rl, rr order: the front
// pair steers, the rear pair takes the handbrake.
export interface Chassis {
  wheelRadius: number
  wheels: Array<[id: string, x: number, z: number]> // hub positions in the car's frame
  shells: Array<[hx: number, hy: number, hz: number, y: number, z: number]> // massless collision boxes: half extents, centre height and z
  box: [width: number, height: number, length: number] // the solid the inertia is worked out for
}

// How a model is drawn (models.ts).
export interface VehicleOptions {
  livery?: Livery
  seed?: number // jitter for the hand-welded armour
  turret?: TurretKey
}

// What a vehicle's own builder (models/<id>.ts) hands models.ts: its rigid
// body, unmerged, where its turret ring sits and how wide its tyres are.
export interface ModelParts {
  shell: THREE.Group
  turretAt: Vec3
  wheelWidth: number
}
