import type { Vec3 } from '../../render/geometry.ts'
import type { Chassis, Handling } from './types.ts'

// Every vehicle the garage offers, by id: what it is, how it drives, the body
// the physics builds for it and where its turret sits. Plain data — the ray-
// cast car in drive.ts drives any of them, models.ts draws them (MODELS),
// the garage quotes them. Metres, kilograms, newtons; +Z forward, the
// driver's left +X.

export interface VehicleSpec {
  name: string
  kind: string // the garage's line under the name
  blurb: string
  armour: number // hull points
  handling: Handling
  chassis: Chassis
  turret: { mount: Vec3; barrel: number } // the gun's trunnion in the car's frame (turret ring + trunnion); rounds leave `barrel` metres ahead of it
}

const ROSTER = {
  razor: {
    name: 'Razor',
    kind: '4×4 war rig / Balanced',
    blurb: 'A well-rounded war machine built for the scrapyard. High durability and serious firepower.',
    armour: 100,
    handling: {
      mass: 1400,
      centreOfMass: 0.35,
      linearDamping: 0.05,
      engineForce: 11000,
      reverseForce: 6500,
      maxSpeed: 30,
      maxReverseSpeed: 11,
      brake: 55,
      coastBrake: 3,
      handbrake: 35,
      steerLock: 0.58,
      steerLockAtSpeed: 0.14,
      steerRate: 3.2,
      downforce: 2.5,
      suspensionRest: 0.3,
      suspensionTravel: 0.25,
      suspensionStiffness: 30,
      suspensionCompression: 2.3,
      suspensionRelaxation: 2.8,
      frictionSlip: 1.6,
      sideGrip: 1,
      driftGrip: 0.05,
    },
    chassis: {
      wheelRadius: 0.5,
      wheels: [
        ['fl', 0.94, 1.4],
        ['fr', -0.94, 1.4],
        ['rl', 0.94, -1.4],
        ['rr', -0.94, -1.4],
      ],
      shells: [
        [0.95, 0.4, 2.2, 0.95, 0.02], // hull: sills to bonnet, bumper to bumper
        [0.72, 0.32, 0.9, 1.62, -0.52], // cabin under the roll cage
      ],
      box: [1.9, 1.2, 4.4],
    },
    turret: { mount: [0, 2.41, -0.62], barrel: 1.15 },
  },
} satisfies Record<string, VehicleSpec>

export type VehicleId = keyof typeof ROSTER
export const VEHICLES: Record<VehicleId, VehicleSpec> = ROSTER
