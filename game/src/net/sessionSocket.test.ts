import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { comeBack, mark, readMark, RETRY } from './sessionSocket.ts'

describe('comeBack', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // Each try's time, ms after the drop, while every try fails.
  async function failing(wanted: () => boolean = () => true) {
    const tried: number[] = []
    let gaveUp = -1
    const done = comeBack(
      wanted,
      async () => {
        tried.push(Date.now())
        throw new Error('unreachable')
      },
      () => (gaveUp = Date.now()),
    )
    await vi.runAllTimersAsync()
    await done
    return { tried, gaveUp }
  }

  it('tries after each wait in RETRY, then gives up', async () => {
    const start = Date.now()
    const { tried, gaveUp } = await failing()
    let at = 0
    expect(tried.map((t) => t - start)).toEqual(RETRY.map((wait) => (at += wait)))
    expect(gaveUp - start).toBe(14_000) // inside the 15 s a ticket waits
  })

  it('stops once it is no longer wanted, and never gives up for it', async () => {
    let wanted = true
    const start = Date.now()
    setTimeout(() => (wanted = false), 2500) // the store moves on before the third try (3 s)
    const { tried, gaveUp } = await failing(() => wanted)
    expect(tried.map((t) => t - start)).toEqual([0, 1000])
    expect(gaveUp).toBe(-1)
  })

  it('stops at the first try that works', async () => {
    let tries = 0
    let gaveUp = false
    const done = comeBack(
      () => true,
      async () => {
        if (++tries < 2) throw new Error('not yet')
      },
      () => (gaveUp = true),
    )
    await vi.runAllTimersAsync()
    await done
    expect([tries, gaveUp]).toEqual([2, false])
  })
})

describe('the tab’s mark', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps, reads and removes a value', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    })
    mark('scrapyard.lobby', 'L1')
    expect(readMark('scrapyard.lobby')).toBe('L1')
    mark('scrapyard.lobby', null)
    expect(readMark('scrapyard.lobby')).toBe('')
  })

  it('without storage: nothing kept, nothing thrown', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => mark('scrapyard.search', '{}')).not.toThrow()
    expect(readMark('scrapyard.search')).toBe('')
  })
})
