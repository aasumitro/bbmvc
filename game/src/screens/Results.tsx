import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { playSound } from '../game/audio'
import { MAPS } from '../game/maps'
import type { Match } from '../game/match'
import { MODES } from '../game/modes'
import type { Combatant } from '../game/simulation'
import { TEAMS } from '../game/tdm/config'
import type { LobbyView } from '../net/protocol'
import { Tally } from './Lobby'
import { Menu } from './Menu'

// End of a match: the result and the player's record on the left, everyone's
// standing on the right, then Play again / Exit to garage (arrows or W A S D,
// Enter) — online, the countdown to the room's next match and Back to
// garage instead; a custom lobby's match, the countdown back to its waiting
// room, Back to lobby, and the lobby's tally with this result in it. Free
// for all gets the full record; team deathmatch the team score, the MVP and
// both rosters. Sections rise in one after another.

interface ResultsProps {
  match: Match
  lobby?: LobbyView | null // a custom lobby's match: its lobby
  onPlayAgain: () => void
  onExit: () => void
}

type Tone = 'win' | 'loss' | 'draw'

const TONES: Record<Tone, { title: string; badge: string; line: string; glow: string }> = {
  win: { title: 'text-[#f7e7c1]', badge: 'text-amber-300', line: 'from-amber-300/80', glow: 'rgba(245, 158, 11, 0.2)' },
  loss: { title: 'text-red-500', badge: 'text-red-400', line: 'from-red-500/80', glow: 'rgba(220, 38, 38, 0.24)' },
  draw: { title: 'text-neutral-100', badge: 'text-sky-200', line: 'from-sky-200/70', glow: 'rgba(148, 163, 184, 0.18)' },
}
const MEDALS = ['bg-amber-300', 'bg-neutral-300', 'bg-orange-400/80'] // diamonds for 1st, 2nd, 3rd
const CROWN = (
  <svg viewBox="0 0 16 10" className="mb-0.5 ml-2 inline-block h-2.5 w-4 fill-amber-300">
    <path d="M1 10h14l1-8-4.5 3.2L8 0 4.5 5.2 0 2z" />
  </svg>
)

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const suffix = (n: number) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th') // places up to FFA.grid
const number = (n: number) => Math.round(n).toLocaleString('en-US')
const rise = (step: number) => ({ animationDelay: `${step * 70}ms` }) // stagger for animate-rise
// The running mode's own rules, for its panels.
const rulesOf = ({ mode }: Match) => ({ ffa: mode.kind === 'ffa' ? mode.rules : null, tdm: mode.kind === 'tdm' ? mode.rules : null })

// The headline for the player: title, tone, one line of record, the badge and a note (overtime).
function verdict(match: Match): { tone: Tone; title: string; line: string; badge: ReactNode; badgeLabel: string; note?: string } {
  const { player } = match
  const { ffa, tdm } = rulesOf(match)
  const record = `${plural(player.stats.kills, 'kill')} · ${plural(player.stats.deaths, 'death')}`
  if (ffa) {
    const place = ffa.place(player.id)
    const tied = ffa.draw && place === 1 // a draw only for those tied at the top
    const won = ffa.winner === player.id
    return {
      tone: won ? 'win' : tied ? 'draw' : 'loss',
      title: won ? 'Victory' : tied ? 'Draw' : 'Defeat',
      line: tied ? `${record} · tied for first` : record,
      badge: (
        <>
          {place}
          <span className="align-super text-[0.4em]">{suffix(place)}</span>
        </>
      ),
      badgeLabel: `of ${ffa.standings().length} machines`, // those in play
    }
  }
  const tone: Tone = !tdm || tdm.draw ? 'draw' : tdm.winner === player.team ? 'win' : 'loss'
  return {
    tone,
    title: tone === 'win' ? 'Victory' : tone === 'draw' ? 'Draw' : 'Defeat',
    line: `${record} · ${plural(player.stats.assists, 'assist')}`,
    badge: `${tdm?.score[0] ?? 0} : ${tdm?.score[1] ?? 0}`,
    badgeLabel: `${TEAMS[0]} · ${TEAMS[1]}`,
    note: tdm && tdm.overtimeAt >= 0 ? 'Overtime' : undefined,
  }
}

// The tally's key this match's result adds a win to (server/custom.ts): the side, the winner's user id or bot slot; none for a draw.
function winnerKey(match: Match, lobby: LobbyView) {
  const { ffa, tdm } = rulesOf(match)
  if (tdm) return tdm.draw ? undefined : String(tdm.winner)
  if (!ffa || ffa.draw || ffa.winner < 0) return undefined
  const slot = lobby.slots[ffa.winner]
  return slot?.kind === 'person' ? slot.uid : slot?.kind === 'bot' ? `bot:${ffa.winner}` : undefined
}

export function Results({ match, lobby, onPlayAgain, onExit }: ResultsProps) {
  const { tone, title, line, badge, badgeLabel, note } = verdict(match)
  const colors = TONES[tone]
  return (
    <section
      aria-labelledby="results-title"
      className="fixed inset-0 z-10 overflow-y-auto bg-[#0b0908]/85 text-[#f2ece0]"
      style={{ backgroundImage: `radial-gradient(70% 45% at 50% 0%, ${colors.glow}, transparent 70%)` }}
    >
      <div className="mx-auto flex min-h-full max-w-[1120px] flex-col justify-center gap-6 px-[6vw] py-10">
        <header className="flex animate-rise items-end justify-between gap-8 motion-reduce:animate-none">
          <div>
            <p className="text-xs font-bold tracking-[0.3em] text-red-400/90 uppercase">
              Match complete · {MODES[match.mode.kind].label} · {MAPS[match.map].name}
            </p>
            <h1 id="results-title" className={`m-0 mt-2 font-display text-6xl font-semibold tracking-[0.02em] md:text-7xl ${colors.title}`} style={{ textShadow: `0 0 40px ${colors.glow}` }}>
              {title}
            </h1>
            {note && <p className={`mt-1 text-xs font-extrabold tracking-[0.4em] uppercase ${colors.badge}`}>{note}</p>}
            <p className="mt-2 font-display text-lg text-neutral-300 italic">{line}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className={`font-display text-6xl leading-none font-semibold tabular-nums md:text-7xl ${colors.badge}`}>{badge}</p>
            <p className="mt-2 text-[0.65rem] font-bold tracking-[0.3em] text-neutral-400 uppercase">{badgeLabel}</p>
          </div>
        </header>
        <div className={`h-px animate-rise bg-gradient-to-r ${colors.line} via-white/10 to-transparent motion-reduce:animate-none`} style={rise(1)} />

        <div className="grid items-start gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="flex flex-col gap-5">
            {match.mode.kind === 'tdm' && <Mvp match={match} />}
            <Record match={match} />
            {lobby && (
              <div className="animate-rise border border-white/10 bg-white/[0.03] px-4 py-3 motion-reduce:animate-none" style={rise(8)}>
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
          </div>
          <Standings match={match} />
        </div>
      </div>
    </section>
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

function Tile({ label, value, hot, step }: { label: string; value: ReactNode; hot?: boolean; step: number }) {
  return (
    <div className={`animate-rise border px-4 py-3 motion-reduce:animate-none ${hot ? 'border-red-500/40 bg-red-500/[0.08]' : 'border-white/10 bg-white/[0.03]'}`} style={rise(step)}>
      <p className="font-display text-3xl leading-none font-semibold tabular-nums">{value}</p>
      <p className="mt-2 text-[0.6rem] font-bold tracking-[0.25em] text-neutral-400 uppercase">{label}</p>
    </div>
  )
}

// Team deathmatch: the machine with the best combat score, whichever team it drove for.
function Mvp({ match }: { match: Match }) {
  const { player, combatants } = match
  const { tdm } = rulesOf(match)
  const mvp = tdm && combatants[tdm.mvp]
  if (!mvp) return null
  const s = mvp.stats
  return (
    <div className="animate-rise border border-amber-300/40 bg-amber-300/[0.06] px-4 py-3 motion-reduce:animate-none" style={rise(2)}>
      <p className="text-[0.6rem] font-bold tracking-[0.3em] text-amber-300 uppercase">MVP</p>
      <div className="mt-1 flex items-baseline justify-between gap-4">
        <p className="font-display text-3xl leading-none font-semibold">
          {mvp === player ? 'You' : mvp.name}
          <span className={`ml-3 text-[0.6rem] font-bold tracking-[0.25em] uppercase ${mvp.team === player.team ? 'text-sky-300' : 'text-red-400'}`}>{TEAMS[mvp.team]}</span>
        </p>
        <p className="text-right text-[0.6rem] font-bold tracking-[0.25em] text-neutral-400 uppercase">
          Combat score <span className="ml-1 font-display text-2xl tracking-normal text-[#f2ece0] tabular-nums">{number(s.combatScore)}</span>
        </p>
      </div>
      <p className="mt-2 text-xs font-bold tracking-[0.16em] text-neutral-400 uppercase tabular-nums">
        {plural(s.kills, 'kill')} · {plural(s.deaths, 'death')} · {plural(s.assists, 'assist')} · {number(s.damageDealt)} damage
      </p>
    </div>
  )
}

// The player's numbers: big tiles, and the finer print under them.
function Record({ match }: { match: Match }) {
  const { player, combatants } = match
  const { ffa } = rulesOf(match)
  const s = player.stats
  const ratio = (s.kills / Math.max(1, s.deaths)).toFixed(2)
  const tiles: Array<[string, ReactNode, boolean?]> = [['Kills', s.kills, true], ['Deaths', s.deaths], ['Assists', s.assists], ['Damage', number(s.damageDealt)], ['Score', number(s.combatScore)], ['Best streak', s.bestStreak]]
  const nemesis = ffa ? ffa.nemesisOf(player.id) : -1
  const details: Array<[string, string]> = ffa
    ? [
        ['K/D', ratio],
        ['Multi-kills', String(s.multiKills)],
        ['Revenge kills', String(s.revengeKills)],
        ['Items collected', String(s.itemsCollected)],
        ['Damage taken', number(s.damageTaken)],
        ['Nemesis', nemesis < 0 ? '—' : combatants[nemesis].name],
      ]
    : [
        ['K/D', ratio],
        ['Multi-kills', String(s.multiKills)],
        ['Revenge kills', String(s.revengeKills)],
        ['Damage taken', number(s.damageTaken)],
      ]
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(([label, value, hot], i) => (
          <Tile key={label} label={label} value={value} hot={hot} step={2 + i} />
        ))}
      </div>
      <dl className="grid animate-rise grid-cols-2 gap-x-8 gap-y-1.5 text-xs font-bold tracking-[0.16em] uppercase tabular-nums motion-reduce:animate-none" style={rise(2 + tiles.length)}>
        {details.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-white/5 py-1">
            <dt className="text-neutral-400">{label}</dt>
            <dd className="text-[#f2ece0]">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

// Everyone's standing. Free for all: final placings with medals and the
// winner's crown; team deathmatch: each team's roster under its score,
// ranked by combat score, with the MVP crowned.
function Standings({ match }: { match: Match }) {
  const { player, combatants } = match
  const { ffa, tdm } = rulesOf(match)
  const cell = 'px-2 py-2 text-right'
  const teamKills = !!tdm?.settings.friendlyFire // information, never a score
  const row = (c: Combatant, place: number, step: number) => (
    <tr key={c.id} className={`animate-rise border-t border-white/5 motion-reduce:animate-none ${c === player ? 'bg-red-500/10 text-red-300' : 'text-neutral-300'}`} style={rise(step)}>
      <td className="py-2 pr-2 pl-4 text-neutral-500">{place}</td>
      <td className="py-2 whitespace-nowrap">
        <span className={`mr-2.5 mb-0.5 inline-block h-2 w-2 rotate-45 ${ffa && place <= 3 ? MEDALS[place - 1] : c === player ? 'bg-[#f2ece0]' : c.team === player.team ? 'bg-sky-300' : 'bg-red-500'}`} />
        {c === player ? 'You' : c.name}
        {ffa && ffa.winner === c.id && CROWN}
        {tdm?.mvp === c.id && (
          <>
            {CROWN}
            <span className="ml-1.5 text-[0.55rem] tracking-[0.2em] text-amber-300">MVP</span>
          </>
        )}
      </td>
      <td className={`${cell} font-extrabold text-[#f2ece0]`}>{c.stats.kills}</td>
      <td className={cell}>{c.stats.deaths}</td>
      <td className={cell}>{c.stats.assists}</td>
      <td className={cell}>{number(c.stats.damageDealt)}</td>
      <td className={`${cell} pr-4`}>{number(c.stats.combatScore)}</td>
      {teamKills && <td className={`${cell} pr-4`}>{c.stats.teamKills}</td>}
    </tr>
  )
  const teams = [player.team, 1 - player.team]
  return (
    <div className="animate-rise border border-white/10 bg-black/30 motion-reduce:animate-none" style={rise(2)}>
      <p className="border-b border-white/10 px-4 py-3 text-xs font-bold tracking-[0.25em] text-neutral-400 uppercase">Final standings</p>
      <table className="w-full text-xs font-bold tracking-[0.12em] uppercase tabular-nums">
        <thead className="text-[0.6rem] text-neutral-500">
          <tr>
            <th className="w-8 py-2 pr-2 pl-4 text-left font-bold">#</th>
            <th className="py-2 text-left font-bold">Machine</th>
            <th className={`${cell} font-bold`}>K</th>
            <th className={`${cell} font-bold`}>D</th>
            <th className={`${cell} font-bold`}>A</th>
            <th className={`${cell} font-bold`}>Damage</th>
            <th className={`${cell} pr-4 font-bold`}>Score</th>
            {teamKills && <th className={`${cell} pr-4 font-bold`}>TK</th>}
          </tr>
        </thead>
        <tbody>
          {ffa
            ? ffa.standings().map((id, k) => row(combatants[id], ffa.place(id), 3 + k))
            : tdm &&
              teams.map((team, g) => (
                <Fragment key={team}>
                  <tr className="border-t border-white/10">
                    <td colSpan={teamKills ? 8 : 7} className={`px-4 pt-3 pb-1 text-[0.6rem] tracking-[0.25em] ${g ? 'text-red-400' : 'text-sky-300'}`}>
                      {TEAMS[team]} · {plural(tdm.score[team], 'kill')}
                      {tdm.winner === team && <span className="ml-3 text-amber-300">Winner</span>}
                    </td>
                  </tr>
                  {tdm
                    .standings()
                    .filter((id) => combatants[id].team === team)
                    .map((id, k) => row(combatants[id], k + 1, 3 + g * 5 + k))}
                </Fragment>
              ))}
        </tbody>
      </table>
    </div>
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
      <p className="mt-5 flex items-center gap-3 text-[0.65rem] tracking-[0.1em] text-neutral-500 uppercase">
        <span className="rounded border border-neutral-500/50 px-1.5 py-0.5">&larr;&rarr;</span>
        Choose
        <span className="rounded border border-neutral-500/50 px-1.5 py-0.5">Enter</span>
        Select
      </p>
    </div>
  )
}
