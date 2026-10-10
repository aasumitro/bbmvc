import { describe, expect, it } from 'vitest'
import type { Input } from '../src/net/protocol.ts'
import { createQueue, DRAIN, pushInput, QUEUE, queueDepth, stale, STALE, takeInput } from './inputs.ts'

const input = (seq: number): Input => ({
  t: 'in',
  seq,
  throttle: 1,
  steer: 0,
  handbrake: false,
  fire: false,
  recover: false,
  aim: { x: 0, y: 0, z: 0 },
  view: 0,
})

describe('the input queue', () => {
  it.each([
    ['in order', [1, 2, 3], [1, 2, 3]],
    ['a repeat refused', [1, 1, 2], [1, 2]],
    ['an older one refused', [2, 1, 3], [2, 3]],
  ])('takes inputs %s', (_, sent, kept) => {
    const q = createQueue(0)
    for (const seq of sent) pushInput(q, input(seq), 0)
    expect(q.queue.map((i) => i.seq)).toEqual(kept)
  })

  it(`keeps ${QUEUE}: the oldest go, counted as drops`, () => {
    const q = createQueue(0)
    for (let seq = 1; seq <= QUEUE + 2; seq++) pushInput(q, input(seq), 0)
    expect(q.queue.map((i) => i.seq)).toEqual([3, 4, 5, 6, 7, 8])
    expect(q.drops).toBe(2)
  })

  it.each([
    ['before the first input: none (the bot drives)', [], 0, null, 0],
    ['the next queued', [1, 2], 0, 1, 0],
    ['dry: the last again, a repeat', [1], 1, 1, 1],
  ] as const)('a step uses %s', (_, sent, extraSteps, used, repeats) => {
    const q = createQueue(0)
    for (const seq of sent) pushInput(q, input(seq), 0)
    for (let n = 0; n < extraSteps; n++) takeInput(q)
    expect(takeInput(q)?.seq ?? null).toBe(used)
    expect(q.repeats).toBe(repeats)
  })

  it('lets go, at a drain window’s end, what waited through all of it beyond one', () => {
    const q = createQueue(0)
    let seq = 0
    for (let n = 0; n < 4; n++) pushInput(q, input(++seq), 0) // a burst, then the page keeps pace: 4 wait after every step
    for (let step = 0; step < DRAIN; step++) {
      pushInput(q, input(++seq), 0) // and the page keeps pace
      takeInput(q)
    }
    expect(q.drops).toBe(3) // 4 waiting at the window's low, one kept for the jitter
    expect(q.queue.length).toBe(1)
  })

  it('leaves a queue that ran down to one alone', () => {
    const q = createQueue(0)
    let seq = 0
    pushInput(q, input(++seq), 0)
    for (let step = 0; step < DRAIN; step++) {
      pushInput(q, input(++seq), 0)
      takeInput(q)
    }
    expect(q.drops).toBe(0)
  })

  it.each([
    [STALE, false],
    [STALE + 1, true],
  ])('%i ms after the last input heard: stale %s', (ms, coasting) => {
    const q = createQueue(0)
    pushInput(q, input(1), 1000)
    expect(stale(q, 1000 + ms)).toBe(coasting)
  })

  it('counts each step’s depth, for the p50, p95 and max', () => {
    const q = createQueue(0)
    let seq = 0
    for (let step = 0; step < 20; step++) {
      pushInput(q, input(++seq), 0)
      if (step === 10) pushInput(q, input(++seq), 0) // one step two deep
      takeInput(q)
    }
    expect(queueDepth(q)).toEqual({ p50: 0, p95: 1, max: 1 })
  })
})
