import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import type { Arena } from '../src/game/arena/arena'
import type { MapId } from '../src/game/maps'
import { PHYSICS_STEP } from '../src/game/physics'
import { createRoom, type Given, type Human, type MatchRecord, type ReplayLine, type Room } from './room'

// A room run again from its journal (room.ts `journal`, kept by records.ts):
// the same first seed, the same people taking and leaving the same seats
// after the same steps, each machine given what the room gave it, each
// next match on the seed it had. The simulation is deterministic, so what
// comes out is what happened — the same match records, fair-play counts
// included, to the bit (server.check holds a replay to that). Streams the
// journal: an hours-long room needs no more memory than a short one.

type Line = Exclude<ReplayLine, { replay: 1 }>

export interface ReplayResult {
  header: Extract<ReplayLine, { replay: 1 }>
  room: Room
  records: MatchRecord[]
  steps: number
}

// The lines of a replay file, one at a time.
export async function* replayLines(path: string): AsyncGenerator<ReplayLine> {
  const lines = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity })
  for await (const text of lines) if (text) yield JSON.parse(text) as ReplayLine
}

const STEP_MS = PHYSICS_STEP * 1000
// Before step s: what happened after step s − 1 (seats taken and left), then step s's own lines.
const ahead = (line: Line, step: number) => line.k < step || (line.k === step && !('join' in line) && !('leave' in line))

export async function replay(lines: AsyncIterable<ReplayLine> | Iterable<ReplayLine>, arena?: (map: MapId) => Arena): Promise<ReplayResult> {
  const iterator = (Symbol.asyncIterator in lines ? lines[Symbol.asyncIterator]() : (lines as Iterable<ReplayLine>)[Symbol.iterator]()) as AsyncIterator<ReplayLine> | Iterator<ReplayLine>
  const next = async () => {
    const got = await iterator.next()
    return got.done ? null : got.value
  }
  const first = await next()
  if (!first || !('replay' in first)) throw new Error('not a replay: no header')
  const header = first
  const seeds: number[] = []
  const records: MatchRecord[] = []
  const room = createRoom({ id: header.room, mode: header.mode, map: header.map, build: header.build, hold: header.hold, seed: header.seed, results: header.results, created: header.created, arena: arena?.(header.map), reseed: () => seeds.shift()!, record: (m) => records.push(m), settings: header.settings, lobby: header.lobby, plan: header.plan })
  // By seat, what the journal last said it was given: the view as its lag behind each step
  const given = new Map<number, { kind: Given['kind']; input: Omit<Given['input'], 'view'>; lag: number }>()
  const bySeat = new Map<number, Human>()
  let waiting = (await next()) as Line | null
  let last = 0 // the last step the journal speaks of
  let step = 1
  for (;;) {
    while (waiting && ahead(waiting, step)) {
      const line = waiting
      last = Math.max(last, line.k)
      if ('join' in line) {
        const [seat, uid, name, weapon] = line.join
        const human = room.join({ uid, name, loadout: { vehicle: 'razor', weapon }, send() {}, close() {} }, (step - 1) * STEP_MS, seat) // a custom room seats them where the line says; Classic finds the same seat itself
        if (!human || human.seat !== seat) throw new Error(`replay diverged after step ${line.k}: ${name} took seat ${human?.seat ?? 'none'}, not ${seat}`)
        bySeat.set(seat, human)
        given.delete(seat)
      } else if ('leave' in line) {
        const human = bySeat.get(line.leave)
        if (human) room.leave(human, (step - 1) * STEP_MS)
        bySeat.delete(line.leave)
        given.delete(line.leave)
      } else if ('in' in line) {
        for (const [seat, kind, throttle = 0, steer = 0, handbrake = 0, fire = 0, recover = 0, x = 0, y = 0, z = 0, lag = 0] of line.in) given.set(seat, { kind: kind as Given['kind'], input: { throttle, steer, handbrake: !!handbrake, fire: !!fire, recover: !!recover, aim: { x, y, z } }, lag })
      } else if ('go' in line) seeds.push(line.go)
      waiting = (await next()) as Line | null
    }
    if (!waiting && step > last) break // the journal is spent: every step it speaks of has run
    for (const [seat, human] of bySeat) {
      const g = given.get(seat)
      room.force(human, g ? { kind: g.kind, input: { ...g.input, view: step - g.lag } } : null)
    }
    room.step(step * STEP_MS)
    step++
  }
  return { header, room, records, steps: step - 1 }
}
