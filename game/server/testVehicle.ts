import { VEHICLES, type VehicleId, type VehicleSpec } from '../src/content/vehicles/vehicles.ts'

// A second vehicle for the tests alone, until the real ones come with the
// content (the refactor's stage 10): heavier, wider and longer than the
// Razor, on bigger wheels, its turret higher. Put into VEHICLES while a test
// needs it and taken out after, so nothing else sees it (bots draw from the
// registry as it stands: Classic's pins are played without it).
export const HAULER = 'hauler' as VehicleId

const razor = VEHICLES.razor
const spec: VehicleSpec = {
  name: 'Hauler',
  kind: 'test',
  blurb: 'A test vehicle.',
  armour: 140,
  handling: { ...razor.handling, mass: 2000, engineForce: 14000, maxSpeed: 26 },
  chassis: {
    wheelRadius: 0.55,
    wheels: [
      ['fl', 1.05, 1.6],
      ['fr', -1.05, 1.6],
      ['rl', 1.05, -1.6],
      ['rr', -1.05, -1.6],
    ],
    shells: [
      [1.05, 0.45, 2.5, 1.0, 0.0],
      [0.8, 0.35, 1.0, 1.75, -0.6],
    ],
    box: [2.1, 1.3, 5.0],
  },
  turret: { mount: [0, 2.6, -0.6], barrel: 1.2 },
}

// The hauler in VEHICLES; the returned function takes it out again.
export function addHauler() {
  const registry = VEHICLES as Record<string, VehicleSpec>
  registry[HAULER] = spec
  return () => void delete registry[HAULER]
}
