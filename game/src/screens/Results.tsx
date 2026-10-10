import { useEffect, useState } from 'react'
import { playSound } from '../view/audio.ts'
import type { Match } from '../runtime/match.ts'
import type { Mode } from '../modes/ids.ts'
import { MODE_VIEWS } from '../modes/views.ts'
import { tallyKey } from '../net/lobbyRules.ts'
import type { LobbyView } from '../net/lobbyProtocol.ts'
import { Tally } from './lobbies/Lobby.tsx'
import { Menu } from './Menu.tsx'
import { rise } from './resultsFormat.ts'

// End of a match: the mode's results panel (MODE_VIEWS: the result, the
// player's record, everyone's standing, in ResultsFrame.tsx), and under the
// record Play again / Exit to garage (arrows or W A S D, Enter) — online,
// the countdown to the room's next match and Back to garage instead; a
// custom lobby's match, the countdown back to its waiting room, Back to
// lobby, and the lobby's tally with this result in it.

interface ResultsProps {
  match: Match
  lobby?: LobbyView | null // a custom lobby's match: its lobby
  onPlayAgain: () => void
  onExit: () => void
}

// The tally's key this match's result adds a win to (net/lobbyRules.ts tallyKey): the side, the winner's user id or bot slot; none for a draw.
function winnerKey(match: Match, lobby: LobbyView) {
  const winner = match.mode.outcome() // the winning team; free for all: the winner's seat
  return winner === null || winner === undefined ? undefined : tallyKey(lobby.mode as Mode, winner, lobby.slots) || undefined
}

export function Results({ match, lobby, onPlayAgain, onExit }: ResultsProps) {
  const { ResultsPanel } = MODE_VIEWS[match.mode.kind]
  return (
    <ResultsPanel match={match}>
      {lobby && (
        <div className="animate-rise border border-white/10 bg-white/3 px-4 py-3 motion-reduce:animate-none" style={rise(8)}>
          <p className="text-[0.6rem] font-bold tracking-[0.3em] text-neutral-400 uppercase">Lobby tally</p>
          <div className="mt-1">
            <Tally lobby={lobby} won={winnerKey(match, lobby)} />
          </div>
        </div>
      )}
      {match.online && <NextMatch match={match} what={lobby ? 'Back to the lobby' : 'Next match'} />}
      <Choices
        options={
          lobby
            ? [{ label: 'Back to lobby', action: onExit }]
            : match.online
              ? [{ label: 'Back to garage', action: onExit }]
              : [
                  { label: 'Play again', action: onPlayAgain },
                  { label: 'Exit to garage', action: onExit },
                ]
        }
      />
    </ResultsPanel>
  )
}

// Online: the room starts its next match by itself (a custom lobby's goes back to its waiting room); the seconds until it does.
function NextMatch({ match, what }: { match: Match; what: string }) {
  const [left, setLeft] = useState(() => match.nextIn())
  useEffect(() => {
    const timer = setInterval(() => setLeft(match.nextIn()), 250)
    return () => clearInterval(timer)
  }, [match])
  return (
    <p className="animate-rise font-display text-lg text-neutral-200 italic motion-reduce:animate-none" style={rise(8)}>
      {left < Infinity ? `${what} in ${Math.ceil(left)} s` : `${what} soon`}
    </p>
  )
}

// Play again / Exit to garage, side by side: arrows or W A S D choose, Enter or Space picks.
function Choices({ options }: { options: Array<{ label: string; action: () => void }> }) {
  const [selected, setSelected] = useState(0)
  const choose = (i: number) => {
    playSound('ui')
    options[i].action()
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return // a key still held from driving must not run through the menu
      if (['ArrowRight', 'ArrowDown', 'KeyD', 'KeyS'].includes(e.code)) setSelected((i) => (i + 1) % options.length)
      if (['ArrowLeft', 'ArrowUp', 'KeyA', 'KeyW'].includes(e.code)) setSelected((i) => (i - 1 + options.length) % options.length)
      if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault() // no second press through a focused button
        choose(selected)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="mt-3 animate-rise motion-reduce:animate-none" style={rise(9)}>
      <Menu row items={options} selected={selected} onSelect={setSelected} onActivate={choose} />
      <p className="mt-5 flex items-center gap-3 text-[0.65rem] tracking-widest text-neutral-500 uppercase">
        <span className="rounded border border-neutral-500/50 px-1.5 py-0.5">&larr;&rarr;</span>
        Choose
        <span className="rounded border border-neutral-500/50 px-1.5 py-0.5">Enter</span>
        Select
      </p>
    </div>
  )
}
