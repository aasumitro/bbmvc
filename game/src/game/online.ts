import type * as THREE from 'three'
import { createNetClient, seatOnline } from '../net/client'
import type { Link } from '../net/connection'
import type { Arena } from './arena/arena'
import { createFeed } from './feed'
import type { MapId } from './maps'
import { playMatch, type MatchPhase } from './match'
import { bodyOwner } from './simulation'
import { createMatchView } from './view'

// One online match, as the local player plays it: the match the game
// server runs (server/room.ts), seated here as its welcome says, shown and
// heard through the same view, feed and HUD as practice (match.ts
// playMatch), mirrored from what the server sends (net/client.ts). The
// player's controls go to the server a step at a time; nothing is decided
// here. No pause (the menu opens over a running match), no restart (the
// server starts the next match by itself after the results).

export interface OnlineOptions {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  arena: Arena
  surface: HTMLCanvasElement
  link: Link // a seat, taken (net/connection.ts)
  onPhase: (phase: MatchPhase) => void
}

export function createOnlineMatch({ scene, camera, arena, surface, link, onPhase }: OnlineOptions) {
  const { world, combatants, player, mode } = seatOnline(link.welcome, arena, scene)
  const view = createMatchView({ scene, camera, surface, world, arena, combatants, player })
  const feed = createFeed(combatants, player.id, () => mode.rules.now, view.feedback)
  const hooks = { restarted() {}, lose(_reason: string) {} }
  let seed = link.welcome.seed
  const client = createNetClient({
    link,
    world,
    combatants,
    player,
    mode,
    events: view.events,
    feed,
    refit: (c) => view.refit(c),
    restarted(next) {
      seed = next
      hooks.restarted()
    },
  })
  const { net } = client

  return playMatch(
    { scene, camera, surface, onPhase, arena, map: link.welcome.map as MapId, world, combatants, player, mode, view, feed, combatantOf: bodyOwner(combatants) },
    {
      online: true,
      people: client.humans,
      uids: client.uids,
      seed: () => seed,
      drives: (looking) => looking, // the server holds everyone on the grid
      attach: (given) => Object.assign(hooks, given),
      receive(now) {
        client.receive(now)
        if (net.lost) hooks.lose(net.lost)
      },
      step: (dt) => client.step(dt, player.control),
      place: (now) => client.place(now),
      finish() {}, // the server stands everyone down
      restart() {}, // the server starts the next match
      nextIn: (now) => client.nextIn(now),
      holdIn: (now) => client.holdIn(now),
      debug: () => [
        `ROOM   ${link.welcome.room}  seat ${player.id}  ${client.humans.filter(Boolean).length} people`,
        `NET    ping ${Math.round(link.status.rtt)} ms  snapshot ${Math.round(performance.now() - net.arrivedAt)} ms old  unacked ${net.seq - net.ack}`,
        `CORR   ${client.prediction.corrections} corrections  last ${client.prediction.lastError.toFixed(2)} m  max ${client.prediction.maxError.toFixed(2)} m`,
      ],
      dispose() {
        client.close()
        world.free()
      },
    },
  )
}
