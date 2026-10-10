import * as THREE from 'three'
import type { SimEvents } from '../src/sim/simulation.ts'
import { encode } from '../src/net/events.ts'
import type { WireEvent } from '../src/net/protocol.ts'

// A room's SimEvents: everything the simulation reports mid-step, written
// down as wire events ([code, tick, ...], NET_PLAN.md §4) until the next
// snapshot takes them. Each browser plays them back into its own view. A
// rocket reports every step of its flight; those come out joined, one
// segment per rocket per snapshot — a step's `from` is the same numbers as
// the step before's `to`, so the pieces are matched exactly. Each event is
// encoded by net/events.ts.

export function createRecorder(tick: () => number) {
  let events: WireEvent[] = []
  const flights: Array<{ tick: number; from: THREE.Vector3; to: THREE.Vector3 }> = [] // rockets in flight since the last snapshot

  const sim: SimEvents = {
    fired(c, muzzle, heading) {
      const { spec } = c.weapon
      switch (spec.kind) {
        case 'gun':
          return // a hitscan round is written whole when it lands (`shot`)
        case 'rocket':
          events.push(encode({ code: 'ln', tick: tick(), shooter: c.id, muzzle, heading }))
          return
        default:
          return spec satisfies never
      }
    },
    shot(c, muzzle, shot, victim) {
      const { point, normal } = shot
      events.push(encode({ code: 'sh', tick: tick(), shooter: c.id, muzzle, point, normal, struck: !!shot.collider, victim: victim?.id ?? -1 }))
    },
    rocket(from, to) {
      const flight = flights.find((f) => f.to.equals(from))
      if (flight) flight.to.copy(to)
      else flights.push({ tick: tick(), from: from.clone(), to: to.clone() })
    },
    burst(at) {
      events.push(encode({ code: 'bu', tick: tick(), at }))
    },
    hurt(victim, attacker) {
      events.push(encode({ code: 'hu', tick: tick(), victim: victim.id, attacker: attacker.id }))
    },
    wrecked(victim, attacker) {
      events.push(encode({ code: 'wr', tick: tick(), victim: victim.id, attacker: attacker.id }))
    },
    crashed(c, x, z, force) {
      events.push(encode({ code: 'cr', tick: tick(), seat: c.id, x, z, force }))
    },
    reloading(c, started) {
      events.push(encode({ code: 'rl', tick: tick(), seat: c.id, started }))
    },
    respawned(c) {
      events.push(encode({ code: 'sp', tick: tick(), seat: c.id }))
    },
    recovered(c) {
      events.push(encode({ code: 'rc', tick: tick(), seat: c.id }))
    },
  }

  return {
    sim,
    // The mode's own events, raw: each browser's adapter announces them for its player.
    rules(list: readonly unknown[]) {
      for (const event of list) events.push(encode({ code: 'ru', tick: tick(), event }))
    },
    // The room starts its next match on `seed`.
    restart(seed: number) {
      events.push(encode({ code: 'go', tick: tick(), seed }))
    },
    // Everything since the last call, rocket flights last; then starts over.
    drain() {
      for (const { tick, from, to } of flights) events.push(encode({ code: 'rk', tick, from, to }))
      flights.length = 0
      const taken = events
      events = []
      return taken
    },
  }
}
