import * as THREE from 'three'
import type { Arena } from '../src/game/arena/arena'
import type { Feed } from '../src/game/mode'
import { PHYSICS_STEP } from '../src/game/physics'
import type { Combatant, SimEvents } from '../src/game/simulation'
import { createNetClient, seatOnline } from '../src/net/client'
import { join, openSocket, type Link } from '../src/net/connection'
import { mintToken } from './auth'

// A browser without the browser, for the checks: a player's page as
// online.ts builds it (net/connection.ts, net/client.ts), with a presenter
// that writes down what it's shown and a feed that writes down what it's
// told, and frames run the way the page runs them — fixed steps out of
// whatever time has passed, one input each. `browser` takes a seat at once
// (a hello with a mode and an arena); `page` plays a seat however it came
// (matchmaking's, on the socket that searched).

export interface BrowserOptions {
  port: number
  key: string // the test server's session key: the token is minted with it
  origin: string
  uid: string
  arena: Arena // what the page builds for the map (the server's own, or a test yard)
  mode?: string
  map?: string
  weapon?: 'minigun' | 'rocketPod'
}

export type Browser = Awaited<ReturnType<typeof browser>>

export async function browser({ port, key, origin, uid, arena, mode = 'tdm', map = 'scrapyard', weapon = 'minigun' }: BrowserOptions) {
  const socket = await openSocket(`ws://127.0.0.1:${port}/match`, origin)
  return page(await join(socket, { token: mintToken({ uid, usn: uid, exp: Date.now() / 1000 + 3600 }, key), guest: false, mode, map, loadout: { vehicle: 'razor', weapon } }), arena)
}

export function page(link: Link, arena: Arena) {
  const seated = seatOnline(link.welcome, arena)
  const shown: Array<[string, ...unknown[]]> = []
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      void shown.push([name, ...args])
  const events: SimEvents = { fired: record('fired'), shot: record('shot'), rocket: record('rocket'), burst: record('burst'), hurt: record('hurt'), wrecked: record('wrecked'), crashed: record('crashed'), reloading: record('reloading'), respawned: record('respawned'), recovered: record('recovered') }
  const lines: string[] = []
  const feed: Feed = {
    me: seated.player.id,
    name: (id) => (id === seated.player.id ? 'you' : seated.combatants[id].name),
    kill: ({ killer, victim }) => lines.push(`kill ${feed.name(killer)} > ${feed.name(victim)}`),
    teamKill: (killer, victim) => lines.push(`teamkill ${feed.name(killer)} > ${feed.name(victim)}`),
    death: (victim) => lines.push(`death ${victim}`),
    phase: (phase) => lines.push(`phase ${phase}`),
    news: (text) => lines.push(text),
    callout: (text) => lines.push(`callout ${text}`),
    pickup() {},
  }
  const refits: Combatant[] = []
  const restarts: number[] = []
  const client = createNetClient({ link, ...seated, events, feed, refit: (c) => refits.push(c), restarted: (seed) => restarts.push(seed) })
  const control = { throttle: 0, steer: 0, handbrake: false, fire: false, recover: false, aim: new THREE.Vector3() }
  return { link, ...seated, client, shown, lines, refits, restarts, control, awake: true, owed: 0, framedAt: -1 }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Frames for `ms` of real time, ~60 a second as a page draws them: each
// takes what arrived, runs the fixed steps owed (an input each), and shows
// the match. `each`: called before every step (a scripted driver).
export async function play(ms: number, browsers: Browser[], each?: (b: Browser) => void) {
  const end = performance.now() + ms
  while (performance.now() < end) {
    const now = performance.now()
    for (const b of browsers) {
      if (!b.awake) {
        b.framedAt = -1
        continue
      }
      b.owed += b.framedAt < 0 ? PHYSICS_STEP : Math.min(0.1, (now - b.framedAt) / 1000)
      b.framedAt = now
      b.client.receive(now)
      while (b.owed >= PHYSICS_STEP) {
        each?.(b)
        b.client.step(PHYSICS_STEP, b.control)
        b.owed -= PHYSICS_STEP
      }
      b.client.place(now)
    }
    await wait(1000 / 60)
  }
}

export async function until(done: () => boolean, ms: number, what: string, browsers: Browser[]) {
  const end = performance.now() + ms
  while (!done()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`)
    await play(50, browsers)
  }
}
