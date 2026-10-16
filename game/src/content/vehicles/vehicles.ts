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
  // A ram on the nose: hull points it takes off a machine it strikes, per
  // m/s it was closing on it, if that machine is within `arc` radians of
  // dead ahead (sim/simulation.ts). Only a vehicle with one deals this.
  ram?: { damage: number; arc: number }
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
  brute: {
    name: 'Brute',
    kind: 'Armoured hauler / Heavy',
    blurb: 'Slab armour, a dozer blade on the nose and a turret on its back. Slow off the line and wide in the turns, but it takes a beating the others can’t.',
    armour: 135,
    handling: {
      mass: 2200,
      centreOfMass: 0.4,
      linearDamping: 0.05,
      engineForce: 17500,
      reverseForce: 9500,
      maxSpeed: 25.5,
      maxReverseSpeed: 10,
      brake: 86,
      coastBrake: 4.5,
      handbrake: 55,
      steerLock: 0.55,
      steerLockAtSpeed: 0.13,
      steerRate: 2.8,
      downforce: 4,
      suspensionRest: 0.34,
      suspensionTravel: 0.3,
      suspensionStiffness: 30,
      suspensionCompression: 2.3,
      suspensionRelaxation: 2.8,
      frictionSlip: 1.6,
      sideGrip: 1,
      driftGrip: 0.06,
    },
    chassis: {
      wheelRadius: 0.58,
      wheels: [
        ['fl', 1.06, 1.62],
        ['fr', -1.06, 1.62],
        ['rl', 1.06, -1.62],
        ['rr', -1.06, -1.62],
      ],
      shells: [
        [1.0, 0.43, 2.62, 1.07, 0.14], // hull: sills to deck, tail to ram
        [0.93, 0.26, 0.7, 1.74, 1.31], // cab over the front axle
        [0.92, 0.31, 1.5, 1.81, -0.98], // fighting compartment under the turret
      ],
      box: [2.0, 1.5, 5.1],
    },
    turret: { mount: [0, 2.6, -0.7], barrel: 1.15 },
  },
  scout: {
    name: 'Scout',
    kind: 'Light raider / Fast',
    blurb:
      'A stripped coupe on a cage and not much else. The quickest thing in the yard and the tightest in the turns, but it can’t take the hits the others shrug off.',
    armour: 70,
    handling: {
      mass: 1000,
      centreOfMass: 0.32,
      linearDamping: 0.05,
      engineForce: 9300,
      reverseForce: 4600,
      maxSpeed: 36.8,
      maxReverseSpeed: 12,
      brake: 39,
      coastBrake: 2.1,
      handbrake: 25,
      steerLock: 0.62,
      steerLockAtSpeed: 0.12,
      steerRate: 3.6,
      downforce: 2.2,
      suspensionRest: 0.28,
      suspensionTravel: 0.22,
      suspensionStiffness: 30,
      suspensionCompression: 2.3,
      suspensionRelaxation: 2.8,
      frictionSlip: 1.6,
      sideGrip: 1,
      driftGrip: 0.05,
    },
    chassis: {
      wheelRadius: 0.44,
      wheels: [
        ['fl', 0.86, 1.25],
        ['fr', -0.86, 1.25],
        ['rl', 0.86, -1.25],
        ['rr', -0.86, -1.25],
      ],
      shells: [
        [0.88, 0.29, 2.03, 0.71, 0.02], // hull: sills to bonnet, tail to nose
        [0.68, 0.23, 0.76, 1.2, -0.5], // cabin under the cage
      ],
      box: [1.76, 1.02, 4.06],
    },
    turret: { mount: [0, 1.9, -0.55], barrel: 1.15 },
  },
  buggy: {
    name: 'Buggy',
    kind: 'Dune buggy / Agile',
    blurb:
      'A tube cage on long-travel arms and four big tyres. It soaks up the rough ground and lands on its wheels; light enough to be quick, open enough to feel every hit.',
    armour: 85,
    handling: {
      mass: 1100,
      centreOfMass: 0.42,
      linearDamping: 0.05,
      engineForce: 9500,
      reverseForce: 5100,
      maxSpeed: 33.6,
      maxReverseSpeed: 11,
      brake: 43,
      coastBrake: 2.4,
      handbrake: 28,
      steerLock: 0.6,
      steerLockAtSpeed: 0.13,
      steerRate: 3.3,
      downforce: 2.2,
      suspensionRest: 0.42,
      suspensionTravel: 0.45,
      suspensionStiffness: 22,
      suspensionCompression: 2.0,
      suspensionRelaxation: 2.4,
      frictionSlip: 1.7,
      sideGrip: 1,
      driftGrip: 0.07,
    },
    chassis: {
      wheelRadius: 0.56,
      wheels: [
        ['fl', 1.02, 1.35],
        ['fr', -1.02, 1.35],
        ['rl', 1.02, -1.35],
        ['rr', -1.02, -1.35],
      ],
      shells: [
        [0.72, 0.22, 1.8, 0.82, 0.18], // tub and arms: the belly to the rail, tail to nose
        [0.52, 0.42, 0.72, 1.46, -0.08], // the cage over the seats
      ],
      box: [1.4, 1.3, 3.6],
    },
    turret: { mount: [0, 2.36, -0.2], barrel: 1.15 },
  },
  rammer: {
    name: 'Rammer',
    kind: 'Battering ram / Heavy',
    blurb: 'A wedge of plate steel behind a plough. It hits harder the faster it’s going: a car on its nose takes the blow, and it takes the knocks besides.',
    armour: 120,
    handling: {
      mass: 1800,
      centreOfMass: 0.38,
      linearDamping: 0.05,
      engineForce: 14200,
      reverseForce: 8000,
      maxSpeed: 29,
      maxReverseSpeed: 10.5,
      brake: 70,
      coastBrake: 3.8,
      handbrake: 45,
      steerLock: 0.56,
      steerLockAtSpeed: 0.13,
      steerRate: 3,
      downforce: 3.2,
      suspensionRest: 0.32,
      suspensionTravel: 0.26,
      suspensionStiffness: 30,
      suspensionCompression: 2.3,
      suspensionRelaxation: 2.8,
      frictionSlip: 1.6,
      sideGrip: 1,
      driftGrip: 0.05,
    },
    chassis: {
      wheelRadius: 0.54,
      wheels: [
        ['fl', 1.0, 1.5],
        ['fr', -1.0, 1.5],
        ['rl', 1.0, -1.5],
        ['rr', -1.0, -1.5],
      ],
      shells: [
        [0.98, 0.38, 2.4, 0.95, 0.0], // hull: sills to deck, tail to the wedge's nose
        [0.78, 0.28, 0.95, 1.6, -0.45], // cabin under the turret
        [1.12, 0.3, 0.32, 0.78, 2.62], // the plough across the nose
      ],
      box: [2.0, 1.3, 5.6],
    },
    turret: { mount: [0, 2.33, -0.5], barrel: 1.15 },
    ram: { damage: 2.5, arc: 0.6 },
  },
} satisfies Record<string, VehicleSpec>

export type VehicleId = keyof typeof ROSTER
export const VEHICLES: Record<VehicleId, VehicleSpec> = ROSTER
