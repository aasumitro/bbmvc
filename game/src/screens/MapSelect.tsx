import { useEffect, useState } from 'react'
import { DIFFICULTIES, type Difficulty } from '../sim/difficulty.ts'
import { MENU_BACKDROP } from '../runtime/loading.ts'
import type { Loadout } from '../sim/loadout.ts'
import { MAPS, mapsFor, type MapId } from '../content/arenas/maps.ts'
import { MODES } from '../modes/modes.ts'
import { MODE_IDS, type Mode } from '../modes/ids.ts'
import { cancelSearch } from '../net/matchmaking.ts'
import { Robot } from './Avatar.tsx'
import { Custom } from './lobbies/Custom.tsx'
import { ActionButton, Menu, Pager, Segmented, type MenuItem } from './Menu.tsx'
import { useClock, useCustom, useSearch, waited } from './hooks.ts'

export interface Pick {
  mode: Mode
  map: MapId
  difficulty: Difficulty // the bots' in practice (online they're Normal)
  online: boolean // Classic: find a match on the game server
}

interface MapSelectProps {
  pick: Pick // the last choice, shown first
  loadout: Loadout // a custom lobby's seat is fitted with it
  onStart: (pick: Pick) => void // practice against bots, or Find Match (Classic)
  onBack: () => void
}

const DIFFICULTY_IDS = Object.keys(DIFFICULTIES) as Difficulty[]
const NAV_ITEMS: MenuItem[] = [...MODE_IDS.map((mode) => ({ label: MODES[mode].label })), { label: 'Custom' }, { label: 'Back' }]
const CUSTOM = MODE_IDS.length
const BACK = NAV_ITEMS.length - 1
// the entry ↑ (-1) or ↓ (1) lands on, round the ends, over the disabled ones
function step(from: number, by: number) {
  let i = from
  do i = (i + by + NAV_ITEMS.length) % NAV_ITEMS.length
  while (NAV_ITEMS[i].disabled)
  return i
}
const ROWS = ['arena', 'bots', 'play'] as const // the mode's own choices, top to bottom
const two = (n: number) => String(n).padStart(2, '0')
const keycap = 'rounded border border-neutral-500/50 px-1.5 py-0.5'
// beside the choice the keys are on, as the menus mark theirs
const mark = <span className="absolute top-1/2 -left-5 h-7 w-0.5 -translate-y-1/2 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />

const globe = (
  <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="16" cy="16" r="12" />
    <ellipse cx="16" cy="16" rx="5.5" ry="12" />
    <path d="M4 16h24M6 9.5h20M6 22.5h20" />
  </svg>
)

// Modes on the left, then Custom (custom lobbies: Custom.tsx, which takes
// the keys once opened, and opens by itself while the player is in a
// lobby). On the right, while a mode is
// highlighted: the arena, how good the practice bots are, then how to play
// it — Practice against bots, or Classic: Find Match, and the game server
// finds people to play this mode on this arena with (net/matchmaking.ts),
// and bots on Normal take the seats nobody has. A search
// runs on while the player waits here, practises, or goes anywhere else
// (Matchmaking.tsx shows it there); here Classic says how long it's been and
// cancels it. Then the mode's terms. From the keyboard, two steps:
// ↑↓ choose the mode and Enter (or →) opens it; then ↑↓ move between the
// arena, the bots and Practice / Classic, ←→ change the one chosen, Enter
// goes down a row and on the last starts the match; Esc (or ↑ from the
// arena) goes back to the modes. The mouse works too.
export function MapSelect({ pick, loadout, onStart, onBack }: MapSelectProps) {
  const customStore = useCustom()
  const lobby = customStore.phase !== 'off' // in a custom lobby: its waiting room first, or coming back/joining, and no Classic search
  const [selected, setSelected] = useState(lobby ? CUSTOM : MODE_IDS.indexOf(pick.mode))
  // the arena chosen for each mode, starting from the last pick where it hosts that mode
  const [difficulty, setDifficulty] = useState(pick.difficulty)
  const [online, setOnline] = useState(pick.online) // what Enter starts: Classic, or Practice
  const [row, setRow] = useState(lobby ? 0 : -1) // the choice the keys change: -1 the mode list, else a ROWS index (Custom: its own)
  const [maps, setMaps] = useState(
    () => Object.fromEntries(MODE_IDS.map((mode) => [mode, mapsFor(mode).includes(pick.map) ? pick.map : mapsFor(mode)[0]])) as Record<Mode, MapId>,
  )
  const mode = MODE_IDS[selected] ?? MODE_IDS[0] // on Custom and Back the mode's side isn't shown: any mode will do
  const { label, tags, blurb } = MODES[mode]
  const map = maps[mode]
  const choices = mapsFor(mode)
  const place = choices.indexOf(map)

  const search = useSearch()
  const searching = search.phase === 'connecting' || search.phase === 'searching'
  const now = useClock(searching)
  const practice = () => onStart({ mode, map, difficulty, online: false })
  function classic() {
    setOnline(true)
    if (searching) cancelSearch()
    else if (search.phase === 'idle' && !lobby) onStart({ mode, map, difficulty, online: true })
  }
  const cycle = (step: number) => setMaps({ ...maps, [mode]: choices[(place + step + choices.length) % choices.length] })
  const bots = (step: number) => setDifficulty(DIFFICULTY_IDS[(DIFFICULTY_IDS.indexOf(difficulty) + step + DIFFICULTY_IDS.length) % DIFFICULTY_IDS.length])
  const focus = row < 0 ? null : ROWS[row]

  useEffect(() => {
    // the mode list: pick one and open it
    function onModes(key: string) {
      if (key === 'ArrowDown') setSelected(step(selected, 1))
      if (key === 'ArrowUp') setSelected(step(selected, -1))
      if (key === 'Enter' || key === 'ArrowRight') {
        if (selected === BACK) return key === 'Enter' && onBack()
        setRow(0)
      }
      if (key === 'Escape') onBack()
    }
    // inside a mode: move between its choices, change them, start
    function onChoices(key: string) {
      if (key === 'ArrowUp') setRow(row - 1) // from the arena, back to the modes
      if (key === 'ArrowDown') setRow(Math.min(row + 1, ROWS.length - 1))
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const step = key === 'ArrowLeft' ? -1 : 1
        if (focus === 'arena') cycle(step)
        if (focus === 'bots') bots(step)
        if (focus === 'play') setOnline(step > 0)
      }
      if (key === 'Enter') {
        if (focus !== 'play') setRow(row + 1)
        else (online ? classic : practice)()
      }
      if (key === 'Escape') setRow(-1)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (selected === CUSTOM && row >= 0) return // Custom's keys
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(e.key)) return
      e.preventDefault() // no second press through a focused button, no page scroll
      if (row < 0) onModes(e.key)
      else onChoices(e.key)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div
      className="fixed inset-0 bg-cover bg-center text-[#f2ece0] before:absolute before:inset-0 before:bg-black/60 before:content-['']"
      style={{ backgroundImage: `url('${MENU_BACKDROP}')` }}
    >
      <div className="absolute top-8 left-[6vw]">
        <h1 className="m-0 font-display text-6xl font-semibold tracking-wider">Arena</h1>
        <p className="mt-1 font-display text-lg text-red-400/90 italic">Choose your fight</p>
      </div>

      <Menu
        items={NAV_ITEMS}
        selected={selected}
        onSelect={setSelected}
        onActivate={(i) => (i === BACK ? onBack() : (setSelected(i), setRow(0)))}
        className="absolute top-44 left-[6vw]"
      />

      {selected === CUSTOM && (
        // no fade in: its transform would hold Custom's drawer and dialogs inside the panel
        <div onPointerDown={() => setRow(0)} className="absolute top-8 right-[4vw] bottom-20 w-[min(64vw,1080px)]">
          <Custom loadout={loadout} active={row >= 0} onBack={() => setRow(-1)} />
        </div>
      )}
      {selected < CUSTOM && (
        <div className="absolute top-1/2 right-[5vw] w-[min(55vw,900px)] -translate-y-1/2 animate-fade motion-reduce:animate-none">
          {/* the arena: its preview fades in on a change; which one of how many above its name, one pager for both ways */}
          <div className="relative">
            {focus === 'arena' && mark}
            <div
              className={`relative aspect-1010/470 overflow-hidden rounded-sm border bg-black shadow-[0_20px_60px_rgba(0,0,0,0.6)] ${focus === 'arena' ? 'border-red-500' : 'border-white/20'}`}
            >
              <img key={map} src={MAPS[map].image} alt={MAPS[map].name} className="h-full w-full animate-fade object-cover motion-reduce:animate-none" />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-linear-to-t from-black/90 via-black/45 to-transparent px-6 pt-20 pb-5">
                <div key={map} className="animate-rise motion-reduce:animate-none">
                  <p className="text-[0.65rem] font-bold tracking-[0.3em] text-neutral-300 uppercase tabular-nums">
                    Arena <span className="text-red-400">{two(place + 1)}</span> / {two(choices.length)}
                  </p>
                  <p className="mt-1 font-display text-3xl font-semibold">{MAPS[map].name}</p>
                </div>
                {choices.length > 1 && <Pager what="arena" onStep={cycle} />}
              </div>
            </div>
          </div>

          <div className={`relative mt-4 flex items-center gap-4 transition-opacity ${online && focus !== 'bots' ? 'opacity-50' : ''}`}>
            {focus === 'bots' && mark}
            <span className="text-[0.65rem] font-bold tracking-[0.3em] text-neutral-300 uppercase">Practice bots</span>
            <Segmented
              label="Practice bot difficulty"
              options={DIFFICULTY_IDS.map((id) => ({ id, label: DIFFICULTIES[id].label }))}
              value={difficulty}
              onChange={setDifficulty}
              focused={focus === 'bots'}
            />
          </div>

          <div className="relative mt-4 grid grid-cols-2 gap-4">
            {focus === 'play' && mark}
            <ActionButton
              primary={!online}
              icon={<Robot />}
              title="Practice"
              line={`Play with ${DIFFICULTIES[difficulty].label} Bots${searching ? ' while you wait' : ''}`}
              onClick={practice}
            />
            <ActionButton
              primary={online}
              icon={globe}
              title={searching ? 'Cancel search' : 'Classic'}
              line={
                search.phase === 'connecting'
                  ? 'Connecting…'
                  : search.phase === 'searching'
                    ? `${search.away ? 'Reconnecting…' : `Finding players · ${waited(Math.max(0, now - search.since))}`}${search.mode !== mode || search.map !== map ? ` · ${MODES[search.mode as Mode]?.label ?? search.mode} · ${MAPS[search.map as MapId]?.name ?? search.map}` : ''}`
                    : search.phase !== 'idle'
                      ? 'Match found'
                      : lobby
                        ? 'You’re in a custom lobby'
                        : 'Find Match · Online'
              }
              note="Find people to play this mode on this arena online: bots on Normal take the seats nobody has. Practise while you wait"
              onClick={(search.phase === 'idle' && !lobby) || searching ? classic : undefined}
            />
          </div>

          <p className="mt-5 flex flex-wrap gap-x-3 text-[0.8rem] font-bold tracking-[0.12em] text-neutral-400 uppercase">
            <span className="text-red-500">{label}</span>
            {tags.map((tag) => (
              <span key={tag} className="flex gap-3">
                <span className="text-neutral-500">/</span>
                {tag}
              </span>
            ))}
          </p>
          <p className="mt-3 text-justify font-display text-base leading-relaxed text-neutral-200 italic">{blurb}</p>
        </div>
      )}

      <div
        className={`absolute bottom-8 left-[6vw] flex items-center gap-4 font-sans text-xs tracking-widest text-neutral-400 uppercase ${selected === CUSTOM && row >= 0 ? 'hidden' : ''}`}
      >
        {row < 0 ? (
          <>
            <span className={keycap}>&uarr;&darr;</span>
            <span>Mode</span>
            <span className={keycap}>Enter</span>
            <span>{selected === BACK ? 'Back' : 'Choose'}</span>
            <span className={keycap}>Esc</span>
            <span>Back</span>
          </>
        ) : (
          <>
            <span className={keycap}>&uarr;&darr;</span>
            <span>Move</span>
            <span className={keycap}>&larr;&rarr;</span>
            <span>{focus === 'arena' ? 'Arena' : focus === 'bots' ? 'Bots' : 'Practice / Classic'}</span>
            <span className={keycap}>Enter</span>
            <span>{focus === 'play' ? (online ? (searching ? 'Cancel search' : 'Find match') : 'Start practice') : 'Next'}</span>
            <span className={keycap}>Esc</span>
            <span>Modes</span>
          </>
        )}
      </div>
    </div>
  )
}
