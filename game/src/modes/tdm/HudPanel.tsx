import { useImperativeHandle, useRef, type Ref } from 'react'
import { caption, SCORE_DETAIL, SCORE_RULE, setText, type HudPanelHandle } from '../../hud/dom.ts'
import type { Match } from '../../runtime/match.ts'
import { TEAMS } from './config.ts'

// Team deathmatch on the HUD (hud/Hud.tsx draws the rest): the team score,
// far bigger than anyone's own, and the momentum in the colour of the team
// ahead; overtime's clock counting up; the scoreboard by team, the player's
// first, each under its header, and the team-kill column with friendly fire.

const teamScore = 'mt-1 text-[clamp(40px,4.2vw,72px)] font-extrabold tabular-nums'

export function HudPanel({ ref }: { ref: Ref<HudPanelHandle> }) {
  const root = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => createPanel(() => root.current), [])

  // Sized to its content (w-max): a wider column — the F3 overlay below — must not stretch the grid's tracks apart.
  return (
    <div ref={root}>
      <div className="grid w-max grid-cols-[auto_auto_auto] items-end gap-x-3 leading-none italic">
        <span className={`${caption} text-sky-300/90 not-italic`}>{TEAMS[0]}</span>
        <span />
        <span className={`${caption} text-red-400/90 not-italic`}>{TEAMS[1]}</span>
        <span data-hud="teamScore" className={`${teamScore} text-sky-300`}>
          0
        </span>
        <span className="pb-[0.35em] text-[clamp(18px,1.7vw,30px)] font-bold text-white/45">:</span>
        <span data-hud="teamScore" className={`${teamScore} text-red-500`}>
          0
        </span>
      </div>
      <div className={SCORE_RULE} />
      <p data-hud="scoreDetail" className={SCORE_DETAIL} />
    </div>
  )
}

const rulesOf = ({ mode }: Match) => (mode.kind === 'tdm' ? mode.rules : null)

function createPanel(getRoot: () => HTMLDivElement | null): HudPanelHandle {
  let el: { teamScore: HTMLElement[]; scoreDetail: HTMLElement } | undefined
  return {
    update(match) {
      const root = getRoot()
      const tdm = rulesOf(match)
      if (!root || !tdm) return
      el ??= {
        teamScore: Array.from(root.querySelectorAll<HTMLElement>('[data-hud="teamScore"]')),
        scoreDetail: root.querySelector<HTMLElement>('[data-hud="scoreDetail"]')!,
      }
      setText(el.teamScore[0], String(tdm.score[0]))
      setText(el.teamScore[1], String(tdm.score[1]))
      const ahead = -tdm.deficit(match.player.team)
      setText(el.scoreDetail, ahead > 0 ? `Leading by ${ahead}` : ahead < 0 ? `Trailing by ${-ahead}` : 'Tied')
      el.scoreDetail.dataset.tone = ahead > 0 ? 'ally' : ahead < 0 ? 'hostile' : 'level'
    },
    leader: () => -1,
    zone: () => null,
    objective: () => '',
    overtimeClock: (match) => Math.floor(rulesOf(match)?.overtimeElapsed() ?? 0), // first kill wins: no clock to run out, it counts up
    words: { down: 'Wrecked', by: 'by', back: 'Respawning in' },
    // ranked by combat score, kills, assists, fewer deaths; the player's team first, each keeping its order
    rank(match, out) {
      const { combatants, player } = match
      for (const i of rulesOf(match)?.standings() ?? []) out.push(combatants[i])
      out.sort((a, b) => +(a.team !== player.team) - +(b.team !== player.team))
    },
    grouped: true,
    groupName: (team) => TEAMS[team],
    groupNote(match, team) {
      const kills = rulesOf(match)?.score[team] ?? 0
      return `${kills} ${kills === 1 ? 'kill' : 'kills'}`
    },
    scoreLine(match) {
      const tdm = rulesOf(match)
      return tdm ? ` · ${TEAMS[0]} ${tdm.score[0]} : ${tdm.score[1]} ${TEAMS[1]}` : ''
    },
    teamKills: (match) => !!rulesOf(match)?.settings.friendlyFire, // information, never a score
    nemesis: () => -1,
  }
}
