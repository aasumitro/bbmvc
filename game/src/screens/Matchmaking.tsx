import { useEffect } from 'react'
import { playSound, prepareSounds } from '../game/audio'
import { MAPS, type MapId } from '../game/maps'
import { MODES, type Mode } from '../game/modes'
import { answer, cancelSearch, type Search } from '../net/matchmaking'
import { ActionButton } from './Menu'
import { useClock, useSearch, waited } from './search'

// Classic's matchmaking over every screen (net/matchmaking.ts is the store):
// the ready check when a match is found — over the arena screen, the menus
// or a practice match that plays on underneath — a small line saying a
// search is on, away from the arena screen (which has its own), and a word
// on how a search ended. Times count down and up from what the server said.

const modeName = (mode: string) => (Object.hasOwn(MODES, mode) ? MODES[mode as Mode].label : mode)
const mapName = (map: string) => (Object.hasOwn(MAPS, map) ? MAPS[map as MapId].name : map)

export function Matchmaking({ arena, inGame }: { arena: boolean; inGame: boolean }) {
  const search = useSearch()
  return (
    <>
      {(search.phase === 'found' || search.phase === 'accepted') && <ReadyCheck key={search.id} search={search} />}
      {!arena && (search.phase === 'connecting' || search.phase === 'searching') && <Searching search={search} inGame={inGame} />}
      <Note search={search} />
    </>
  )
}

type Found = Extract<Search, { phase: 'found' | 'accepted' }>
const keycap = 'rounded border border-neutral-500/50 px-1.5 py-0.5'

// Match found: accept or decline before the server's time runs out. Enter or
// Y accepts, N declines, ahead of whatever is underneath (a practice match
// keeps driving); a cue announces it. The server's word decides: an answer
// shows as sent until it comes back.
function ReadyCheck({ search }: { search: Found }) {
  const left = Math.min(search.of, Math.max(0, search.deadline - useClock(true, 100))) // held to the check's length: the clock's first reading may be old
  const accepted = search.phase === 'accepted'
  const backfill = search.size === 1 && search.players > 1 // a bot's seat in a match already running

  useEffect(() => {
    prepareSounds()
    playSound('found')
  }, [])
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const yes = e.key === 'Enter' || e.code === 'KeyY'
      if (!yes && e.code !== 'KeyN') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!e.repeat) answer(yes)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const dots = Array.from({ length: search.size }, (_, i) => (i < search.accepted ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : i < search.accepted + search.declined ? 'bg-red-500' : 'border border-white/40'))
  return (
    <div role="alertdialog" aria-labelledby="found-title" aria-describedby="found-line" className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 text-[#f2ece0]">
      <div className="w-[min(92vw,480px)] border border-red-500/60 bg-[#12161f] px-9 py-8 shadow-[0_24px_70px_rgba(0,0,0,0.65)]">
        <p className="text-xs font-bold tracking-[0.3em] text-red-400 uppercase">{modeName(search.mode)} · Online</p>
        <h2 id="found-title" className="m-0 mt-2 font-display text-5xl font-semibold">
          Match found
        </h2>
        <p id="found-line" className="mt-2 font-display text-lg text-neutral-300 italic">
          {backfill ? 'A match in progress' : mapName(search.map)} · {backfill ? mapName(search.map) : `${search.players} players`}
          {backfill && ` · ${search.players} players with you`}
        </p>
        <div className="mt-6 flex items-center gap-2" aria-label={`${search.accepted} of ${search.size} ready`}>
          {dots.map((look, i) => (
            <span key={i} className={`h-3 w-3 rotate-45 ${look}`} />
          ))}
        </div>
        <div className="mt-5 h-1 overflow-hidden bg-white/10">
          <div className="h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)] transition-[width] duration-100 ease-linear" style={{ width: `${(left / search.of) * 100}%` }} />
        </div>
        <p className="mt-2 text-right text-xs font-bold tracking-[0.2em] text-neutral-400 tabular-nums">{Math.ceil(left / 1000)} s</p>
        {accepted ? (
          <div className="mt-5 flex items-baseline justify-between gap-4">
            <p className="font-display text-lg italic">
              {search.accepted} / {search.size} ready — waiting…
            </p>
            <button onClick={() => answer(false)} className="text-xs font-bold tracking-[0.2em] text-neutral-400 uppercase hover:text-red-400">
              Decline
            </button>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <ActionButton primary title="Accept" line={search.answered ? 'Sent…' : 'Enter or Y'} onClick={search.answered ? undefined : () => answer(true)} />
            <ActionButton title="Decline" line="N" onClick={search.answered ? undefined : () => answer(false)} />
          </div>
        )}
        <div className="mt-6 flex items-center gap-4 text-xs tracking-[0.1em] text-neutral-400 uppercase">
          <span className={keycap}>Enter</span>
          <span>Accept</span>
          <span className={keycap}>N</span>
          <span>Decline</span>
        </div>
      </div>
    </div>
  )
}

// A search on: its mode, arena and how long so far, and a way out. In a match it sits
// at the right edge, clear of the HUD.
function Searching({ search, inGame }: { search: Extract<Search, { phase: 'connecting' | 'searching' }>; inGame: boolean }) {
  const now = useClock(true)
  const text = search.phase === 'connecting' ? 'Connecting…' : search.away ? 'Reconnecting…' : `Finding players · ${waited(Math.max(0, now - search.since))}`
  return (
    <div role="status" className={`fixed z-30 flex items-center gap-3 rounded border border-white/15 bg-black/65 px-4 py-2 text-xs font-bold tracking-[0.2em] whitespace-nowrap text-neutral-200 uppercase backdrop-blur-md ${inGame ? 'top-1/2 right-[2.2vw] -translate-y-1/2' : 'top-4 left-1/2 -translate-x-1/2'}`}>
      <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
      <span className="text-red-400">
        {modeName(search.mode)} · {mapName(search.map)}
      </span>
      <span className="tabular-nums">{text}</span>
      <button onClick={cancelSearch} className="ml-2 text-neutral-400 uppercase hover:text-red-400">
        Cancel
      </button>
    </div>
  )
}

// How a search ended, or went back to the queue: a line, while the store says it.
function Note({ search }: { search: Search }) {
  const note = search.phase === 'idle' || search.phase === 'searching' ? search.note : ''
  if (!note) return null
  return (
    <p role="status" className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded border border-white/15 bg-black/75 px-5 py-2.5 font-display text-base whitespace-nowrap text-neutral-100 italic backdrop-blur-md">
      {note}
    </p>
  )
}
