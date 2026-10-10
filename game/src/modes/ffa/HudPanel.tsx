import { useImperativeHandle, useRef, type Ref } from 'react'
import { label, SCORE_DETAIL, SCORE_RULE, setStyle, setText, type HudPanelHandle } from '../../hud/dom.ts'
import type { Match } from '../../runtime/match.ts'
import type { FreeForAll } from './rules.ts'

// Free for all on the HUD (hud/Hud.tsx draws the rest): the player's kills,
// where they stand against the lead, the top of the standings; the sole
// leader's crown, the hot zone, overtime's countdown, and the scoreboard
// in standings order.

const BOARD = 4 // standings rows: the top four, or the top three and the player's own place

export function HudPanel({ ref }: { ref: Ref<HudPanelHandle> }) {
  const root = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => createPanel(() => root.current), [])

  return (
    <div ref={root}>
      <div>
        <p className="flex items-baseline gap-2 leading-none italic">
          <span data-hud="score" className="text-[clamp(40px,4.2vw,72px)] font-extrabold tabular-nums">
            0
          </span>
        </p>
        <p className={`mt-1 ${label}`}>Kills</p>
      </div>
      <div className={SCORE_RULE} />
      <p data-hud="scoreDetail" className={SCORE_DETAIL} />
      <ol className="mt-3 w-[clamp(170px,14vw,240px)] text-[0.68rem] font-bold tracking-[0.12em] uppercase">
        {Array.from({ length: BOARD }, (_, i) => (
          <li key={i} data-hud="boardRow" data-me="off" className="group flex items-baseline gap-2 py-px text-white/65 data-[me=on]:text-[#f2ece0]">
            <span data-hud="boardPlace" className="w-4 text-right text-white/40 tabular-nums group-data-[me=on]:text-red-400" />
            <span data-hud="boardName" className="flex-1 truncate" />
            <span data-hud="boardKills" className="font-extrabold tabular-nums" />
          </li>
        ))}
      </ol>
    </div>
  )
}

const rulesOf = ({ mode }: Match) => (mode.kind === 'ffa' ? mode.rules : null)

function collect(root: HTMLDivElement) {
  const one = (name: string) => root.querySelector<HTMLElement>(`[data-hud="${name}"]`)!
  const all = (name: string) => Array.from(root.querySelectorAll<HTMLElement>(`[data-hud="${name}"]`))
  return {
    score: one('score'),
    scoreDetail: one('scoreDetail'),
    boardRows: all('boardRow'),
    boardPlace: all('boardPlace'),
    boardName: all('boardName'),
    boardKills: all('boardKills'),
  }
}

function createPanel(getRoot: () => HTMLDivElement | null): HudPanelHandle {
  let el: ReturnType<typeof collect> | undefined
  return {
    update(match) {
      const root = getRoot()
      const ffa = rulesOf(match)
      if (!root || !ffa) return
      el ??= collect(root)
      setText(el.score, String(match.player.stats.kills))
      setText(el.scoreDetail, leadLine(match, ffa))
      drawBoard(el, match, ffa)
    },
    leader: (match) => rulesOf(match)?.soleLeader() ?? -1,
    zone: (match) => rulesOf(match)?.zone ?? null,
    objective(match) {
      const zone = rulesOf(match)?.zone
      if (!zone) return ''
      const { position } = match.player
      const d = Math.hypot(zone.x - position.x, zone.z - position.z) - zone.radius
      return `Hot zone · ${zone.name} · ${d <= 0 ? 'inside' : `${Math.round(d)} m`}`
    },
    overtimeClock: (match) => Math.ceil(rulesOf(match)?.overtimeLeft() ?? 0),
    words: { down: 'Destroyed', by: 'Wrecked by', back: 'Back in' },
    rank(match, out) {
      for (const i of rulesOf(match)?.standings() ?? []) out.push(match.combatants[i])
    },
    grouped: false,
    groupName: () => '',
    groupNote: () => '',
    scoreLine: () => '',
    teamKills: () => false,
    nemesis: (match) => rulesOf(match)?.nemesisOf(match.player.id) ?? -1,
  }
}

// Where the player stands against the lead.
function leadLine({ combatants, player }: Match, ffa: FreeForAll) {
  const order = ffa.standings()
  const first = combatants[order[0]]
  const mine = player.stats.kills
  if (mine < first.stats.kills) return `${first.name} +${first.stats.kills - mine}`
  const next = combatants[order[0] === player.id ? order[1] : order[0]].stats.kills
  return mine > next ? `You lead +${mine - next}` : 'Tied for the lead'
}

// The top four, the last row giving way to the player's own place if lower.
function drawBoard(el: ReturnType<typeof collect>, { combatants, player }: Match, ffa: FreeForAll) {
  const order = ffa.standings()
  const me = order.indexOf(player.id)
  for (let k = 0; k < el.boardRows.length; k++) {
    const place = k === el.boardRows.length - 1 && me > k ? me : k
    const c = combatants[order[place]]
    setStyle(el.boardRows[k], 'display', c ? 'flex' : 'none')
    if (!c) continue
    setText(el.boardPlace[k], String(place + 1))
    setText(el.boardName[k], c === player ? 'You' : c.name)
    setText(el.boardKills[k], String(c.stats.kills))
    el.boardRows[k].dataset.me = c === player ? 'on' : 'off'
  }
}
