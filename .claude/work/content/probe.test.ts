// A balance probe (.claude/work/{ffa,tdm}/*-metrics.js) on a headless
// practice match, in Node: no page and no dev server, so it runs on any tree,
// a scratch worktree's too. probe.mjs copies this file and the probe into that
// tree's game/, runs them with Vitest (the arena builders need Vite) and
// deletes both. The match is practice's (runtime/practice.ts, runtime/match.ts)
// without what only draws, sounds or reads the keys: the same line-up, mode,
// simulation and fixed steps, the bots at Normal. Its seeds count up from
// PROBE_SEED, so a run comes out the same every time.
import { writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as THREE from 'three'
import { arenaData } from './server/arenas.ts'
import type { MapId } from './src/content/arenas/maps.ts'
import { WEAPONS } from './src/content/weapons/weapons.ts'
import type { Mode } from './src/modes/ids.ts'
import { classic } from './src/modes/matchSettings.ts'
import { MODES } from './src/modes/modes.ts'
import { recruits } from './src/modes/roster.ts'
import { DIFFICULTIES } from './src/sim/difficulty.ts'
import { createWorld, initPhysics, PHYSICS_STEP } from './src/sim/physics.ts'
import { createSimulation, enlist, type SimEvents } from './src/sim/simulation.ts'

await initPhysics()

const { PROBE_KIND, PROBE_MAP, PROBE_MATCHES, PROBE_SEED, PROBE_VEHICLE, PROBE_GUN, PROBE_SCRIPT, PROBE_OUT } = process.env
const kind = PROBE_KIND as Mode
const quiet: SimEvents = { fired() {}, shot() {}, rocket() {}, burst() {}, hurt() {}, wrecked() {}, crashed() {}, reloading() {}, respawned() {}, recovered() {}, laid() {}, gone() {} }

// window.match as the probes read it.
function practice(map: MapId, seed: number) {
  const arena = arenaData(map)
  const world = createWorld(arena.colliders)
  const settings = classic(kind)
  const driver = { name: 'You', vehicle: 'razor' as const, weapon: WEAPONS.minigun } // the probe fits the player out
  const combatants = recruits(kind, arena, settings, seed, DIFFICULTIES.normal, driver).map((recruit, id) => enlist(world, id, recruit))
  const player = combatants[0]
  const mode = MODES[kind].create({ combatants, arena, world, seed, settings })
  const sim = createSimulation({ world, arena, combatants, mode, events: quiet, seed })
  let last = -1
  let accumulator = 0
  const match = {
    arena,
    world,
    combatants,
    player,
    others: combatants.filter((c) => c !== player),
    mode,
    chase: { forward: new THREE.Vector3(), update() {} }, // the view's chase camera: the probes hook its update
    phase: 'playing',
    seed,
    restart() {
      match.seed++
      sim.restart(match.seed)
      mode.restart(match.seed)
      match.phase = 'playing'
    },
    frame(time: number) {
      const dt = last < 0 ? 0 : Math.min(Math.max(time - last, 0) / 1000, 0.1)
      last = time
      for (accumulator += dt; accumulator >= PHYSICS_STEP; accumulator -= PHYSICS_STEP) step(PHYSICS_STEP)
      match.chase.update()
    },
  }
  // One fixed step, then the player's phase, as runtime/match.ts has them.
  function step(dt: number) {
    const live = match.phase === 'playing' || match.phase === 'destroyed'
    sim.step(dt, live)
    if (live) mode.report()
    if (match.phase === 'destroyed' && player.alive) match.phase = 'playing'
    if (match.phase === 'playing' && !player.alive && player.deadFor > 1.4) match.phase = 'destroyed'
    const winner = live ? mode.outcome() : undefined
    if (winner === undefined) return
    match.phase = winner === player.team ? 'victory' : 'defeat'
    sim.standDown()
  }
  return match
}

it(`the ${kind} probe on ${PROBE_MAP}`, async () => {
  // Set once the arena is built: render/materials reads `window` as it loads, to know it runs headless.
  Object.assign(globalThis, { window: globalThis, match: practice(PROBE_MAP as MapId, Number(PROBE_SEED)) })
  await import(PROBE_SCRIPT!)
  const probe = Reflect.get(globalThis, `${kind}Metrics`)
  expect(await probe.setup()).toBe('ready')
  const fit = { vehicle: PROBE_VEHICLE || undefined, gun: PROBE_GUN || undefined }
  if (kind === 'ffa') probe.autopilot('even', 'normal', fit)
  else probe.autopilot('even', fit)
  probe.play({ matches: Number(PROBE_MATCHES), label: 'even' })
  while (probe.status.running) await new Promise((resolve) => setTimeout(resolve, 250))
  writeFileSync(PROBE_OUT!, JSON.stringify(probe.analyze('even')))
}, 3_600_000)
