import { Fragment, memo, useImperativeHandle, useRef, type Ref } from 'react'
import * as THREE from 'three'
import type { FreeForAll } from '../game/ffa/rules'
import { SUPPLY } from '../game/items/config'
import { ITEMS } from '../game/items/items'
import type { Effect } from '../game/items/supply'
import type { Match } from '../game/match'
import { clock } from '../game/mode'
import { MODES } from '../game/modes'
import { settings } from '../game/settings'
import type { Combatant } from '../game/simulation'
import { TEAMS } from '../game/tdm/config'
import { createMinimap, type MapMarks } from './minimap'

// Gameplay HUD. React renders the markup once; the game loop calls update()
// every frame, which writes straight to the DOM (only what changed), so the
// component tree never re-renders during play. It reads the match's state:
// the shared parts (clock, lives, weapon, feed) through the running mode's
// contract, the free-for-all and team panels through that mode's own rules.
export interface HudHandle {
  update(match: Match, camera: THREE.PerspectiveCamera): void
  scoreboard(open: boolean): void // held Tab
}

const COMPASS_SPAN = 150 // degrees visible across the compass strip
const CARDINALS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }
const COMPASS_TICKS = Array.from({ length: 144 }, (_, i) => i * 5 - 180) // two turns, so the strip wraps seamlessly
const GAUGE = 2 * Math.PI * 84 * 0.75 // speedometer arc length: 270° of r = 84
const MARKERS = 12 // pooled markers over the bots, for the biggest match (a custom lobby's)
const BOARD = 4 // free-for-all standings rows: the top four, or the top three and the player's own place
const FEED = 5 // feed rows
const FEED_LIFE = 7 // seconds a feed line stays up
// Effect chips over the health bar: spawn protection, then the timed pickups.
const EFFECTS: Array<{ kind: 'shield' | Effect; label: string; color: string }> = [
  { kind: 'shield', label: 'Shield', color: '#f2ece0' },
  { kind: 'repair', label: ITEMS.repair.label, color: ITEMS.repair.color },
  { kind: 'speed', label: ITEMS.speed.label, color: ITEMS.speed.color },
  { kind: 'armor', label: ITEMS.armor.label, color: ITEMS.armor.color },
  { kind: 'damage', label: ITEMS.damage.label, color: ITEMS.damage.color },
]
const SEGMENTS = 'repeating-linear-gradient(90deg, transparent 0 calc(20% - 3px), rgba(8, 6, 5, 0.85) calc(20% - 3px) 20%)'

const caption = 'text-[0.62rem] font-bold tracking-[0.3em] uppercase'
const label = `${caption} text-white/60`
const SCORE_ROWS = 12 // every machine in the biggest match (a custom lobby's)
const scoreCell = 'w-16 py-1.5 text-right'
const teamKillCell = 'hidden w-12 py-1.5 text-right group-data-[tk=on]/scores:table-cell' // team kills: only with friendly fire on
const teamScore = 'mt-1 text-[clamp(40px,4.2vw,72px)] font-extrabold tabular-nums'
const sided = 'data-[side=ally]:text-sky-300 data-[side=hostile]:text-red-400' // team colours, relative to the player

// Markup only, rendered once: the game loop writes it through the handle,
// so the gameplay screen re-rendering (loading steps, pause) skips it.
export const Hud = memo(function Hud({ ref }: { ref: Ref<HudHandle> }) {
  const root = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => createView(() => root.current), [])

  return (
    <div ref={root} className="pointer-events-none fixed inset-0 overflow-hidden font-sans text-[#f2ece0] [text-shadow:0_1px_3px_rgba(0,0,0,0.85)] select-none">
      <div data-hud="vignette" className="absolute inset-0 opacity-0" style={{ background: 'radial-gradient(ellipse at center, transparent 58%, rgba(200, 24, 12, 0.55) 100%)' }} />
      <div data-hud="hitFrom" className="absolute top-1/2 left-1/2 h-[52vh] w-[52vh] -translate-1/2 opacity-0">
        <div className="absolute top-0 left-1/2 h-[18%] w-[34%] -translate-x-1/2 rounded-[50%] border-t-4 border-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
      </div>

      {/* top left: the score — the player's kills in free for all, the team score in team deathmatch */}
      <div className="absolute top-[3.2vh] left-[2.6vw]">
        <div data-hud="solo">
          <p className="flex items-baseline gap-2 leading-none italic">
            <span data-hud="score" className="text-[clamp(40px,4.2vw,72px)] font-extrabold tabular-nums">0</span>
          </p>
          <p className={`mt-1 ${label}`}>Kills</p>
        </div>
        {/* team deathmatch: team kills, far bigger than anyone's own. Sized to its content (w-max): a wider
            column — the F3 overlay below — must not stretch the grid's tracks apart */}
        <div data-hud="teams" className="hidden w-max grid-cols-[auto_auto_auto] items-end gap-x-3 leading-none italic">
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
        <div className="mt-2 h-px w-14 bg-red-500/80" />
        {/* free for all: the lead line; team deathmatch: momentum, in the colour of the team ahead */}
        <p data-hud="scoreDetail" className="mt-2 text-[0.7rem] font-extrabold tracking-[0.2em] text-red-400 uppercase data-[tone=ally]:text-sky-300 data-[tone=level]:text-white/70" />
        {/* free for all: standings */}
        <ol data-hud="board" className="mt-3 hidden w-[clamp(170px,14vw,240px)] text-[0.68rem] font-bold tracking-[0.12em] uppercase">
          {Array.from({ length: BOARD }, (_, i) => (
            <li key={i} data-hud="boardRow" data-me="off" className="group flex items-baseline gap-2 py-px text-white/65 data-[me=on]:text-[#f2ece0]">
              <span data-hud="boardPlace" className="w-4 text-right text-white/40 tabular-nums group-data-[me=on]:text-red-400" />
              <span data-hud="boardName" className="flex-1 truncate" />
              <span data-hud="boardKills" className="font-extrabold tabular-nums" />
            </li>
          ))}
        </ol>
        <p data-hud="fps" className={`mt-3 hidden tabular-nums ${label}`} />
        <pre data-hud="debug" className="mt-5 hidden rounded bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-lime-200" />
      </div>

      {/* top centre: compass */}
      <div className="absolute top-[2vh] left-1/2 h-12 w-[clamp(340px,38vw,720px)] -translate-x-1/2 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_20%,black_80%,transparent)]">
        <div data-hud="compass" className="absolute inset-y-0 left-1/2" style={{ width: `${(720 / COMPASS_SPAN) * 100}%` }}>
          {COMPASS_TICKS.map((deg) => {
            const bearing = (deg + 360) % 360
            const name = CARDINALS[bearing] ?? (bearing % 15 === 0 ? String(bearing) : '')
            return (
              <span key={deg} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${((deg + 180) / 720) * 100}%` }}>
                <span className={`h-5 leading-5 ${bearing % 45 === 0 ? 'text-[15px] font-extrabold text-white' : 'text-[11px] font-semibold text-white/70'}`}>{name}</span>
                <span className={`mt-1 w-px ${name ? 'h-3 bg-white/80' : 'h-1.5 bg-white/45'}`} />
              </span>
            )
          })}
        </div>
      </div>
      <div className="absolute top-[0.8vh] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[8px] border-x-transparent border-t-red-500" />
      <p data-hud="banner" data-tone="amber" className="absolute top-[7.4vh] left-1/2 -translate-x-1/2 text-[0.72rem] font-extrabold tracking-[0.45em] whitespace-nowrap text-amber-300 uppercase opacity-0 data-[tone=red]:text-red-500" />
      <p data-hud="message" className="absolute top-[11vh] left-1/2 -translate-x-1/2 text-sm font-extrabold tracking-[0.35em] whitespace-nowrap text-red-400 uppercase opacity-0" />
      {/* above the scoreboard (z-10): the last seconds still count down while the player is down */}
      <p data-hud="countdown" className="absolute top-[15vh] left-1/2 z-10 -translate-x-1/2 text-[clamp(44px,5vw,84px)] leading-none font-extrabold italic tabular-nums opacity-0" />

      {/* top right: minimap and match clock */}
      <div className="absolute top-[2.4vh] right-[2.2vw] flex flex-col items-center">
        <div className="aspect-square w-[clamp(140px,12.5vw,230px)] rounded-full border border-white/25 shadow-[0_0_0_5px_rgba(0,0,0,0.25),0_0_24px_rgba(0,0,0,0.5)]">
          <canvas data-hud="minimap" className="h-full w-full rounded-full" />
        </div>
        <p
          data-hud="clock"
          data-urgency="none"
          className="mt-3 text-[clamp(20px,1.9vw,32px)] leading-none font-extrabold italic tabular-nums data-[urgency=final]:text-red-500 data-[urgency=minute]:text-red-400 data-[urgency=overtime]:text-amber-300 data-[urgency=push]:animate-pulse data-[urgency=push]:text-red-500"
        >
          00:00
        </p>
        <p data-hud="clockLabel" className={`mt-1 ${label}`}>
          Time
        </p>
        {/* online: how many people are in the room */}
        <p data-hud="people" className={`mt-2 hidden whitespace-nowrap ${label}`} />
        {/* free for all's hot zone, then the feed — out of the flow, so long lines grow leftward instead of widening the column and shifting the map */}
        <div className="absolute top-full right-0 mt-3 flex flex-col items-end gap-1">
          <p data-hud="zone" className="mb-2 hidden text-[0.62rem] font-extrabold tracking-[0.25em] whitespace-nowrap text-orange-400 uppercase" />
          {Array.from({ length: FEED }, (_, i) => (
            <p key={i} data-hud="feedRow" data-mine="off" className="hidden border-red-500 text-right text-[0.68rem] font-bold tracking-[0.06em] whitespace-nowrap text-white/80 data-[mine=on]:border-r-2 data-[mine=on]:pr-2 data-[mine=on]:text-[#f2ece0]">
              <span data-hud="feedWho" data-side="none" className={sided} /> <span data-hud="feedText" /> <span data-hud="feedWhom" data-side="none" className={sided} />
              <span data-hud="feedTag" className="ml-2 text-[0.6rem] font-extrabold tracking-[0.2em] text-red-400 uppercase" />
            </p>
          ))}
        </div>
      </div>

      {/* centre: crosshair, hit marker, lock-on range */}
      <div data-hud="crosshair" data-target="off" className="group absolute top-1/2 left-1/2 h-16 w-16 -translate-1/2 text-white/85 transition-colors duration-100 data-[target=on]:text-red-500">
        <svg viewBox="-32 -32 64 64" className="h-full w-full overflow-visible transition-transform duration-150 group-data-[target=on]:scale-90" fill="none" stroke="currentColor">
          <circle r="14" strokeWidth="1.5" />
          <path d="M0 -27V-19M0 19V27M-27 0H-19M19 0H27" strokeWidth="1.5" />
          <circle r="1.7" fill="currentColor" stroke="none" />
          <path data-hud="hitMarker" d="M-11 -11L-6 -6M11 -11L6 -6M-11 11L-6 6M11 11L6 6" strokeWidth="2.2" stroke="#f2ece0" opacity="0" />
        </svg>
        <p data-hud="range" className="absolute top-full left-1/2 mt-1 -translate-x-1/2 text-[0.7rem] font-extrabold tracking-[0.2em] whitespace-nowrap opacity-0 group-data-[target=on]:opacity-100" />
      </div>

      {/* markers over the bots, pooled: red hostiles, blue crewmates */}
      {Array.from({ length: MARKERS }, (_, i) => (
        <div key={i} data-hud="marker" data-side="hostile" data-leader="off" data-shield="off" className="group absolute top-0 left-0 hidden w-[clamp(44px,4vw,72px)] -translate-x-1/2 -translate-y-full data-[shield=on]:opacity-45">
          <svg viewBox="0 0 16 10" className="mx-auto mb-1 hidden h-2.5 w-4 fill-amber-300 drop-shadow-[0_0_4px_rgba(252,211,77,0.8)] group-data-[leader=on]:block">
            <path d="M1 10h14l1-8-4.5 3.2L8 0 4.5 5.2 0 2z" />
          </svg>
          <div className="h-[3px] bg-black/60">
            <div data-hud="markerHealth" className="h-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)] group-data-[side=ally]:bg-sky-300 group-data-[side=ally]:shadow-[0_0_6px_rgba(125,211,252,0.9)]" />
          </div>
          <div className="mx-auto mt-1 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-red-500 group-data-[side=ally]:border-t-sky-300" />
        </div>
      ))}

      {/* bottom left: speedometer */}
      <div className="absolute bottom-[2.6vh] left-[2vw] aspect-square w-[clamp(150px,13vw,240px)]">
        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="hud-gauge" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0.35" stopColor="#f2ece0" />
              <stop offset="0.75" stopColor="#ef4444" />
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r="94" fill="rgba(8, 6, 5, 0.45)" />
          <circle cx="100" cy="100" r="84" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="6" strokeDasharray={`${GAUGE} 1000`} transform="rotate(135 100 100)" />
          <circle data-hud="gauge" cx="100" cy="100" r="84" fill="none" stroke="url(#hud-gauge)" strokeWidth="6" strokeDasharray={`0 1000`} transform="rotate(135 100 100)" />
          {Array.from({ length: 11 }, (_, i) => (
            <line key={i} x1="100" y1="22" x2="100" y2={i % 5 ? 28 : 32} stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" transform={`rotate(${-135 + i * 27} 100 100)`} />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
          <span data-hud="speed" className="text-[clamp(38px,3.7vw,66px)] leading-none font-extrabold italic tabular-nums">
            0
          </span>
          <span className={`mt-1 ${label}`}>km/h</span>
          <span className="mt-3 flex items-center gap-2 text-sm font-bold text-white/45">
            «<span data-hud="gear" className="rounded-[3px] border border-white/70 px-1.5 text-sm font-extrabold text-white not-italic">D</span>»
          </span>
        </div>
      </div>

      {/* bottom centre: health */}
      <div className="absolute bottom-[4.6vh] left-1/2 flex -translate-x-1/2 items-center gap-3">
        <svg viewBox="0 0 16 16" className="h-5 w-5 fill-current">
          <path d="M6 1h4v5h5v4h-5v5H6v-5H1V6h5z" />
        </svg>
        <span data-hud="health" className="w-[2.6ch] text-[clamp(22px,2vw,34px)] leading-none font-extrabold italic tabular-nums">
          100
        </span>
        <div data-hud="healthBar" data-low="off" className="group relative h-3.5 w-[clamp(220px,22vw,420px)] bg-white/10">
          <div data-hud="healthTrail" className="absolute inset-y-0 left-0 w-full bg-white/35 transition-[width] delay-300 duration-700" />
          <div data-hud="healthFill" className="absolute inset-y-0 left-0 w-full bg-[#f2ece0] group-data-[low=on]:bg-red-500" />
          <div className="absolute inset-0" style={{ background: SEGMENTS }} />
        </div>
      </div>
      {/* free for all: what was just picked up; the effects running */}
      <p data-hud="pickup" className="absolute bottom-[13vh] left-1/2 -translate-x-1/2 text-sm font-extrabold tracking-[0.3em] whitespace-nowrap uppercase opacity-0" />
      <div className="absolute bottom-[9.2vh] left-1/2 flex -translate-x-1/2 gap-2">
        {EFFECTS.map(({ kind, label, color }) => (
          <span key={kind} data-hud="effect" className="hidden items-baseline gap-1.5 border bg-black/35 px-2 py-0.5 text-[0.6rem] font-extrabold tracking-[0.2em] whitespace-nowrap uppercase" style={{ borderColor: color, color }}>
            {label}
            <span data-hud="effectLeft" className="text-[#f2ece0] normal-case tabular-nums" />
          </span>
        ))}
      </div>
      <p data-hud="stuck" className="absolute top-[60%] left-1/2 -translate-x-1/2 text-[0.72rem] font-extrabold tracking-[0.3em] whitespace-nowrap text-amber-300 uppercase opacity-0 transition-opacity duration-300">
        Stuck · press <span className="rounded border border-amber-300/60 px-1.5 py-0.5">R</span> to recover
      </p>
      <p data-hud="hint" className="absolute bottom-[16vh] left-1/2 -translate-x-1/2 text-[0.62rem] font-bold tracking-[0.25em] whitespace-nowrap text-white/70 uppercase transition-opacity duration-700">
        Click to aim · W A S D drive · Space handbrake · LMB fire · Esc pause
      </p>

      {/* bottom right: weapon */}
      <div className="absolute right-[2.2vw] bottom-[3vh] flex flex-col items-center gap-2">
        <div data-hud="weapon" data-reloading="off" data-kind="minigun" className="group relative flex h-[clamp(84px,7.6vw,118px)] w-[clamp(112px,10vw,152px)] flex-col items-center justify-center gap-1.5 border-2 border-red-500/90 bg-black/40 shadow-[inset_0_0_26px_rgba(239,68,68,0.28)]">
          <svg viewBox="0 0 64 28" className="hidden w-3/5 fill-current transition-opacity group-data-[kind=rocketPod]:block group-data-[reloading=on]:opacity-30">
            <rect x="8" y="4" width="34" height="17" rx="2" />
            <path d="M42 6h11l6 3.5-6 3.5H42zM42 13.5h11l6 3.5-6 3.5H42z" />
            <rect x="21" y="21" width="6" height="5" rx="1" />
          </svg>
          <svg viewBox="0 0 64 28" className="w-3/5 fill-current transition-opacity group-data-[kind=rocketPod]:hidden group-data-[reloading=on]:opacity-30">
            <rect x="18" y="8" width="22" height="12" rx="2" />
            <rect x="40" y="9" width="20" height="2.2" />
            <rect x="40" y="12.9" width="22" height="2.2" />
            <rect x="40" y="16.8" width="20" height="2.2" />
            <rect x="55" y="7.5" width="3" height="13" rx="1" />
            <path d="M18 11H7l-3 7h6l2-3h6z" />
            <rect x="25" y="20" width="5" height="6" rx="1" />
          </svg>
          <p className="leading-none font-extrabold italic tabular-nums">
            <span data-hud="ammo" className="text-[clamp(16px,1.3vw,22px)]">
              60
            </span>
            <span className="text-xs text-white/60">
              {' / '}
              <span data-hud="magazine">60</span>
            </span>
          </p>
          <span className="absolute top-1 text-[0.55rem] font-bold tracking-[0.3em] text-red-400 opacity-0 group-data-[reloading=on]:opacity-100">RELOAD</span>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div data-hud="reload" className="h-full w-0 bg-red-500" />
          </div>
        </div>
        <p data-hud="weaponName" className={label} />
      </div>

      {/* held Tab: the scoreboard — every machine's place and record (kills, deaths, assists, streak, damage, score;
          team deathmatch heads each team with its kills). It also shows while the player is down,
          headed by who wrecked them and the wait. Centred, but moved left as far as needed to keep clear of the feed
          (its lines reach ~24rem in from the right edge), so a killer's name is never hidden while the player is down. */}
      <div data-hud="scores" data-mode="ffa" data-dead="off" data-tk="off" className="group group/scores absolute top-1/2 left-[clamp(calc(min(46vw,390px)_+_1rem),calc(100%_-_min(46vw,390px)_-_24rem),50%)] hidden w-[min(92vw,780px)] -translate-1/2 border border-white/10 bg-[#0b0908]/85 px-7 pt-5 pb-6 shadow-[0_24px_70px_rgba(0,0,0,0.65)] [text-shadow:none] data-[dead=on]:border-red-500/30">
        <div className="flex items-end justify-between gap-6 border-b border-white/10 pb-3">
          <div>
            <p className="mb-1 hidden text-xs font-bold tracking-[0.3em] text-red-400/90 uppercase group-data-[dead=on]:block">Your machine is scrap</p>
            <p data-hud="scoresMode" className="font-display text-3xl font-semibold group-data-[dead=on]:text-4xl group-data-[dead=on]:text-red-500" />
            <p data-hud="scoresKiller" className="mt-1 hidden font-display text-base text-neutral-300 italic group-data-[dead=on]:block" />
          </div>
          <div className="text-right">
            <p data-hud="scoresRespawn" className="mb-1 hidden text-lg font-extrabold tracking-[0.2em] text-[#f2ece0] uppercase tabular-nums group-data-[dead=on]:block" />
            <p data-hud="scoresInfo" className="text-[0.68rem] font-bold tracking-[0.25em] whitespace-nowrap text-neutral-400 uppercase" />
          </div>
        </div>
        <table className="mt-3 w-full text-xs font-bold tracking-[0.14em] uppercase tabular-nums">
          <thead className="text-[0.62rem] text-neutral-500">
            <tr>
              <th className="w-8 py-1.5 text-left font-bold">#</th>
              <th className="py-1.5 text-left font-bold">Machine</th>
              <th className={`${scoreCell} font-bold`}>K</th>
              <th className={`${scoreCell} font-bold`}>D</th>
              <th className={`${scoreCell} font-bold`}>A</th>
              <th className={`${scoreCell} font-bold`}>Streak</th>
              <th className={`${scoreCell} font-bold`}>Damage</th>
              <th className={`${scoreCell} font-bold`}>Score</th>
              <th className={`${teamKillCell} font-bold`}>TK</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: SCORE_ROWS }, (_, i) => (
              <Fragment key={i}>
                {/* team deathmatch: a team's header over its first row */}
                <tr data-hud="scoresTeam" data-side="ally" className="group hidden border-t border-white/10 first:border-t-0">
                  <td colSpan={9} className="pt-3 pb-1 pl-1 text-[0.62rem] tracking-[0.25em]">
                    <span data-hud="scoresTeamName" className="text-sky-300 group-data-[side=hostile]:text-red-400" />
                    <span data-hud="scoresTeamKills" className="ml-3 text-neutral-400" />
                  </td>
                </tr>
                <tr
                  data-hud="scoresRow"
                  data-side="hostile"
                  data-down="off"
                  data-leader="off"
                  data-nemesis="off"
                  data-bot="off"
                  className="group text-neutral-300 data-[down=on]:opacity-45 data-[side=self]:bg-red-500/10 data-[side=self]:text-red-300"
                >
                  <td data-hud="scoresPlace" className="py-1.5 pl-1 text-neutral-500" />
                  <td className="py-1.5 whitespace-nowrap">
                    <span className="mr-2.5 mb-0.5 inline-block h-2 w-2 rotate-45 bg-red-500 group-data-[side=ally]:bg-sky-300 group-data-[side=self]:bg-[#f2ece0]" />
                    <span data-hud="scoresName" />
                    <svg viewBox="0 0 16 10" className="mb-0.5 ml-2 hidden h-2.5 w-4 fill-amber-300 group-data-[leader=on]:inline-block">
                      <path d="M1 10h14l1-8-4.5 3.2L8 0 4.5 5.2 0 2z" />
                    </svg>
                    <span className="ml-2 hidden text-[0.55rem] tracking-[0.2em] text-red-400 group-data-[nemesis=on]:inline">Nemesis</span>
                    <span className="ml-2 hidden text-[0.55rem] tracking-[0.2em] text-neutral-500 group-data-[bot=on]:inline">Bot</span>
                  </td>
                  <td data-hud="scoresKills" className={`${scoreCell} text-[#f2ece0] group-data-[side=self]:text-red-300`} />
                  <td data-hud="scoresDeaths" className={scoreCell} />
                  <td data-hud="scoresAssists" className={scoreCell} />
                  <td data-hud="scoresStreak" className={scoreCell} />
                  <td data-hud="scoresDamage" className={scoreCell} />
                  <td data-hud="scoresScore" className={scoreCell} />
                  <td data-hud="scoresTK" className={teamKillCell} />
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
        <p className="mt-4 hidden items-center justify-end gap-3 text-xs tracking-[0.1em] text-neutral-400 uppercase group-data-[dead=on]:flex">
          <span className="rounded border border-neutral-500/50 px-1.5 py-0.5">Esc</span>
          <span>Pause</span>
        </p>
      </div>
    </div>
  )
})

type Styled = HTMLElement | SVGElement

// DOM writes are skipped when the value is unchanged (inline styles and text
// read back without forcing layout).
function setText(el: Element, value: string) {
  if (el.textContent !== value) el.textContent = value
}
function setStyle(el: Styled, property: 'opacity' | 'transform' | 'width' | 'display', value: string) {
  if (el.style[property] !== value) el.style[property] = value
}
const fade = (el: Styled, value: number) => setStyle(el, 'opacity', value < 0.01 ? '0' : String(Math.round(value * 100) / 100))
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

function collect(root: HTMLDivElement) {
  const one = <T extends Element = HTMLElement>(name: string) => root.querySelector<T>(`[data-hud="${name}"]`)!
  const all = (name: string) => Array.from(root.querySelectorAll<HTMLElement>(`[data-hud="${name}"]`))
  return {
    vignette: one('vignette'),
    hitFrom: one('hitFrom'),
    solo: one('solo'),
    teams: one('teams'),
    teamScore: all('teamScore'),
    score: one('score'),
    scoreDetail: one('scoreDetail'),
    board: one('board'),
    boardRows: all('boardRow'),
    boardPlace: all('boardPlace'),
    boardName: all('boardName'),
    boardKills: all('boardKills'),
    fps: one('fps'),
    debug: one('debug'),
    compass: one('compass'),
    message: one('message'),
    banner: one('banner'),
    countdown: one('countdown'),
    minimap: one<HTMLCanvasElement>('minimap'),
    clock: one('clock'),
    clockLabel: one('clockLabel'),
    people: one('people'),
    zone: one('zone'),
    feedRows: all('feedRow'),
    feedWho: all('feedWho'),
    feedText: all('feedText'),
    feedWhom: all('feedWhom'),
    feedTag: all('feedTag'),
    crosshair: one('crosshair'),
    hitMarker: one<SVGPathElement>('hitMarker'),
    range: one('range'),
    markers: all('marker'),
    markerHealth: all('markerHealth'),
    gauge: one<SVGCircleElement>('gauge'),
    speed: one('speed'),
    gear: one('gear'),
    health: one('health'),
    healthBar: one('healthBar'),
    healthTrail: one('healthTrail'),
    healthFill: one('healthFill'),
    hint: one('hint'),
    stuck: one('stuck'),
    pickup: one('pickup'),
    effects: all('effect'),
    effectLeft: all('effectLeft'),
    weapon: one('weapon'),
    ammo: one('ammo'),
    magazine: one('magazine'),
    reload: one('reload'),
    weaponName: one('weaponName'),
    scores: one('scores'),
    scoresMode: one('scoresMode'),
    scoresKiller: one('scoresKiller'),
    scoresRespawn: one('scoresRespawn'),
    scoresInfo: one('scoresInfo'),
    scoresTeam: all('scoresTeam'),
    scoresTeamName: all('scoresTeamName'),
    scoresTeamKills: all('scoresTeamKills'),
    scoresRows: all('scoresRow'),
    scoresPlace: all('scoresPlace'),
    scoresName: all('scoresName'),
    scoresKills: all('scoresKills'),
    scoresDeaths: all('scoresDeaths'),
    scoresAssists: all('scoresAssists'),
    scoresStreak: all('scoresStreak'),
    scoresDamage: all('scoresDamage'),
    scoresScore: all('scoresScore'),
    scoresTK: all('scoresTK'),
  }
}

function createView(getRoot: () => HTMLDivElement | null): HudHandle {
  let el: ReturnType<typeof collect> | undefined
  let drawMinimap: ReturnType<typeof createMinimap> | undefined
  let frames = 0
  let sampleAt = 0 // frame-rate sampling window start
  let lastKmh = -1
  const screen = new THREE.Vector3()
  const marks: MapMarks = { zone: null, items: [], range: SUPPLY.senseRange, leader: null }
  const ranked: Combatant[] = [] // scoreboard order, refilled while it's open
  let scoresOpen = false

  return {
    scoreboard(open) {
      scoresOpen = open
    },
    update(match, camera) {
      const root = getRoot()
      if (!root) return
      el ??= collect(root)
      const over = match.phase === 'victory' || match.phase === 'defeat' // the results screen takes over
      setStyle(root, 'display', over ? 'none' : '')
      if (over) return
      const { player, others, feedback, mode } = match
      const { rules, timing } = mode // clock, countdowns, protection
      const ffa = mode.kind === 'ffa' ? mode.rules : null
      const tdm = mode.kind === 'tdm' ? mode.rules : null
      const now = performance.now()
      const leader = ffa ? ffa.soleLeader() : -1

      // heading: compass strip slides so the view bearing sits under the marker
      const yaw = match.chase.yaw
      const bearing = (((180 - THREE.MathUtils.radToDeg(yaw)) % 360) + 360) % 360
      setStyle(el.compass, 'transform', `translateX(${(-(bearing + 180) / 7.2).toFixed(3)}%)`)
      const car = match.cars[player.id].model
      const q = car.quaternion
      drawMinimap ??= createMinimap(el.minimap, match.arena)
      marks.zone = ffa?.zone ?? null
      marks.items = mode.supply?.items ?? []
      marks.leader = leader > 0 && match.combatants[leader].alive ? match.combatants[leader].position : null
      drawMinimap(car.position, yaw, Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)), others, player.team, ffa || mode.supply ? marks : undefined, match.online ? match.people : undefined)

      setStyle(el.solo, 'display', tdm ? 'none' : 'block')
      setStyle(el.teams, 'display', tdm ? 'grid' : 'none')
      setStyle(el.board, 'display', ffa ? 'block' : 'none')
      if (tdm) {
        setText(el.teamScore[0], String(tdm.score[0]))
        setText(el.teamScore[1], String(tdm.score[1]))
        const ahead = -tdm.deficit(player.team)
        setText(el.scoreDetail, ahead > 0 ? `Leading by ${ahead}` : ahead < 0 ? `Trailing by ${-ahead}` : 'Tied')
        el.scoreDetail.dataset.tone = ahead > 0 ? 'ally' : ahead < 0 ? 'hostile' : 'level'
      } else if (ffa) {
        setText(el.score, String(player.stats.kills))
        setText(el.scoreDetail, leadLine(match, ffa))
        drawBoard(el, match, ffa)
      }

      // clock: counts down, turning red toward the end. Team deathmatch
      // overtime has no clock to run out (first kill wins): it counts up.
      const overtime = rules.phase === 'overtime'
      const timeLeft = rules.remaining()
      setText(el.clock, clock(!overtime ? Math.ceil(timeLeft) : ffa ? Math.ceil(ffa.overtimeLeft()) : Math.floor(tdm?.overtimeElapsed() ?? 0)))
      setStyle(el.people, 'display', match.online ? 'block' : 'none')
      if (match.online) setText(el.people, `Online · ${peopleLine(match)}`)
      setText(el.clockLabel, overtime ? 'Overtime' : 'Time')
      el.clock.dataset.urgency = overtime ? 'overtime' : rules.phase === 'complete' || timeLeft > timing.finalMinute ? 'none' : timeLeft <= timing.finalCountdown ? 'final' : timeLeft <= timing.finalPush ? 'push' : 'minute'

      // the banner, big countdown digits, the feed (free for all: the hot zone)
      let banner = ''
      let count = 0 // seconds on the big countdown
      let left = 0
      if (rules.phase === 'preMatch') left = timing.preMatch - rules.now
      if ((rules.phase === 'active' || rules.phase === 'finalMinute') && rules.remaining() <= timing.finalMinute) {
        banner = 'Final minute'
        left = rules.remaining() <= timing.finalCountdown ? rules.remaining() : 0
      }
      if (rules.phase === 'overtime') banner = 'Overtime · First kill wins'
      const waiting = match.holdIn() // online, a new room: its first match waits for everyone's page to load
      if (waiting < Infinity) {
        banner = `Waiting for players · ${Math.ceil(waiting)} s`
        left = 0
      }
      if (left > 0) count = Math.ceil(left)
      setText(el.banner, banner)
      fade(el.banner, banner ? 1 : 0)
      el.banner.dataset.tone = rules.phase === 'overtime' ? 'red' : 'amber'
      setText(el.countdown, count ? String(count) : '')
      fade(el.countdown, count ? 0.35 + 0.65 * (left - (count - 1)) : 0) // each digit fades through its second
      const zone = ffa?.zone
      setStyle(el.zone, 'display', zone ? 'block' : 'none')
      if (zone) {
        const d = Math.hypot(zone.x - player.position.x, zone.z - player.position.z) - zone.radius
        setText(el.zone, `Hot zone · ${zone.name} · ${d <= 0 ? 'inside' : `${Math.round(d)} m`}`)
      }
      const side = (team: number) => (team < 0 ? 'none' : team === player.team ? 'ally' : 'hostile')
      for (let k = 0; k < el.feedRows.length; k++) {
        const line = match.feed[match.feed.length - 1 - k]
        const age = line ? rules.now - line.time : Infinity
        setStyle(el.feedRows[k], 'display', age < FEED_LIFE ? 'block' : 'none')
        if (!line || age >= FEED_LIFE) continue
        setText(el.feedWho[k], line.who)
        setText(el.feedText[k], line.text)
        setText(el.feedWhom[k], line.whom)
        el.feedWho[k].dataset.side = side(line.teams[0])
        el.feedWhom[k].dataset.side = side(line.teams[1])
        setText(el.feedTag[k], line.tag)
        el.feedRows[k].dataset.mine = line.mine ? 'on' : 'off'
        fade(el.feedRows[k], Math.min(1, FEED_LIFE - age))
      }

      // vehicle: speed off the physics body, gear from the direction of travel
      const kmh = Math.round(Math.abs(player.speed) * 3.6)
      if (kmh !== lastKmh) {
        lastKmh = kmh
        el.speed.textContent = String(kmh)
        el.gauge.setAttribute('stroke-dasharray', `${Math.min(kmh / 120, 1) * GAUGE} 1000`)
      }
      setText(el.gear, player.speed < -0.5 ? 'R' : 'D')
      const health = Math.ceil(player.health)
      const percent = `${(player.health / player.maxHealth) * 100}%`
      setText(el.health, String(health))
      setStyle(el.healthFill, 'width', percent)
      setStyle(el.healthTrail, 'width', percent)
      el.healthBar.dataset.low = health <= 30 ? 'on' : 'off'

      // pickups: what was just picked up; each effect's time left
      setText(el.pickup, feedback.pickup)
      if (el.pickup.style.color !== feedback.pickupColor) el.pickup.style.color = feedback.pickupColor
      fade(el.pickup, Math.min(1, feedback.pickupTime))
      const mine = rules.contenders[player.id]
      for (let k = 0; k < EFFECTS.length; k++) {
        const { kind } = EFFECTS[k]
        const until = kind === 'shield' ? (mine.life === 'protected' ? mine.protectedUntil : 0) : (mode.supply?.effects[player.id][kind] ?? 0)
        const remaining = until - rules.now
        setStyle(el.effects[k], 'display', remaining > 0 ? 'inline-flex' : 'none')
        if (remaining > 0) setText(el.effectLeft[k], `${remaining.toFixed(1)}s`)
      }

      // weapon
      const { weapon } = player
      setText(el.weaponName, `${weapon.spec.name} · LMB`)
      el.weapon.dataset.kind = weapon.spec.model
      setText(el.ammo, String(weapon.ammo))
      setText(el.magazine, String(weapon.spec.magazine))
      el.weapon.dataset.reloading = weapon.reload > 0 ? 'on' : 'off'
      setStyle(el.reload, 'width', weapon.reload > 0 ? `${(1 - weapon.reload / weapon.spec.reloadTime) * 100}%` : '0%')

      // crosshair: locks red onto a hostile, with its range
      el.crosshair.dataset.target = match.aim.target ? 'on' : 'off'
      if (match.aim.target) setText(el.range, `${Math.round(match.aim.distance)} m`)
      fade(el.hitMarker, Math.max(feedback.hit, feedback.kill))
      el.hitMarker.setAttribute('stroke', feedback.kill > 0 ? '#ef4444' : '#f2ece0')

      // markers over live rivals in plain view (free for all: a crown on the leader; protected ones dimmed)
      for (let i = 0; i < el.markers.length; i++) {
        const bot = others[i]
        if (bot?.alive) {
          screen.copy(match.cars[bot.id].model.position)
          screen.y += 3.2
          screen.project(camera)
        }
        if (!bot?.alive || !match.seen[bot.id] || screen.z > 1 || Math.abs(screen.x) > 1.05 || Math.abs(screen.y) > 1.05) {
          setStyle(el.markers[i], 'display', 'none')
          continue
        }
        setStyle(el.markers[i], 'display', 'block')
        el.markers[i].dataset.side = bot.team === player.team ? 'ally' : 'hostile'
        el.markers[i].dataset.leader = bot.id === leader ? 'on' : 'off'
        el.markers[i].dataset.shield = rules.contenders[bot.id].life === 'protected' ? 'on' : 'off'
        setStyle(el.markers[i], 'transform', `translate(${(((screen.x + 1) / 2) * innerWidth).toFixed(1)}px, ${(((1 - screen.y) / 2) * innerHeight).toFixed(1)}px)`)
        setStyle(el.markerHealth[i], 'width', `${(bot.health / bot.maxHealth) * 100}%`)
      }

      // damage: red edges, an arc toward the shooter, a pulse when nearly dead
      const from = Math.atan2(feedback.damageFrom.x - player.position.x, feedback.damageFrom.z - player.position.z)
      setStyle(el.hitFrom, 'transform', `rotate(${(-wrap(from - yaw)).toFixed(3)}rad)`)
      fade(el.hitFrom, feedback.damage)
      const critical = player.alive && health <= 30 ? 0.3 + 0.15 * Math.sin(now / 160) : 0
      fade(el.vignette, Math.max(feedback.damage * 0.5, critical, player.alive ? 0 : 0.6))

      setText(el.message, feedback.message)
      fade(el.message, Math.min(1, feedback.messageTime))
      fade(el.hint, match.locked() && match.elapsed > 8 ? 0 : 1)
      fade(el.stuck, match.phase === 'playing' && player.alive && player.stuck > 1 && player.recovery <= 0 ? 1 : 0) // it recovers by itself at 4 s

      // the scoreboard: held Tab, in play or while down; it shows by itself while the player is down
      const dead = match.phase === 'destroyed'
      const scores = (scoresOpen || dead) && (match.phase === 'playing' || match.phase === 'destroyed')
      setStyle(el.scores, 'display', scores ? 'block' : 'none')
      el.scores.dataset.dead = dead ? 'on' : 'off'
      if (scores) drawScores(el, match, ranked, dead)

      frames++
      setStyle(el.fps, 'display', settings.showFps ? 'block' : 'none')
      setStyle(el.debug, 'display', settings.debug ? 'block' : 'none')
      if (now - sampleAt < 250) return
      const fps = Math.round((frames * 1000) / (now - sampleAt))
      frames = 0
      sampleAt = now
      setText(el.fps, `${fps} FPS`)
      if (settings.debug) el.debug.textContent = [`FPS      ${fps}`, ...match.debug()].join('\n')
    },
  }
}

// Online: the people in the room, the player among them.
function peopleLine({ people }: Match) {
  const n = people.filter(Boolean).length
  return n === 1 ? 'Just you and bots' : `${n} players`
}

// Free for all: where the player stands against the lead.
function leadLine({ combatants, player }: Match, ffa: FreeForAll) {
  const order = ffa.standings()
  const first = combatants[order[0]]
  const mine = player.stats.kills
  if (mine < first.stats.kills) return `${first.name} +${first.stats.kills - mine}`
  const next = combatants[order[0] === player.id ? order[1] : order[0]].stats.kills
  return mine > next ? `You lead +${mine - next}` : 'Tied for the lead'
}

// Free for all: the top four, the last row giving way to the player's own place if lower.
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

// Every machine in order: free for all by its standings; team deathmatch the
// player's team, then the enemy's, each under a header with its kills and
// ranked by combat score, kills, assists, fewer deaths. Wrecks are dimmed; free for all marks the sole leader and the
// player's nemesis. `dead`: headed by who wrecked the player and the wait.
function drawScores(el: ReturnType<typeof collect>, match: Match, ranked: Combatant[], dead: boolean) {
  const { mode, player, combatants } = match
  const ffa = mode.kind === 'ffa' ? mode.rules : null
  const tdm = mode.kind === 'tdm' ? mode.rules : null
  ranked.length = 0
  if (ffa) for (const i of ffa.standings()) ranked.push(combatants[i])
  else if (tdm) {
    for (const i of tdm.standings()) ranked.push(combatants[i])
    ranked.sort((a, b) => +(a.team !== player.team) - +(b.team !== player.team)) // stable: each team keeps its order
  }
  el.scores.dataset.mode = mode.kind
  el.scores.dataset.tk = tdm?.settings.friendlyFire ? 'on' : 'off' // information, never a score
  setText(el.scoresMode, dead ? (tdm ? 'Wrecked' : 'Destroyed') : MODES[mode.kind].label)
  if (dead) {
    const left = match.respawnIn()
    setText(el.scoresKiller, `${tdm ? 'by' : 'Wrecked by'} ${match.feedback.killer}`)
    setText(el.scoresRespawn, left < Infinity ? `${tdm ? 'Respawning in' : 'Back in'} ${Math.ceil(left)}` : '')
  }
  const teams = tdm ? ` · ${TEAMS[0]} ${tdm.score[0]} : ${tdm.score[1]} ${TEAMS[1]}` : ''
  setText(el.scoresInfo, `${match.arena.name}${teams}${match.online ? ` · ${peopleLine(match)}` : ''} · ${el.clockLabel.textContent} ${el.clock.textContent}`)
  const leader = ffa ? ffa.soleLeader() : -1
  const nemesis = ffa ? ffa.nemesisOf(player.id) : -1
  let place = 0
  for (let k = 0; k < el.scoresRows.length; k++) {
    const row = el.scoresRows[k]
    const c = ranked[k]
    const heads = !!tdm && !!c && (k === 0 || ranked[k - 1].team !== c.team) // a team starts: its header, its own ranking
    setStyle(el.scoresTeam[k], 'display', heads ? 'table-row' : 'none')
    setStyle(row, 'display', c ? 'table-row' : 'none')
    if (!c) continue
    if (heads) {
      el.scoresTeam[k].dataset.side = c.team === player.team ? 'ally' : 'hostile'
      setText(el.scoresTeamName[k], TEAMS[c.team])
      setText(el.scoresTeamKills[k], `${tdm.score[c.team]} ${tdm.score[c.team] === 1 ? 'kill' : 'kills'}`)
    }
    place = heads ? 1 : place + 1
    row.dataset.side = c === player ? 'self' : c.team === player.team ? 'ally' : 'hostile'
    row.dataset.down = c.alive ? 'off' : 'on'
    row.dataset.leader = c.id === leader ? 'on' : 'off'
    row.dataset.nemesis = c.id === nemesis ? 'on' : 'off'
    row.dataset.bot = match.online && !match.people[c.id] ? 'on' : 'off' // online: who isn't a person
    setText(el.scoresPlace[k], String(place))
    setText(el.scoresName[k], c === player ? 'You' : c.name)
    setText(el.scoresKills[k], String(c.stats.kills))
    setText(el.scoresDeaths[k], String(c.stats.deaths))
    setText(el.scoresAssists[k], String(c.stats.assists))
    setText(el.scoresStreak[k], String(c.stats.streak))
    setText(el.scoresDamage[k], Math.round(c.stats.damageDealt).toLocaleString('en-US'))
    setText(el.scoresScore[k], Math.round(c.stats.combatScore).toLocaleString('en-US'))
    setText(el.scoresTK[k], String(c.stats.teamKills))
  }
}
