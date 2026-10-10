import type RAPIER from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import type { Arena } from '../content/arenas/arena.ts'
import { arenaDigest } from '../content/arenas/digest.ts'
import { playSound, setGameAudio } from '../view/audio.ts'
import { createFeed } from '../view/feed.ts'
import type { MapId } from '../content/arenas/maps.ts'
import type { RunningMode, Scenery } from '../modes/scenery.ts'
import { PHYSICS_STEP } from '../sim/physics.ts'
import { createPilot } from '../view/pilot.ts'
import type { Combatant } from '../sim/simulation.ts'
import { wheelsOnGround } from '../sim/drive.ts'
import { createMatchView } from '../view/view.ts'

// A match as the local player plays it. The player's side of it is the same
// wherever the match is run: the view (view.ts), the pilot (pilot.ts), the
// feed (feed.ts), fixed steps with the view interpolated in between, and the
// player's view of the match (playing, down, paused, over) — playMatch()
// below. Where the steps come from is a MatchSource: a practice match
// (practice.ts: the player and bots, the simulation run locally), or an
// online one (online.ts: the server's match mirrored). The HUD reads the
// object playMatch returns every frame; nothing here knows which mode is
// running, and nothing but the source knows where the match is decided.

export type MatchPhase = 'playing' | 'paused' | 'destroyed' | 'victory' | 'defeat' | 'lost' // the player's view of the match; lost: the connection to an online match

// What a match is played with, however it is run.
export interface MatchParts {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  surface: HTMLCanvasElement
  onPhase: (phase: MatchPhase) => void
  arena: Arena
  map: MapId
  world: RAPIER.World
  combatants: readonly Combatant[]
  player: Combatant
  mode: RunningMode
  scenery: Scenery // what's drawn of the mode besides the machines
  view: ReturnType<typeof createMatchView>
  feed: ReturnType<typeof createFeed>
  combatantOf: (collider: RAPIER.Collider) => Combatant | undefined
}

// Where a match's steps come from, and what differs with it.
export interface MatchSource {
  online: boolean // no pause: the menu opens over a match that runs on
  people: readonly boolean[] // by seat: a person drives it (practice: the player alone)
  uids: readonly string[] // by seat: that person's user id, '' for a bot (online: chat's whispers; practice: none)
  seed(): number
  drives(looking: boolean): boolean // the player's controls may drive this frame
  receive(now: number): void // before the frame's steps (online: what the server said)
  step(dt: number, live: boolean): void // one fixed step; `live`: the match is on for the player
  place(now: number): void // before the view is placed (online: where the machines are shown)
  finish(): void // the match has a result
  restart(): void // a new match on the same machines (practice's Play again)
  nextIn(now: number): number // seconds until the next match starts by itself; Infinity: it won't
  holdIn(now: number): number // seconds the match waits at most for its people's pages to load (online, a new room); Infinity: it isn't waiting
  debug(): string[] // the F3 overlay's lines about the source
  dispose(): void
  attach?(hooks: { restarted(): void; lose(reason: string): void }): void // online: the server restarted the match, or the connection went
}

export type Match = ReturnType<typeof playMatch>

// The player's side of a match, around its source: the pilot, the fixed
// steps, where the player stands in the match, what the HUD reads.
export function playMatch(parts: MatchParts, source: MatchSource) {
  const { camera, surface, onPhase, arena, map, world, combatants, player, mode, scenery, view, feed, combatantOf } = parts
  const { rules } = mode
  const pilot = createPilot({ surface, camera, world, chase: view.chase, player, combatants, combatantOf })
  const digest = arenaDigest(arena) // the F3 overlay's: the game server's for the same map must match
  setGameAudio(true)

  const state = {
    arena,
    mode, // the running mode: its rules, timing and hooks (sim/matchMode.ts); `kind` for mode-specific screens
    combatants,
    player,
    others: pilot.others, // everyone but the player
    cars: view.cars, // models by combatant id, interpolated: where the HUD draws markers and the map
    chase: view.chase, // .yaw is the heading the HUD compass and minimap follow
    aim: pilot.aim, // the hostile under the crosshair
    seen: pilot.seen, // by id: rivals in plain view
    feedback: view.feedback, // decaying 0..1 pulses for the HUD
    feed: feed.lines, // newest last
    phase: 'playing' as MatchPhase,
    elapsed: 0, // seconds of match time
    winner: null as number | null, // team that took the match; null on a draw
    get seed() {
      return source.seed() // this match's: all its randomness comes from it
    },
    online: source.online,
    people: source.people,
    uids: source.uids,
    map, // the arena's id
    lost: '', // why an online match's connection went
    nextIn: () => source.nextIn(performance.now()),
    holdIn: () => source.holdIn(performance.now()),
    locked: pilot.locked,
    lock: pilot.lock,
    unlock: pilot.unlock, // the mouse back and every held key let go (the chat line: typing never drives)
    frame,
    respawnIn,
    debug,
    restart,
    pause,
    dispose,
  }

  // The mouse stays captured while the player is down: they're back in on
  // their own, so there's no menu to click. Online, the match plays on
  // behind the menu, sound and all.
  function setPhase(phase: MatchPhase) {
    if (state.phase === phase) return
    const from = state.phase
    state.phase = phase
    if (phase !== 'playing' && phase !== 'destroyed') pilot.unlock()
    setGameAudio(phase !== 'lost' && (source.online || phase !== 'paused'))
    if (from === 'paused') return onPhase(phase) // resuming: no stinger again
    if (phase === 'destroyed' || phase === 'victory') playSound(phase)
    if (phase === 'defeat') playSound('destroyed')
    onPhase(phase)
  }

  // Ends the match in `winner`'s favour (null: a draw).
  function finish(winner: number | null) {
    state.winner = winner
    source.finish()
    setPhase(winner === player.team ? 'victory' : 'defeat')
  }

  // One fixed step, then what the player is told of it: the countdown,
  // being down or back in, the result.
  function step(dt: number) {
    const live = state.phase === 'playing' || state.phase === 'destroyed' || (source.online && state.phase === 'paused')
    source.step(dt, live)
    if (live) {
      state.elapsed += dt
      if (source.holdIn(performance.now()) === Infinity) feed.beep(rules, mode.timing) // no countdown while the room waits for its people
    }
    if (state.phase === 'destroyed' && player.alive) setPhase('playing') // back in
    if (state.phase === 'playing' && !player.alive && player.deadFor > 1.4) setPhase('destroyed')
    if (live) {
      const winner = mode.outcome()
      if (winner !== undefined) finish(winner)
    }
  }

  // --- per frame -----------------------------------------------------------

  let lastTime = -1
  let accumulator = 0

  function frame(time: number) {
    const dt = lastTime < 0 ? 0 : Math.min(Math.max(time - lastTime, 0) / 1000, 0.1) // clamped: tab switches, clock hiccups
    lastTime = time
    const running = state.phase !== 'lost' && (source.online || state.phase !== 'paused')
    const looking = state.phase === 'playing' && player.alive
    pilot.read(looking, source.drives(looking))

    const frameDt = running ? dt : 0
    if (running) {
      source.receive(time)
      accumulator += dt
      while (accumulator >= PHYSICS_STEP) {
        step(PHYSICS_STEP)
        accumulator -= PHYSICS_STEP
      }
    }

    // Render between the last two physics poses, so motion stays smooth at any frame rate.
    source.place(time)
    view.place(accumulator / PHYSICS_STEP)
    view.chase.update(view.cars[player.id].model, player.speed, pilot.controls.lookX, pilot.controls.lookY, player.control.fire, frameDt, player.alive)
    pilot.layAim()
    pilot.look(frameDt)
    view.animate(frameDt)
    scenery.update(camera)
  }

  // Seconds until the player is back in; Infinity when not waiting.
  function respawnIn() {
    const c = rules.contenders[player.id]
    return c.life === 'pending' ? Math.max(0, c.respawnAt - rules.now) : Infinity
  }

  // The F3 overlay's lines about the match (the HUD adds the frame rate).
  function debug() {
    const p = player.position
    const v = player.velocity
    const f = (n: number) => n.toFixed(1).padStart(6)
    return [
      `POS   ${f(p.x)}${f(p.y)}${f(p.z)}`,
      `VEL   ${f(v.x)}${f(v.y)}${f(v.z)}`,
      `SPEED  ${Math.round(Math.abs(player.speed) * 3.6)} km/h  wheels ${wheelsOnGround(player.car)}/4`,
      `HP     ${Math.ceil(player.health)}/${player.maxHealth}  ammo ${player.weapon.ammo}`,
      `WORLD  ${world.bodies.len()} bodies  ${world.colliders.len()} colliders`,
      ...source.debug().map((line, i) => (i ? line : `${line}  ${state.phase}`)),
      ...mode.debug(),
      `SEED   ${state.seed}`,
      `ARENA  ${digest}`,
    ]
  }

  // --- lifecycle -------------------------------------------------------------

  // A fresh match on the same arena and machines (practice's Play again).
  function restart() {
    source.restart()
    restarted()
  }

  // The match has started over (here, or on the server): the player's side of it too.
  function restarted() {
    scenery.clear()
    view.restart()
    feed.clear()
    state.elapsed = 0
    state.winner = null
    if (state.phase === 'paused') resumeTo = 'playing'
    else setPhase('playing')
  }

  // Pauses in play or while the player is down, and resumes there. Online
  // this only opens and closes the menu: the match runs on.
  let resumeTo: MatchPhase = 'playing'
  function pause(paused: boolean) {
    if (paused && (state.phase === 'playing' || state.phase === 'destroyed')) {
      resumeTo = state.phase
      setPhase('paused')
    } else if (!paused && state.phase === 'paused') setPhase(resumeTo)
  }

  source.attach?.({
    restarted,
    lose(reason) {
      if (state.phase === 'lost') return
      state.lost = reason
      setPhase('lost')
    },
  })

  function dispose() {
    view.dispose()
    pilot.dispose()
    mode.dispose()
    scenery.dispose()
    source.dispose()
  }

  return state
}
