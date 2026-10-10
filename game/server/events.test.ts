import { describe, expect, it } from 'vitest'
import { decode, NOW, owners } from '../src/net/events.ts'
import { readServer, type WireEvent } from '../src/net/protocol.ts'
import { initPhysics, PHYSICS_STEP } from '../src/sim/physics.ts'
import { arenaData } from './arenas.ts'
import { createRoom } from './room.ts'

// The wire's event codec (src/net/events.ts) against what the page read
// before it, over the events of a real room (the codec's own round trips:
// src/net/events.test.ts).

// What net/client.ts read from a row by position before this codec (at
// 4a0cd37..e7084ad), kept here as the reference: the fields its play() took
// and the seats its mine() said were the player's.
function positional([code, tick, ...f]: WireEvent): Record<string, unknown> {
  const n = (i: number) => f[i] as number
  const xyz = (i: number, unit = 100) => ({ x: n(i) / unit, y: n(i + 1) / unit, z: n(i + 2) / unit })
  switch (code) {
    case 'sh':
      return { code, tick, shooter: n(0), muzzle: xyz(1), point: xyz(4), normal: xyz(7), struck: !!f[10], victim: n(11) }
    case 'ln':
      return { code, tick, shooter: n(0), muzzle: xyz(1), heading: xyz(4, 1e4) }
    case 'rk':
      return { code, tick, from: xyz(0), to: xyz(3) }
    case 'bu':
      return { code, tick, at: xyz(0) }
    case 'hu':
    case 'wr':
      return { code, tick, victim: n(0), attacker: n(1) }
    case 'cr':
      return { code, tick, seat: n(0), x: n(1) / 100, z: n(2) / 100, force: n(3) / 100 }
    case 'rl':
      return { code, tick, seat: n(0), started: f[1] === 1 }
    case 'sp':
    case 'rc':
      return { code, tick, seat: n(0) }
    case 'ru':
      return { code, tick, event: f[0] }
    case 'go':
      return { code, tick, seed: n(0) }
  }
  return {}
}
function mine([code, , ...f]: WireEvent, me: number) {
  switch (code) {
    case 'sh':
      return f[0] === me || f[11] === me
    case 'hu':
    case 'wr':
      return f[0] === me || f[1] === me
    case 'ln':
    case 'cr':
    case 'rl':
    case 'sp':
    case 'rc':
      return f[0] === me
  }
  return false
}

// A minute and a bit of a bots-only free for all on The City (pickups on),
// every snapshot's events as a page receives them.
async function recorded() {
  await initPhysics()
  arenaData('city')
  const at = (k: number) => k * 1000 * PHYSICS_STEP
  const room = createRoom({ id: 'events', mode: 'ffa', map: 'city', seed: 4242, created: 0 })
  const rows: WireEvent[] = []
  room.join(
    {
      uid: 'watch',
      name: 'watch',
      loadout: { vehicle: 'razor', weapon: 'rocketPod' },
      send: (data) => {
        const message = readServer(data)
        if (message.t === 's') rows.push(...message.ev)
      },
      close() {},
    },
    0,
  )
  for (let k = 1; k <= 60 * 70; k++) room.step(at(k))
  room.dispose()
  return rows
}

describe('the codec against the positional reads', async () => {
  const rows = await recorded()
  const codes = new Set(rows.map(([code]) => code))

  it('heard a match’s worth of events', () => {
    expect(rows.length).toBeGreaterThan(1000)
    expect([...codes].sort()).toEqual(expect.arrayContaining(['bu', 'hu', 'ln', 'rk', 'rl', 'ru', 'sh', 'sp', 'wr']))
  })

  it('decodes every event to the fields the page read', () => {
    for (const row of rows) expect(decode(row)).toEqual(positional(row))
  })

  it('names the seats that made an event the player’s, for every seat', () => {
    for (const row of rows) for (let me = 0; me < 8; me++) expect([row[0], me, owners(decode(row)!).includes(me)]).toEqual([row[0], me, mine(row, me)])
  })

  it('plays at once only the rules’ events and a restart', () => {
    for (const row of rows) expect(NOW.has(decode(row)!.code)).toBe(row[0] === 'ru' || row[0] === 'go')
  })
})
