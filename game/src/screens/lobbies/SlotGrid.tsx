import { DIFFICULTIES, type Difficulty } from '../../sim/difficulty.ts'
import { botName } from '../../modes/roster.ts'
import { TEAMS } from '../../modes/tdm/config.ts'
import { sideOf } from '../../modes/traits.ts'
import { ask } from '../../net/lobbies.ts'
import type { LobbySlot, LobbyView } from '../../net/lobbyProtocol.ts'
import { Avatar, Robot } from '../Avatar.tsx'
import { label, modeOf, traitsOf } from './kit.ts'

// The waiting room's slots (Lobby.tsx): how many are in, the two sides'
// columns (a team mode) or two halves, each slot's person, bot or opening,
// ready or not, and its menu: add a bot, copy the invite, remove a bot,
// make owner, kick (the owner's); a member claims an open slot on the
// other side by pressing it.

const SKILLS = Object.keys(DIFFICULTIES) as Difficulty[]

interface SlotGridProps {
  lobby: LobbyView
  owner: boolean // the player owns the lobby
  menu: number // the slot whose menu is open; -1 none
  onMenu: (slot: number) => void
  onCopy: () => void // the invite link to the clipboard
}

export function SlotGrid({ lobby, owner, menu, onMenu: setMenu, onCopy: copy }: SlotGridProps) {
  const waiting = lobby.phase === 'waiting'
  const teams = traitsOf(lobby).teams
  const half = teams ? lobby.size / 2 : Math.ceil(lobby.size / 2)
  const people = lobby.slots.filter((slot) => slot.kind === 'person').length

  function slotRow(slot: LobbySlot, i: number) {
    const mine = i === lobby.you
    const claim = slot.kind === 'empty' && teams && waiting ? () => ask({ t: 'lb', do: 'slot', slot: i }) : undefined
    const menuItems: Array<{ label: string; act: () => void }> =
      slot.kind === 'empty'
        ? [
            ...(owner && waiting
              ? SKILLS.map((skill) => ({ label: `Add bot · ${DIFFICULTIES[skill].label}`, act: () => ask({ t: 'lb', do: 'bot', slot: i, skill }) }))
              : []),
            { label: 'Copy invite link', act: copy },
          ]
        : !owner || mine
          ? []
          : slot.kind === 'bot'
            ? waiting
              ? [{ label: 'Remove bot', act: () => ask({ t: 'lb', do: 'unbot', slot: i }) }]
              : []
            : [
                { label: 'Make owner', act: () => ask({ t: 'lb', do: 'owner', uid: slot.uid }) },
                { label: 'Kick', act: () => ask({ t: 'lb', do: 'kick', uid: slot.uid }) },
              ]
    return (
      <li key={i} className={`relative flex h-10 items-center gap-3 border-b border-white/5 px-3 ${mine ? 'bg-red-500/8' : ''}`}>
        {slot.kind === 'person' ? (
          <Avatar uid={slot.uid} className="h-8 w-8" />
        ) : slot.kind === 'bot' ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-white/5 text-neutral-300">
            <Robot className="h-6 w-6" />
          </span>
        ) : (
          <span className="h-8 w-8 rounded-sm border border-dashed border-white/20" />
        )}
        {slot.kind === 'empty' ? (
          <button
            onClick={claim}
            disabled={!claim}
            className="group/slot min-w-0 flex-1 text-left font-display text-sm text-neutral-500 italic enabled:hover:text-neutral-200 disabled:cursor-default"
          >
            Open slot
            {claim && (
              <span className="ml-2 text-[0.6rem] font-bold tracking-[0.2em] uppercase not-italic opacity-0 group-hover/slot:opacity-100">Move here</span>
            )}
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-bold">{slot.kind === 'person' ? slot.name : botName(i)}</span>
            {slot.kind === 'person' && slot.owner && <Crown />}
            {mine && <span className="text-[0.6rem] font-bold tracking-[0.2em] text-neutral-400 uppercase">You</span>}
            {slot.kind === 'bot' && (
              <span className="text-[0.6rem] font-bold tracking-[0.2em] text-neutral-400 uppercase">Bot · {DIFFICULTIES[slot.skill].label}</span>
            )}
          </span>
        )}
        {slot.kind === 'person' && (
          <span
            className={`text-[0.6rem] font-bold tracking-[0.2em] uppercase ${slot.away ? 'text-amber-300' : slot.owner ? 'text-neutral-400' : slot.ready ? 'text-emerald-400' : 'text-neutral-500'}`}
          >
            {slot.away ? 'Away' : slot.owner ? 'Host' : slot.ready ? 'Ready' : 'Not ready'}
          </span>
        )}
        {menuItems.length > 0 && (
          <button
            data-menu
            onClick={() => setMenu(menu === i ? -1 : i)}
            aria-label={slot.kind === 'empty' ? 'Add to this slot' : 'More'}
            aria-expanded={menu === i}
            className="flex h-7 w-7 items-center justify-center rounded text-lg text-neutral-400 hover:bg-white/10 hover:text-white"
          >
            {slot.kind === 'empty' ? '+' : '⋯'}
          </button>
        )}
        {menu === i && (
          <ul
            data-menu
            role="menu"
            className="absolute top-11 right-2 z-20 min-w-44 border border-white/10 bg-[#12161f] py-1 shadow-[0_12px_40px_rgba(0,0,0,0.6)]"
          >
            {menuItems.map((item) => (
              <li key={item.label}>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(-1)
                    item.act()
                  }}
                  className={`w-full px-4 py-2 text-left text-xs font-bold tracking-[0.15em] uppercase hover:bg-white/10 ${item.label === 'Kick' ? 'text-red-400' : 'text-neutral-200'}`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </li>
    )
  }

  const columns = [lobby.slots.slice(0, half).map((slot, i) => slotRow(slot, i)), lobby.slots.slice(half).map((slot, i) => slotRow(slot, half + i))]
  const count = (team: number) => lobby.slots.filter((slot, i) => slot.kind !== 'empty' && sideOf(modeOf(lobby), lobby.size, i) === team).length

  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className={label}>Players</span>
        <span className="text-sm font-bold tabular-nums">
          {people + lobby.bots} / {lobby.size}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {columns.map((rows, column) => (
          <div key={column} className="border border-white/10 bg-black/60">
            {teams && (
              <p
                className={`flex justify-between border-b border-white/10 px-3 py-1.5 text-[0.65rem] font-bold tracking-[0.3em] uppercase ${column ? 'text-red-400' : 'text-sky-300'}`}
              >
                {TEAMS[column]}
                <span className="text-neutral-400 tabular-nums">
                  {count(column)} / {half}
                </span>
              </p>
            )}
            <ol>{rows}</ol>
          </div>
        ))}
      </div>
    </>
  )
}

export function Crown() {
  return (
    <svg viewBox="0 0 16 10" aria-label="Owner" className="h-2.5 w-4 shrink-0 fill-amber-300">
      <path d="M1 10h14l1-8-4.5 3.2L8 0 4.5 5.2 0 2z" />
    </svg>
  )
}
