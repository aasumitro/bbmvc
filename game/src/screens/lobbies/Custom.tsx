import { useEffect } from 'react'
import type { Loadout } from '../../sim/loadout.ts'
import { closeCustom, openCustom } from '../../net/lobbies.ts'
import { cancelSearch } from '../../net/matchmaking.ts'
import { Lobbies } from './Lobbies.tsx'
import { Lobby } from './Lobby.tsx'
import { useCustom, useSearch } from '../hooks.ts'

interface CustomProps {
  loadout: Loadout // the gun a seat in a lobby's match is fitted with
  active: boolean // the keys are here
  onBack: () => void // back to the arena screen's modes
}

// The arena screen's Custom entry (net/lobbies.ts): the lobby list, or the
// waiting room of the lobby the player is in (or the way back into it after
// a drop or a reload). Opening it signs in and opens
// the socket; leaving it closes the socket unless the player is in a lobby.
// Classic's search and a lobby share nothing: while a search is on, it
// offers to cancel it first.
export function Custom({ loadout, active, onBack }: CustomProps) {
  const custom = useCustom()
  const search = useSearch()
  const searching = search.phase !== 'idle'

  useEffect(() => {
    if (!searching) void openCustom(loadout)
  }, [searching, loadout])
  useEffect(() => closeCustom, [])

  // Nothing to choose while searching or coming back: Esc goes back to the modes (Enter cancels a search).
  const idle = searching || custom.phase === 'back'
  useEffect(() => {
    if (!active || !idle) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' && !(e.key === 'Enter' && searching)) return
      e.preventDefault()
      if (e.key === 'Enter') cancelSearch()
      else onBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, idle, searching, onBack])

  if (searching)
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <p className="text-sm font-bold tracking-[0.3em] text-neutral-200 uppercase">You’re searching in Classic</p>
        <p className="mt-2 max-w-sm font-display text-base text-neutral-400 italic">
          Custom lobbies and Classic’s search don’t mix: cancel the search to look at the lobbies.
        </p>
        <button
          onClick={cancelSearch}
          className="mt-6 rounded border-2 border-red-500 bg-black/55 px-4 py-2 text-xs font-bold tracking-[0.15em] text-white uppercase shadow-[0_0_18px_rgba(239,68,68,0.45)] hover:bg-black/70"
        >
          Cancel search
        </button>
      </div>
    )
  if (custom.phase === 'back')
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <p className="text-sm font-bold tracking-[0.3em] text-neutral-200 uppercase">Reconnecting…</p>
        <p className="mt-2 max-w-sm font-display text-base text-neutral-400 italic">Getting back into the lobby.</p>
      </div>
    )
  if (custom.phase === 'lobby') return <Lobby custom={custom} active={active} />
  if (custom.phase === 'seated') return null // the match is on screen (App)
  return <Lobbies custom={custom} active={active} onBack={onBack} onRetry={() => void openCustom(loadout)} />
}
