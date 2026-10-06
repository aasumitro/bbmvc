import { useSyncExternalStore } from 'react'
import { currentCustom, onCustom } from '../net/custom'
import { currentSearch, onSearch } from '../net/matchmaking'

// What the screens read of Classic's matchmaking (net/matchmaking.ts) and of
// custom lobbies (net/custom.ts), and the clock they count their times with.

export const useSearch = () => useSyncExternalStore(onSearch, currentSearch)
export const useCustom = () => useSyncExternalStore(onCustom, currentCustom)

// The time now (performance.now()), fresh every `ms` while `on`: the clocks
// the screens count with. Read at render; the ticks are the subscription.
let clock = 0
function ticking(ms: number) {
  return (listener: () => void) => {
    const tick = () => {
      clock = performance.now()
      listener()
    }
    const timer = setInterval(tick, ms)
    clock = performance.now()
    return () => clearInterval(timer)
  }
}
const TICKS = { 100: ticking(100), 500: ticking(500) }
const still = () => () => {}
export const useClock = (on: boolean, ms: keyof typeof TICKS = 500) => useSyncExternalStore(on ? TICKS[ms] : still, () => clock)

// 83 s → '1:23'.
export const waited = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
