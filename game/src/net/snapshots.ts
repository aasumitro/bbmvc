import { blankCar, RATE, type CarState } from './protocol.ts'

// The other machines as a page shows them: a little in the past, so there
// are always two snapshots to draw between. Every snapshot is kept for a
// second; the machines are drawn at the server's tick as this page reckons
// it, less two snapshot intervals (DELAY), positions lerped and rotations
// slerped between the two snapshots either side. Past the newest (a gap in
// the stream), a machine carries on at its speed for a moment
// (EXTRAPOLATE), then waits. The server's tick is reckoned from when
// snapshots arrive — the earliest-arriving of the last second, the least
// delayed, sets it — and the drawing tick never runs backwards. The tick
// shown is what the page tells the server it sees, for lag compensation.
// (Imports carry .ts: no DOM, no bundler.)

// Ticks behind the server: two snapshot intervals (67 ms). Every tick of it
// is a tick the server's 200 ms of rewind (lag compensation) can't give back
// to a player's aim, so it's as short as keeps a snapshot either side under
// ordinary jitter; `extrapolated` counts the times it wasn't.
export const DELAY = 4
const EXTRAPOLATE = 15 // ticks past the newest snapshot a machine keeps moving (250 ms)
const KEEP = 30 // snapshots kept (a second)
const JUMP = 10 // metres between two snapshots that can't be driving (a respawn, a recovery): no drawing in between
const PER_MS = RATE.step / 1000 // ticks a millisecond

interface Frame {
  tick: number
  cars: CarState[] // by machine id
}

export type SnapshotBuffer = ReturnType<typeof createSnapshotBuffer>

export function createSnapshotBuffer(machines: number) {
  const frames: Frame[] = Array.from({ length: KEEP }, () => ({ tick: -1, cars: Array.from({ length: machines }, blankCar) }))
  let newest = -1 // index of the newest frame
  const offsets: number[] = [] // tick − arrival time × PER_MS, the last second's
  let offset = -Infinity // the reckoning: server tick = offset + now × PER_MS
  let drawn = -Infinity // the last tick drawn at
  const counts = { sampled: 0, extrapolated: 0 } // how often a machine was drawn past the newest snapshot

  // A snapshot's machines, as they arrived at `now` (ms). `write` fills in a frame's car states.
  function push(tick: number, now: number, write: (cars: CarState[]) => void) {
    if (newest >= 0 && tick <= frames[newest].tick) return
    newest = (newest + 1) % KEEP
    const frame = frames[newest]
    frame.tick = tick
    write(frame.cars)
    offsets.push(tick - now * PER_MS)
    if (offsets.length > KEEP) offsets.shift()
    const earliest = Math.max(...offsets)
    // eased onto the least-delayed arrival of the last second; straight there after a long gap (a hidden tab)
    offset = offset === -Infinity || earliest - offset > RATE.step ? earliest : offset + (earliest - offset) * 0.1
  }

  // The tick to draw the others at, `now` (ms): DELAY behind the server's, never going back.
  function clock(now: number) {
    if (newest < 0) return 0
    drawn = Math.max(drawn, offset + now * PER_MS - DELAY)
    return drawn
  }

  // Machine `id` at `tick` into `out`: between the snapshots either side,
  // or carried on from the newest for a moment, or held there.
  function sample(id: number, tick: number, out: CarState) {
    if (newest < 0) return out
    let after = -1
    let before = -1
    for (let k = 0; k < KEEP; k++) {
      const i = (newest - k + KEEP) % KEEP
      const t = frames[i].tick
      if (t < 0) break
      if (t >= tick) after = i
      else {
        before = i
        break
      }
    }
    counts.sampled++
    if (after < 0) {
      counts.extrapolated++
      return extrapolate(frames[newest].cars[id], tick - frames[newest].tick, out)
    }
    if (before < 0) return copy(frames[after].cars[id], out)
    const [a, b] = [frames[before], frames[after]]
    return blend(a.cars[id], b.cars[id], (tick - a.tick) / (b.tick - a.tick), out)
  }

  return {
    push,
    clock,
    sample,
    counts,
    get newest() {
      return newest < 0 ? -1 : frames[newest].tick
    },
    // The server's tick as this page reckons it at `now`: the input it sends is used a little after.
    serverTick: (now: number) => offset + now * PER_MS,
  }
}

function copy(from: CarState, out: CarState) {
  Object.assign(out.position, from.position)
  Object.assign(out.rotation, from.rotation)
  Object.assign(out.velocity, from.velocity)
  Object.assign(out.aim, from.aim)
  out.id = from.id
  out.speed = from.speed
  out.health = from.health
  out.alive = from.alive
  out.present = from.present
  out.handbrake = from.handbrake
  out.fire = from.fire
  out.throttle = from.throttle
  out.steer = from.steer
  return out
}

// Carried on at its speed for `ticks` past `from` (at most EXTRAPOLATE); a wreck stays put.
function extrapolate(from: CarState, ticks: number, out: CarState) {
  copy(from, out)
  if (!from.alive) return out
  const seconds = Math.min(ticks, EXTRAPOLATE) / RATE.step
  out.position.x += from.velocity.x * seconds
  out.position.y += from.velocity.y * seconds
  out.position.z += from.velocity.z * seconds
  return out
}

// `t` of the way from a to b: positions and the rest lerped, the rotation
// slerped; the flags b's. Across a jump, a until b's tick.
function blend(a: CarState, b: CarState, t: number, out: CarState) {
  const dx = b.position.x - a.position.x
  const dz = b.position.z - a.position.z
  if (dx * dx + dz * dz > JUMP * JUMP) return copy(t < 1 ? a : b, out)
  copy(b, out)
  const lerp = (x: number, y: number) => x + (y - x) * t
  for (const key of ['x', 'y', 'z'] as const) {
    out.position[key] = lerp(a.position[key], b.position[key])
    out.velocity[key] = lerp(a.velocity[key], b.velocity[key])
    out.aim[key] = lerp(a.aim[key], b.aim[key])
  }
  out.speed = lerp(a.speed, b.speed)
  out.steer = lerp(a.steer, b.steer)
  out.throttle = lerp(a.throttle, b.throttle)
  slerp(a.rotation, b.rotation, t, out.rotation)
  return out
}

// Quaternion slerp (the shorter way round), written out: the car states are plain numbers.
function slerp(a: CarState['rotation'], b: CarState['rotation'], t: number, out: CarState['rotation']) {
  let { x, y, z, w } = b
  let cos = a.x * x + a.y * y + a.z * z + a.w * w
  if (cos < 0) {
    ;[x, y, z, w, cos] = [-x, -y, -z, -w, -cos]
  }
  let [ka, kb] = [1 - t, t]
  if (cos < 0.9995) {
    const angle = Math.acos(cos)
    const sin = Math.sin(angle)
    ka = Math.sin((1 - t) * angle) / sin
    kb = Math.sin(t * angle) / sin
  }
  const rx = a.x * ka + x * kb
  const ry = a.y * ka + y * kb
  const rz = a.z * ka + z * kb
  const rw = a.w * ka + w * kb
  const length = Math.hypot(rx, ry, rz, rw) || 1
  Object.assign(out, { x: rx / length, y: ry / length, z: rz / length, w: rw / length })
}
