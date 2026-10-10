import { acceptSeq, type Input } from '../src/net/protocol.ts'

// A person's inputs as a room (room.ts) takes them: queued in order as they
// arrive, one used each step (the last again while none has come), the
// queue kept short. Pure: the room says when.

export const QUEUE = 6 // inputs kept per player; past this the oldest go (latency capped)
// A drain window, in steps. A stall on the way leaves a burst of inputs
// queued, and while the page keeps pace nothing would ever empty the queue
// again: every input after waits that much longer, and the tick it says it
// saw ages against the rewind's 200 ms (measured: 4–5 deep for good after
// the first stall, NET_LOG.md). So inputs that waited through a whole window
// — beyond one kept for the jitter — are standing delay, not jitter, and are
// let go at the window's end (drops: one correction's worth). A queue that
// ran down to one or none in the window is absorbing jitter, and is left alone.
export const DRAIN = 30
export const STALE = 250 // ms without input: the machine coasts, trigger off

export interface InputQueue {
  queue: Input[]
  last: Input | null // repeated while the queue is dry; null until the first: a bot still drives the machine
  repeats: number // steps that had to repeat the last input (the queue ran dry)
  drops: number // inputs let go unused (the queue grew too long)
  depths: number[] // steps by how many inputs still waited after the step took its own: 0..QUEUE
  low: number // the fewest inputs waiting after a step, this drain window
  window: number // steps into it
  seq: number // the newest seq taken in
  ack: number // the last seq used on a step
  heardAt: number // ms: when the latest input arrived
}

export const createQueue = (now: number): InputQueue => ({
  queue: [],
  last: null,
  repeats: 0,
  drops: 0,
  depths: new Array<number>(QUEUE + 1).fill(0),
  low: Infinity,
  window: 0,
  seq: -1,
  ack: -1,
  heardAt: now,
})

// An input arrives: taken in order only, queued for the steps to use.
export function pushInput(q: InputQueue, message: Input, now: number) {
  if (!acceptSeq(q.seq, message.seq)) return false
  q.seq = message.seq
  q.heardAt = now
  q.queue.push(message)
  if (q.queue.length > QUEUE) {
    q.queue.shift()
    q.drops++
  }
  return true
}

// A step's input: the next one queued, or the last again (null before the
// first); then the drain window and the depth statistics.
export function takeInput(q: InputQueue) {
  const input = q.queue.shift()
  if (input) {
    q.last = input
    q.ack = input.seq
  } else if (q.last) q.repeats++
  q.low = Math.min(q.low, q.queue.length)
  if (++q.window >= DRAIN) {
    const slack = Math.max(0, q.low - 1)
    q.queue.splice(0, slack)
    q.drops += slack
    q.low = Infinity
    q.window = 0
  }
  q.depths[q.queue.length]++
  return q.last
}

// Nothing heard for STALE: the machine coasts.
export const stale = (q: InputQueue, now: number) => now - q.heardAt > STALE

// How deep a person's input queue ran, step by step: each queued input is a
// step (17 ms) more between their keys and their machine, and a step less of
// the rewind's 200 ms for their aim.
export function queueDepth(q: InputQueue) {
  const total = q.depths.reduce((sum, n) => sum + n, 0)
  const at = (share: number) => {
    let seen = 0
    for (const [depth, n] of q.depths.entries()) if ((seen += n) >= share * total) return depth
    return 0
  }
  return { p50: at(0.5), p95: at(0.95), max: q.depths.findLastIndex((n) => n > 0) }
}
