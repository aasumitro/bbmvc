import type { ReactNode } from 'react'
import { MAPS } from '../content/arenas/maps.ts'
import { MODES } from '../modes/modes.ts'
import type { Match } from '../runtime/match.ts'
import type { Combatant } from '../sim/simulation.ts'
import { number, rise, type Tone, type Verdict } from './resultsFormat.ts'

// The results screen's frame, filled by the mode's results panel
// (modes/<mode>/ResultsPanel.tsx): the result and the player's record on
// the left, everyone's standing on the right; under the record, what
// Results.tsx hands in (the lobby's tally, the countdown, the buttons).
// Sections rise in one after another.

const TONES: Record<Tone, { title: string; badge: string; line: string; glow: string }> = {
  win: { title: 'text-[#f7e7c1]', badge: 'text-amber-300', line: 'from-amber-300/80', glow: 'rgba(245, 158, 11, 0.2)' },
  loss: { title: 'text-red-500', badge: 'text-red-400', line: 'from-red-500/80', glow: 'rgba(220, 38, 38, 0.24)' },
  draw: { title: 'text-neutral-100', badge: 'text-sky-200', line: 'from-sky-200/70', glow: 'rgba(148, 163, 184, 0.18)' },
}

interface FrameProps {
  match: Match
  verdict: Verdict
  lead?: ReactNode // over the record (team deathmatch: the MVP)
  details: Array<[string, string]> // the record's finer print
  standings: ReactNode
  children: ReactNode
}

export function ResultsFrame({ match, verdict, lead, details, standings, children }: FrameProps) {
  const { tone, title, line, badge, badgeLabel, note } = verdict
  const colors = TONES[tone]
  return (
    <section
      aria-labelledby="results-title"
      className="fixed inset-0 z-10 overflow-y-auto bg-[#0b0908]/85 text-[#f2ece0]"
      style={{ backgroundImage: `radial-gradient(70% 45% at 50% 0%, ${colors.glow}, transparent 70%)` }}
    >
      <div className="mx-auto flex min-h-full max-w-280 flex-col justify-center gap-6 px-[6vw] py-10">
        <header className="flex animate-rise items-end justify-between gap-8 motion-reduce:animate-none">
          <div>
            <p className="text-xs font-bold tracking-[0.3em] text-red-400/90 uppercase">
              Match complete · {MODES[match.mode.kind].label} · {MAPS[match.map].name}
            </p>
            <h1
              id="results-title"
              className={`m-0 mt-2 font-display text-6xl font-semibold tracking-[0.02em] md:text-7xl ${colors.title}`}
              style={{ textShadow: `0 0 40px ${colors.glow}` }}
            >
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
        <div className={`h-px animate-rise bg-linear-to-r ${colors.line} via-white/10 to-transparent motion-reduce:animate-none`} style={rise(1)} />

        <div className="grid items-start gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="flex flex-col gap-5">
            {lead}
            <Record match={match} details={details} />
            {children}
          </div>
          {standings}
        </div>
      </div>
    </section>
  )
}

function Tile({ label, value, hot, step }: { label: string; value: ReactNode; hot?: boolean; step: number }) {
  return (
    <div
      className={`animate-rise border px-4 py-3 motion-reduce:animate-none ${hot ? 'border-red-500/40 bg-red-500/8' : 'border-white/10 bg-white/3'}`}
      style={rise(step)}
    >
      <p className="font-display text-3xl leading-none font-semibold tabular-nums">{value}</p>
      <p className="mt-2 text-[0.6rem] font-bold tracking-[0.25em] text-neutral-400 uppercase">{label}</p>
    </div>
  )
}

// The player's numbers: big tiles, and the finer print under them (the mode's).
function Record({ match, details }: { match: Match; details: Array<[string, string]> }) {
  const s = match.player.stats
  const tiles: Array<[string, ReactNode, boolean?]> = [
    ['Kills', s.kills, true],
    ['Deaths', s.deaths],
    ['Assists', s.assists],
    ['Damage', number(s.damageDealt)],
    ['Score', number(s.combatScore)],
    ['Best streak', s.bestStreak],
  ]
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(([label, value, hot], i) => (
          <Tile key={label} label={label} value={value} hot={hot} step={2 + i} />
        ))}
      </div>
      <dl
        className="grid animate-rise grid-cols-2 gap-x-8 gap-y-1.5 text-xs font-bold tracking-[0.16em] uppercase tabular-nums motion-reduce:animate-none"
        style={rise(2 + tiles.length)}
      >
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

export function Crown() {
  return (
    <svg viewBox="0 0 16 10" className="mb-0.5 ml-2 inline-block h-2.5 w-4 fill-amber-300">
      <path d="M1 10h14l1-8-4.5 3.2L8 0 4.5 5.2 0 2z" />
    </svg>
  )
}

const cell = 'px-2 py-2 text-right'

// Everyone's standing: the mode's rows (StandingsRow, and its own headers) under one heading.
export function Standings({ teamKills, children }: { teamKills: boolean; children: ReactNode }) {
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
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

interface RowProps {
  match: Match
  c: Combatant
  place: number
  step: number
  teamKills: boolean
  medal?: string // the diamond's colour (free for all's top three); otherwise by side
  mark?: ReactNode // after the name: a crown
}

export function StandingsRow({ match: { player }, c, place, step, teamKills, medal, mark }: RowProps) {
  return (
    <tr
      className={`animate-rise border-t border-white/5 motion-reduce:animate-none ${c === player ? 'bg-red-500/10 text-red-300' : 'text-neutral-300'}`}
      style={rise(step)}
    >
      <td className="py-2 pr-2 pl-4 text-neutral-500">{place}</td>
      <td className="py-2 whitespace-nowrap">
        <span
          className={`mr-2.5 mb-0.5 inline-block h-2 w-2 rotate-45 ${medal ?? (c === player ? 'bg-[#f2ece0]' : c.team === player.team ? 'bg-sky-300' : 'bg-red-500')}`}
        />
        {c === player ? 'You' : c.name}
        {mark}
      </td>
      <td className={`${cell} font-extrabold text-[#f2ece0]`}>{c.stats.kills}</td>
      <td className={cell}>{c.stats.deaths}</td>
      <td className={cell}>{c.stats.assists}</td>
      <td className={cell}>{number(c.stats.damageDealt)}</td>
      <td className={`${cell} pr-4`}>{number(c.stats.combatScore)}</td>
      {teamKills && <td className={`${cell} pr-4`}>{c.stats.teamKills}</td>}
    </tr>
  )
}
