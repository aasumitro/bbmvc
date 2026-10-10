import type { ReactNode } from 'react'
import type { Match } from '../../runtime/match.ts'
import { Crown, ResultsFrame, Standings, StandingsRow } from '../../screens/ResultsFrame.tsx'
import { number, plural, type Verdict } from '../../screens/resultsFormat.ts'
import type { FreeForAll } from './rules.ts'

// Free for all's results: the player's placing, the full record (items,
// the nemesis), the final placings with medals and the winner's crown.

const MEDALS = ['bg-amber-300', 'bg-neutral-300', 'bg-orange-400/80'] // diamonds for 1st, 2nd, 3rd
const suffix = (n: number) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th') // places up to FFA.grid

export function ResultsPanel({ match, children }: { match: Match; children: ReactNode }) {
  const { mode, player, combatants } = match
  if (mode.kind !== 'ffa') return null
  const ffa = mode.rules
  const s = player.stats
  const nemesis = ffa.nemesisOf(player.id)
  const details: Array<[string, string]> = [
    ['K/D', (s.kills / Math.max(1, s.deaths)).toFixed(2)],
    ['Multi-kills', String(s.multiKills)],
    ['Revenge kills', String(s.revengeKills)],
    ['Items collected', String(s.itemsCollected)],
    ['Damage taken', number(s.damageTaken)],
    ['Nemesis', nemesis < 0 ? '—' : combatants[nemesis].name],
  ]
  return (
    <ResultsFrame
      match={match}
      verdict={verdict(match, ffa)}
      details={details}
      standings={
        <Standings teamKills={false}>
          {ffa.standings().map((id, k) => {
            const place = ffa.place(id)
            return (
              <StandingsRow
                key={id}
                match={match}
                c={combatants[id]}
                place={place}
                step={3 + k}
                teamKills={false}
                medal={place <= 3 ? MEDALS[place - 1] : undefined}
                mark={ffa.winner === id && <Crown />}
              />
            )
          })}
        </Standings>
      }
    >
      {children}
    </ResultsFrame>
  )
}

function verdict({ player }: Match, ffa: FreeForAll): Verdict {
  const record = `${plural(player.stats.kills, 'kill')} · ${plural(player.stats.deaths, 'death')}`
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
