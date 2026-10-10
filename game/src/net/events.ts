import type { WireEvent } from './protocol.ts'

// The match's events on the wire: [code, tick, ...fields] (NET_PLAN.md §4),
// each code's fields in wire order with how each is quantized. One table:
// the recorder encodes by it (server/recorder.ts), the page decodes by it
// (client.ts), and the seats it names say whose event it is.

type Vec = { x: number; y: number; z: number }

// How a field travels: a seat (-1 none) or a whole number as it is; a flag
// as 1 / 0; hundredths (centimetres, a normal's parts, a crash's numbers),
// one number or three; a direction in ten-thousandths; the rules' own
// event as it is (JSON).
const UNITS = { seat: 1, int: 1, flag: 1, cm: 100, cm3: 100, q3: 1e4, raw: 0 }
type Unit = keyof typeof UNITS
type Value<U extends Unit> = U extends 'cm3' | 'q3' ? Vec : U extends 'flag' ? boolean : U extends 'raw' ? unknown : number

const FIELDS = {
  // A hitscan round, where it landed
  sh: [
    ['shooter', 'seat'],
    ['muzzle', 'cm3'],
    ['point', 'cm3'],
    ['normal', 'cm3'],
    ['struck', 'flag'],
    ['victim', 'seat'],
  ],
  // A rocket leaves
  ln: [
    ['shooter', 'seat'],
    ['muzzle', 'cm3'],
    ['heading', 'q3'],
  ],
  // A rocket's flight since the last snapshot
  rk: [
    ['from', 'cm3'],
    ['to', 'cm3'],
  ],
  // A rocket bursts
  bu: [['at', 'cm3']],
  // A hit
  hu: [
    ['victim', 'seat'],
    ['attacker', 'seat'],
  ],
  // A wreck
  wr: [
    ['victim', 'seat'],
    ['attacker', 'seat'],
  ],
  // A crash, where and how hard
  cr: [
    ['seat', 'seat'],
    ['x', 'cm'],
    ['z', 'cm'],
    ['force', 'cm'],
  ],
  // A reload starts or ends
  rl: [
    ['seat', 'seat'],
    ['started', 'flag'],
  ],
  // A respawn
  sp: [['seat', 'seat']],
  // A stuck car recovered
  rc: [['seat', 'seat']],
  // The mode's own event
  ru: [['event', 'raw']],
  // The next match starts on this seed
  go: [['seed', 'int']],
} as const satisfies Record<string, ReadonlyArray<readonly [string, Unit]>>

type EventCode = keyof typeof FIELDS
type Fields<C extends EventCode> = { [F in (typeof FIELDS)[C][number] as F[0]]: Value<F[1]> }
export type GameEvent = { [C in EventCode]: { code: C; tick: number } & Fields<C> }[EventCode]

// Played the moment they arrive, never held for the drawing: the rules' events and a restart.
export const NOW: ReadonlySet<EventCode> = new Set(['ru', 'go'])

const isCode = (code: unknown): code is EventCode => typeof code === 'string' && Object.hasOwn(FIELDS, code)
const fieldsOf = (code: EventCode): ReadonlyArray<readonly [string, Unit]> => FIELDS[code]

export function encode(event: GameEvent): WireEvent {
  const named = event as unknown as Record<string, unknown>
  const row: WireEvent = [event.code, event.tick]
  for (const [name, unit] of fieldsOf(event.code)) {
    const value = named[name]
    if (unit === 'cm3' || unit === 'q3') {
      const { x, y, z } = value as Vec
      row.push(Math.round(x * UNITS[unit]), Math.round(y * UNITS[unit]), Math.round(z * UNITS[unit]))
    } else if (unit === 'flag') row.push(value ? 1 : 0)
    else if (unit === 'cm') row.push(Math.round((value as number) * UNITS.cm))
    else row.push(value)
  }
  return row
}

// A row as the server wrote it; null for a code this build doesn't know.
export function decode([code, tick, ...row]: WireEvent): GameEvent | null {
  if (!isCode(code)) return null
  const event: Record<string, unknown> = { code, tick }
  let at = 0
  for (const [name, unit] of fieldsOf(code)) {
    if (unit === 'cm3' || unit === 'q3') {
      const [x, y, z] = row.slice(at, (at += 3)) as number[]
      event[name] = { x: x / UNITS[unit], y: y / UNITS[unit], z: z / UNITS[unit] }
    } else {
      const value = row[at++]
      event[name] = unit === 'flag' ? value === 1 : unit === 'cm' ? (value as number) / UNITS.cm : value
    }
  }
  return event as GameEvent
}

// The seats an event names (shooter, victim, attacker, the car): the player's
// own events, those naming their seat, play at once.
export function owners(event: GameEvent): number[] {
  const named = event as unknown as Record<string, unknown>
  return fieldsOf(event.code).flatMap(([name, unit]) => (unit === 'seat' ? [named[name] as number] : []))
}
