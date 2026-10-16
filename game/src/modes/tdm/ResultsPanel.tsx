import { Fragment, type ReactNode } from 'react'
import type { Match } from '../../runtime/match.ts'
import { Crown, ResultsFrame, Standings, StandingsRow } from '../../screens/ResultsFrame.tsx'
import { number, plural, rise, type Tone } from '../../screens/resultsFormat.ts'
import { TEAMS } from './config.ts'
import type { TeamDeathmatch } from './rules.ts'

// Team deathmatch's results: the team score (overtime noted), the MVP — the
// machine with the best combat score, whichever team it drove for — the
// record, and both rosters under their scores, ranked by combat score, the
// MVP crowned; with friendly fire, a team-kill column.

export function ResultsPanel({ match, children }: { match: Match; children: ReactNode }) {
  const { mode, player, combatants } = match
  if (mode.kind !== 'tdm') return null
  const tdm = mode.rules
  const s = player.stats
  const teamKills = tdm.settings.friendlyFire // information, never a score
  const tone: Tone = tdm.draw ? 'draw' : tdm.winner === player.team ? 'win' : 'loss'
  return (
    <ResultsFrame
      match={match}
      verdict={{
        tone,
        title: tone === 'win' ? 'Victory' : tone === 'draw' ? 'Draw' : 'Defeat',
        line: `${plural(s.kills, 'kill')} · ${plural(s.deaths, 'death')} · ${plural(s.assists, 'assist')}`,
        badge: `${tdm.score[0]} : ${tdm.score[1]}`,
        badgeLabel: `${TEAMS[0]} · ${TEAMS[1]}`,
        note: tdm.overtimeAt >= 0 ? 'Overtime' : undefined,
      }}
      lead={<Mvp match={match} tdm={tdm} />}
      details={[
        ['K/D', (s.kills / Math.max(1, s.deaths)).toFixed(2)],
        ['Multi-kills', String(s.multiKills)],
        ['Revenge kills', String(s.revengeKills)],
        ['Damage taken', number(s.damageTaken)],
      ]}
      standings={
        <Standings teamKills={teamKills}>
          {[player.team, 1 - player.team].map((team, g) => (
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
                .map((id, k) => (
                  <StandingsRow
                    key={id}
                    match={match}
                    c={combatants[id]}
                    place={k + 1}
                    step={3 + g * 5 + k}
                    teamKills={teamKills}
                    mark={
                      tdm.mvp === id && (
                        <>
                          <Crown />
                          <span className="ml-1.5 text-[0.55rem] tracking-[0.2em] text-amber-300">MVP</span>
                        </>
                      )
                    }
                  />
                ))}
            </Fragment>
          ))}
        </Standings>
      }
    >
      {children}
    </ResultsFrame>
  )
}

function Mvp({ match: { player, combatants }, tdm }: { match: Match; tdm: TeamDeathmatch }) {
  const mvp = combatants[tdm.mvp]
  if (!mvp) return null
  const s = mvp.stats
  return (
    <div className="animate-rise border border-amber-300/40 bg-amber-300/6 px-4 py-3 motion-reduce:animate-none" style={rise(2)}>
      <p className="text-[0.6rem] font-bold tracking-[0.3em] text-amber-300 uppercase">MVP</p>
      <div className="mt-1 flex items-baseline justify-between gap-4">
        <p className="font-display text-3xl leading-none font-semibold">
          {mvp === player ? 'You' : mvp.name}
          <span className={`ml-3 text-[0.6rem] font-bold tracking-[0.25em] uppercase ${mvp.team === player.team ? 'text-sky-300' : 'text-red-400'}`}>
            {TEAMS[mvp.team]}
          </span>
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
