import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MAPS, type MapId } from '../../content/arenas/maps.ts'
import { minutes } from '../../modes/matchSettings.ts'
import { MODES } from '../../modes/modes.ts'
import { MODE_IDS, type Mode } from '../../modes/ids.ts'
import { ask, type Custom } from '../../net/lobbies.ts'
import { LIMITS } from '../../net/limits.ts'
import { INVITE, readCode, type LobbyRow } from '../../net/lobbyProtocol.ts'
import { player } from '../../net/session.ts'
import { LobbyForm } from './LobbyForm.tsx'
import { Segmented } from '../Menu.tsx'
import { useClock, waited } from '../hooks.ts'

type Listing = Exclude<Custom, { phase: 'lobby' | 'back' | 'seated' }> // on its way, the list, or why there's none

interface LobbiesProps {
  custom: Listing
  active: boolean // the keys are here
  onBack: () => void // Esc: back to the modes
  onRetry: () => void
}

type Filter<T> = T | 'any'
const full = (row: LobbyRow) => row.people + row.bots >= row.size
const joinable = (row: LobbyRow) => !full(row) && (row.phase === 'waiting' || row.jip)
// joinable first, then running matches that take joiners, then the rest (full, or a match that doesn't)
const rank = (row: LobbyRow) => (joinable(row) ? (row.phase === 'waiting' ? 0 : 1) : 2)
const keycap = 'rounded border border-neutral-500/50 px-1.5 py-0.5'

// The custom lobbies (mockups 1 and 2): search, refresh and Create lobby
// over filters and the rows, in four states kept apart — loading (skeleton
// rows, never "no lobbies"), an error (Retry), none yet (the invitation to
// make one), the rows. A row: the arena's picture, name and host (a lock:
// a password), mode, arena, players, the time (a running match's time
// left), ping, and Join / Full / In match. A locked row asks for the
// password first; a code (from an invite) joins without one. The server
// has the last word on every join: its no comes back as a note. Keys: ↑↓
// rows, Enter joins, C creates, / searches, Esc goes back to the modes.
export function Lobbies({ custom, active, onBack, onRetry }: LobbiesProps) {
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<Filter<Mode>>('any')
  const [map, setMap] = useState<Filter<MapId>>('any')
  const [open, setOpen] = useState(false) // players: only lobbies with open slots
  const [focused, setFocused] = useState(0)
  const [creating, setCreating] = useState(false)
  const [locked, setLocked] = useState<LobbyRow | null>(null) // asking for its password
  const [joining, setJoining] = useState('') // the lobby id asked for, or 'code'
  const [code, setCode] = useState('')
  const [host, setHost] = useState('Player')
  const searchField = useRef<HTMLInputElement>(null)
  const browsing = custom.phase === 'browsing' ? custom : null
  const list = browsing?.list ?? null
  const now = useClock(!!list?.some((row) => row.phase === 'playing'))
  const asked = browsing?.asked ?? ''
  const note = browsing && !browsing.asked ? browsing.note : ''

  useEffect(() => {
    void player().then(
      (p) => setHost(p.name),
      () => {},
    )
  }, [])

  const words = search.trim().toLowerCase()
  const rows = (list ?? [])
    .filter(
      (row) =>
        (mode === 'any' || row.mode === mode) &&
        (map === 'any' || row.map === map) &&
        (!open || !full(row)) &&
        (!words || row.name.toLowerCase().includes(words) || row.host.toLowerCase().includes(words)),
    )
    .sort((a, b) => rank(a) - rank(b))
  const at = Math.min(focused, Math.max(0, rows.length - 1))

  function join(row: LobbyRow) {
    if (!joinable(row) || asked) return
    if (row.locked) return setLocked(row)
    setJoining(row.id)
    ask({ t: 'lb', do: 'join', id: row.id, password: '' })
  }
  function joinByCode() {
    const typed = readCode(code)
    if (!INVITE.test(typed) || asked) return
    setJoining('code')
    ask({ t: 'lb', do: 'code', code: typed })
  }

  useEffect(() => {
    if (!active || creating || locked) return // the drawer and the dialog take the keys
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) {
        if (e.key === 'Escape') e.target.blur()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowDown') setFocused(Math.min(at + 1, rows.length - 1))
      else if (e.key === 'ArrowUp') setFocused(Math.max(at - 1, 0))
      else if (e.key === 'Enter' && rows[at]) join(rows[at])
      else if (e.code === 'KeyC' && browsing) setCreating(true)
      else if (e.key === '/') searchField.current?.focus()
      else if (e.key === 'Escape') onBack()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-end justify-between gap-6">
        <div>
          <h2 className="m-0 font-display text-4xl font-semibold">Custom lobbies</h2>
          <p className="mt-1 font-display text-base text-neutral-300 italic">Find a lobby, or make your own and invite people.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={searchField}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lobbies or hosts  /"
            aria-label="Search lobbies or hosts"
            className={`w-56 ${FIELD}`}
          />
          <button
            onClick={() => ask({ t: 'lb', do: 'watch' })}
            disabled={!browsing || asked === 'watch'}
            aria-label="Refresh"
            title="Refresh"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-white/15 bg-black/45 text-neutral-300 hover:text-white disabled:opacity-50"
          >
            <svg
              viewBox="0 0 16 16"
              className={`h-4 w-4 ${asked === 'watch' || !list ? 'animate-spin motion-reduce:animate-none' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
            </svg>
          </button>
          <button onClick={() => setCreating(true)} disabled={!browsing} className={PRIMARY}>
            + Create lobby
          </button>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="Mode"
          options={[{ id: 'any' as Filter<Mode>, label: 'All modes' }, ...MODE_IDS.map((id) => ({ id: id as Filter<Mode>, label: id.toUpperCase() }))]}
          value={mode}
          onChange={setMode}
        />
        <Segmented
          label="Arena"
          options={[
            { id: 'any' as Filter<MapId>, label: 'All arenas' },
            ...(Object.keys(MAPS) as MapId[]).map((id) => ({ id: id as Filter<MapId>, label: MAPS[id].name })),
          ]}
          value={map}
          onChange={setMap}
        />
        <Segmented
          label="Players"
          options={[
            { id: false, label: 'Any' },
            { id: true, label: 'Open slots' },
          ]}
          value={open}
          onChange={setOpen}
        />
      </div>

      <div
        role="table"
        aria-label="Custom lobbies"
        className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border border-white/10 bg-black/55 backdrop-blur-md"
      >
        <div role="row" className={`${GRID} border-b border-white/10 py-2 text-[0.6rem] font-bold tracking-[0.25em] text-neutral-400 uppercase`}>
          <span role="columnheader">Lobby</span>
          <span role="columnheader">Mode</span>
          <span role="columnheader">Arena</span>
          <span role="columnheader">Players</span>
          <span role="columnheader">Time</span>
          <span role="columnheader">Ping</span>
          <span role="columnheader" className="sr-only">
            Join
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {custom.phase === 'off' && custom.error ? (
            <Empty title="Unable to load lobbies" line={custom.error}>
              <button onClick={onRetry} className={PRIMARY}>
                Retry
              </button>
            </Empty>
          ) : !list ? (
            Array.from({ length: 4 }, (_, i) => (
              <div key={i} aria-hidden="true" className={`${GRID} border-b border-white/5 py-3`}>
                <span className="flex items-center gap-3">
                  <span className="h-9 w-16 animate-pulse rounded-sm bg-white/10 motion-reduce:animate-none" />
                  <span className="h-3 w-40 animate-pulse rounded-sm bg-white/10 motion-reduce:animate-none" />
                </span>
                {Array.from({ length: 5 }, (_, j) => (
                  <span key={j} className="h-3 w-10 animate-pulse rounded-sm bg-white/10 motion-reduce:animate-none" />
                ))}
              </div>
            ))
          ) : !list.length ? (
            <Empty title="No lobbies yet" line="Be the first: make a lobby, then invite people or wait for them to find it.">
              <button onClick={() => setCreating(true)} className={PRIMARY}>
                + Create lobby
              </button>
            </Empty>
          ) : !rows.length ? (
            <Empty title="No lobby matches" line="Nothing here with these filters.">
              <button
                onClick={() => {
                  setSearch('')
                  setMode('any')
                  setMap('any')
                  setOpen(false)
                }}
                className={SECONDARY}
              >
                Clear filters
              </button>
            </Empty>
          ) : (
            rows.map((row, i) => {
              const left = row.left - (now - (browsing?.at ?? now)) / 1000
              const wait = asked === 'join' && joining === row.id
              return (
                <div
                  key={row.id}
                  role="row"
                  aria-selected={active && i === at}
                  onMouseEnter={() => setFocused(i)}
                  onDoubleClick={() => join(row)}
                  className={`${GRID} relative border-b border-white/5 py-2.5 transition-colors ${active && i === at ? 'bg-white/[0.07]' : 'hover:bg-white/4'} ${joinable(row) ? '' : 'text-neutral-400'}`}
                >
                  {active && i === at && <span className="absolute inset-y-0 left-0 w-0.5 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />}
                  <span role="cell" className="flex min-w-0 items-center gap-3">
                    <img src={MAPS[row.map as MapId]?.image} alt="" className="h-9 w-16 shrink-0 rounded-sm object-cover" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm font-bold text-[#f2ece0]">
                        {row.locked && <Lock />}
                        <span className="truncate">{row.name}</span>
                      </span>
                      <span className="block truncate font-display text-xs text-neutral-400 italic">Host: {row.host}</span>
                    </span>
                  </span>
                  <span role="cell" className="text-xs font-bold tracking-[0.15em]" title={MODES[row.mode as Mode]?.label}>
                    {row.mode.toUpperCase()}
                  </span>
                  <span role="cell" className="truncate text-sm">
                    {MAPS[row.map as MapId]?.name ?? row.map}
                  </span>
                  <span role="cell" className="text-sm tabular-nums">
                    {row.people + row.bots} / {row.size}
                  </span>
                  <span role="cell" className="text-sm tabular-nums">
                    {row.phase === 'playing' ? `${waited(Math.max(0, left) * 1000)} left` : minutes(row.duration)}
                  </span>
                  <span role="cell" className="text-sm text-neutral-400 tabular-nums">
                    {browsing?.rtt ? `${Math.round(browsing.rtt)} ms` : '—'}
                  </span>
                  <span role="cell" className="text-right">
                    <button
                      onClick={() => join(row)}
                      disabled={!joinable(row) || !!asked}
                      className={`w-24 rounded border py-1.5 text-xs font-bold tracking-[0.15em] uppercase ${joinable(row) ? 'border-red-500 bg-red-500/20 text-white hover:bg-red-500/35' : 'border-white/10 text-neutral-500'} disabled:cursor-not-allowed`}
                    >
                      {wait ? 'Joining…' : joinable(row) ? 'Join' : full(row) ? 'Full' : 'In match'}
                    </button>
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            joinByCode()
          }}
          className="flex items-center gap-2"
        >
          <span className="text-[0.65rem] font-bold tracking-[0.3em] text-neutral-300 uppercase">Join by code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={LIMITS.code + 4}
            placeholder="ABCD-EFGH"
            aria-label="Invite code"
            className={`w-32 font-mono tracking-[0.15em] uppercase ${FIELD}`}
          />
          <button type="submit" disabled={!INVITE.test(readCode(code)) || !!asked} className={SECONDARY}>
            {asked === 'code' ? 'Joining…' : 'Join'}
          </button>
        </form>
        {note && !locked && (
          <p role="alert" className="ml-auto font-display text-sm text-red-300 italic">
            {note}
          </p>
        )}
      </div>

      {creating && <LobbyForm lobby={null} host={host} asked={asked === 'create'} onClose={() => setCreating(false)} />}
      {locked && <Password row={locked} asked={asked === 'join'} onCancel={() => setLocked(null)} />}

      {active && !creating && !locked && (
        <div className="fixed bottom-8 left-[6vw] flex items-center gap-4 font-sans text-xs tracking-widest text-neutral-400 uppercase">
          <span className={keycap}>&uarr;&darr;</span>
          <span>Lobby</span>
          <span className={keycap}>Enter</span>
          <span>Join</span>
          <span className={keycap}>C</span>
          <span>Create</span>
          <span className={keycap}>/</span>
          <span>Search</span>
          <span className={keycap}>Esc</span>
          <span>Modes</span>
        </div>
      )}
    </div>
  )
}

const GRID = 'grid grid-cols-[minmax(0,1fr)_3.5rem_6.5rem_4.5rem_5.5rem_3.5rem_6.5rem] items-center gap-3 px-4'
const FIELD = 'h-9 rounded-md border border-white/15 bg-black/45 px-3 text-sm text-[#f2ece0] outline-hidden placeholder:text-neutral-500 focus:border-red-500'
const PRIMARY =
  'rounded border-2 border-red-500 bg-black/55 px-4 py-2 text-xs font-bold tracking-[0.15em] whitespace-nowrap text-white uppercase shadow-[0_0_18px_rgba(239,68,68,0.45)] hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-50'
const SECONDARY =
  'rounded border border-white/25 bg-black/55 px-4 py-2 text-xs font-bold tracking-[0.15em] whitespace-nowrap text-white uppercase hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-50'

function Empty({ title, line, children }: { title: string; line: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <p className="text-sm font-bold tracking-[0.3em] text-neutral-200 uppercase">{title}</p>
      <p className="mt-2 max-w-sm font-display text-base text-neutral-400 italic">{line}</p>
      <div className="mt-6">{children}</div>
    </div>
  )
}

export function Lock({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-label="Password" className={`shrink-0 text-amber-300 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  )
}

// A locked lobby from the list: its password, then the server's word (a wrong one says so here).
function Password({ row, asked, onCancel }: { row: LobbyRow; asked: boolean; onCancel: () => void }) {
  const [password, setPassword] = useState('')
  const [refused, setRefused] = useState('') // the server's no (a yes lands in the waiting room)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => field.current?.focus(), [])
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])
  async function submit() {
    if (!password || asked) return
    setRefused('')
    setRefused(await ask({ t: 'lb', do: 'join', id: row.id, password }))
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="password-title"
      onClick={onCancel}
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 text-[#f2ece0]"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="w-[min(90vw,420px)] border border-white/10 bg-[#12161f] px-9 py-8 shadow-[0_24px_70px_rgba(0,0,0,0.65)]"
      >
        <p className="text-xs font-bold tracking-[0.3em] text-red-400/90 uppercase">Join lobby</p>
        <h2 id="password-title" className="m-0 mt-1 truncate font-display text-3xl font-semibold">
          {row.name}
        </h2>
        <p className="mt-2 font-display text-base text-neutral-300 italic">This lobby asks for a password.</p>
        <input
          ref={field}
          type="password"
          value={password}
          maxLength={LIMITS.password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
          autoComplete="off"
          className={`mt-5 w-full ${FIELD}`}
        />
        {refused && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {refused}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className={SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={!password || asked} className={PRIMARY}>
            {asked ? 'Joining…' : 'Join'}
          </button>
        </div>
      </form>
    </div>
  )
}
