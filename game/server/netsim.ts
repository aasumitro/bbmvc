import { createRng } from '../src/shared/rng.ts'

// The game server's latency simulator, for development (server.ts, from
// NET_LAG_MS / NET_JITTER_MS; netplay.test drives it): each socket's link,
// both ways, held back `lag` ms, give or take `jitter`, with an optional
// stall every so often; off (`delayed` false) with none of them.

export interface Conditions {
  lag: number // ms each way
  jitter: number // ms either side of `lag`, message by message
  stall?: { every: number; for: number } // ms: the link stops for a while, then delivers what it held
}

export function createNetsim({ lag, jitter, stall }: Conditions, started: number) {
  const wobble = createRng(0x51ed) // the jitter (network conditions, not gameplay)
  const delayed = lag > 0 || jitter > 0 || !!stall

  // A one-way link that holds each message back `lag` ms, give or take
  // `jitter` (and past the end of a stall), and hands them over strictly in
  // order, as TCP does: one queue, one timer (timers of different lengths due
  // together fire in no set order, so each message can't have its own).
  const stallEnd = (now: number) => {
    if (!stall) return 0
    const into = (now - started) % stall.every
    return into < stall.for ? now - into + stall.for : 0
  }
  function held<T>(deliver: (item: T) => void) {
    const queue: Array<{ at: number; item: T }> = []
    let timer: NodeJS.Timeout | undefined
    function pump() {
      timer = undefined
      while (queue.length && queue[0].at <= performance.now()) deliver(queue.shift()!.item)
      if (queue.length) timer = setTimeout(pump, Math.max(0, queue[0].at - performance.now()))
    }
    return (item: T) => {
      const now = performance.now()
      const at = Math.max(queue.at(-1)?.at ?? 0, stallEnd(now) + lag, now + lag + (wobble() * 2 - 1) * jitter)
      queue.push({ at, item })
      timer ??= setTimeout(pump, Math.max(0, at - performance.now()))
    }
  }

  return { delayed, held }
}
