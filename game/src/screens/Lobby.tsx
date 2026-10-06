import { useEffect, useMemo, useRef, useState } from 'react'
import { DIFFICULTIES, type Difficulty } from '../game/ai'
import { MAPS, type MapId } from '../game/maps'
import { ITEM_GROUPS, killLimitLabel, minutes, RESPAWN_LABELS, weaponsLabel } from '../game/matchSettings'
import { MODES, type Mode } from '../game/modes'
import { botName } from '../game/roster'
import { TEAMS } from '../game/tdm/config'
import { ChatBox } from '../hud/Chat'
import { createChat } from '../net/chat'
import { ask, currentCustom, type Custom } from '../net/custom'
import type { LobbySlot, LobbyView } from '../net/protocol'
import { Avatar, Robot } from './Avatar'
import { Confirm } from './Confirm'
import { Lock } from './Lobbies'
import { LobbyForm } from './LobbyForm'
import { useClock, waited } from './search'

type Person = Extract<LobbySlot, { kind: 'person' }>
type Waiting = Extract<Custom, { phase: 'lobby' }>

interface LobbyProps {
  custom: Waiting
  active: boolean // the keys are here
}

const SKILLS = Object.keys(DIFFICULTIES) as Difficulty[]
const keycap = 'rounded border border-neutral-500/50 px-1.5 py-0.5'
const label = 'text-[0.65rem] font-bold tracking-[0.3em] text-neutral-300 uppercase'
const PRIMARY = 'rounded border-2 border-red-500 bg-black/55 px-5 py-2.5 text-sm font-bold tracking-[0.15em] whitespace-nowrap text-white uppercase shadow-[0_0_18px_rgba(239,68,68,0.45)] hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none'
const SECONDARY = 'rounded border border-white/25 bg-black/55 px-4 py-2 text-xs font-bold tracking-[0.15em] whitespace-nowrap text-white uppercase hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-50'
const inviteLink = (code: string) => `${location.origin}${import.meta.env.BASE_URL}?join=${code}`
const people = (lobby: LobbyView) => lobby.slots.filter((slot): slot is Person => slot.kind === 'person')
const side = (lobby: LobbyView, slot: number) => (slot < lobby.size / 2 ? 0 : 1)
// The lobby as it stands now, for the chat's roster (read when the chat needs it).
function standing() {
  const now = currentCustom()
  return now.phase === 'lobby' || now.phase === 'seated' ? now.lobby : null
}

// Why the owner can't start yet ('' they can), as the server holds it
// (server/custom.ts): two people, everyone else ready and here, and in team
// deathmatch someone on each side. Never how many slots are open.
function startHint(lobby: LobbyView) {
  const all = people(lobby)
  const waiting = all.filter((p) => !p.owner && (!p.ready || p.away))
  const empty = lobby.mode === 'tdm' ? [0, 1].find((team) => !lobby.slots.some((slot, i) => slot.kind !== 'empty' && side(lobby, i) === team)) : undefined
  if (all.length < 2) return 'A match needs two people: invite someone'
  if (waiting.length) return `Waiting for ${waiting[0].name}${waiting.length > 1 ? ` and ${waiting.length - 1} more` : ''}`
  if (empty !== undefined) return `${TEAMS[empty]} has nobody: move there, or add a bot`
  return ''
}

// The lobby's wins so far (`won`: one more to count, the match just played): by side, or the top players.
export function Tally({ lobby, won }: { lobby: LobbyView; won?: string }) {
  const wins = (key: string) => (lobby.tally[key] ?? 0) + (key === won ? 1 : 0)
  if (lobby.mode === 'tdm')
    return (
      <p className="font-display text-xl tabular-nums">
        <span className="text-sky-300">{TEAMS[0]}</span> {wins('0')} — {wins('1')} <span className="text-red-400">{TEAMS[1]}</span>
      </p>
    )
  const named = lobby.slots
    .map((slot, i) => (slot.kind === 'person' ? { key: slot.uid, name: slot.name } : slot.kind === 'bot' ? { key: `bot:${i}`, name: botName(i) } : null))
    .filter((each) => each && wins(each.key) > 0)
    .map((each) => ({ name: each!.name, wins: wins(each!.key) }))
    .sort((a, b) => b.wins - a.wins)
  return <p className="font-display text-base text-neutral-200">{named.length ? named.slice(0, 4).map((each) => `${each.name} ${each.wins}`).join(' · ') : 'No wins yet'}</p>
}

// A custom lobby's waiting room (mockup 3): who's in which slot, ready or
// not; the owner's Start (from two people, all ready, however many slots
// are open) and the rest's Ready; the match's settings (the owner edits
// them in the drawer); the invite; the tally; the lobby's chat, which
// carries on into the match. While a match runs without the player: its
// time left, and Join match when the lobby lets people in mid-match.
// Nothing here changes before the server says so. Keys: Enter Ready (the
// owner: Start), T chat, Esc leave (asked first).
export function Lobby({ custom, active }: LobbyProps) {
  const { lobby } = custom
  const me = lobby.slots[lobby.you] as Person | undefined
  const owner = me?.owner ?? false
  const waiting = lobby.phase === 'waiting'
  const [menu, setMenu] = useState(-1) // the slot whose menu is open
  const [editing, setEditing] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const hint = startHint(lobby)
  const now = useClock(!waiting)
  const left = Math.max(0, lobby.left - (now - custom.at) / 1000)
  const half = lobby.mode === 'tdm' ? lobby.size / 2 : Math.ceil(lobby.size / 2)

  // The lobby's chat, the members its roster; notes for what changed.
  const chat = useMemo(
    () =>
      createChat(
        { all: lobby.chat, team: '' },
        {
          names: () => (standing()?.slots ?? []).map((slot, i) => (slot.kind === 'person' ? slot.name : slot.kind === 'bot' ? botName(i) : '')),
          uids: () => (standing()?.slots ?? []).map((slot) => (slot.kind === 'person' ? slot.uid : '')),
          me: () => standing()?.you ?? -1,
        },
      ),
    [lobby.chat],
  )
  const view = useRef(lobby) // the lobby as the chat's notes last saw it
  useEffect(() => {
    chat.start()
    return () => chat.dispose()
  }, [chat])
  useEffect(() => {
    const was = view.current
    view.current = lobby
    if (was === lobby) return
    const before = new Map(people(was).map((p) => [p.uid, p]))
    const after = new Map(people(lobby).map((p) => [p.uid, p]))
    for (const [uid, p] of after) if (!before.has(uid)) chat.note(`${p.name} joined`)
    for (const [uid, p] of before) if (!after.has(uid)) chat.note(`${p.name} left`)
    const boss = people(lobby).find((p) => p.owner)
    if (boss && before.has(boss.uid) && !before.get(boss.uid)!.owner) chat.note(`${boss.name} owns the lobby now`)
    const terms = (v: LobbyView) => JSON.stringify([v.name, v.open, v.mode, v.map, v.settings, v.jip, v.locked])
    if (terms(was) !== terms(lobby)) chat.note('The owner changed the lobby — everyone is unready')
    if (was.phase !== lobby.phase) chat.note(lobby.phase === 'playing' ? 'The match started' : 'The match is over')
  }, [lobby, chat])

  function primary() {
    if (!waiting) return
    if (owner) {
      if (!hint && custom.asked !== 'start') ask({ t: 'lb', do: 'start' })
    } else if (me) ask({ t: 'lb', do: 'ready', on: !me.ready })
  }
  function copy() {
    setMenu(-1)
    void navigator.clipboard.writeText(inviteLink(lobby.code)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // A slot's menu closes on a press anywhere else.
  useEffect(() => {
    if (menu < 0) return
    const close = (e: PointerEvent) => !(e.target instanceof Element && e.target.closest('[data-menu]')) && setMenu(-1)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  useEffect(() => {
    if (!active || editing || leaving) return // the drawer and the dialog take the keys
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') {
        if (menu >= 0) setMenu(-1)
        else setLeaving(true)
      } else if (e.key === 'Enter' && menu < 0) primary()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function slotRow(slot: LobbySlot, i: number) {
    const mine = i === lobby.you
    const claim = slot.kind === 'empty' && lobby.mode === 'tdm' && waiting ? () => ask({ t: 'lb', do: 'slot', slot: i }) : undefined
    const menuItems: Array<{ label: string; act: () => void }> =
      slot.kind === 'empty'
        ? [...(owner && waiting ? SKILLS.map((skill) => ({ label: `Add bot · ${DIFFICULTIES[skill].label}`, act: () => ask({ t: 'lb', do: 'bot', slot: i, skill }) })) : []), { label: 'Copy invite link', act: copy }]
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
      <li key={i} className={`relative flex h-10 items-center gap-3 border-b border-white/5 px-3 ${mine ? 'bg-red-500/[0.08]' : ''}`}>
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
          <button onClick={claim} disabled={!claim} className="group/slot min-w-0 flex-1 text-left font-display text-sm text-neutral-500 italic enabled:hover:text-neutral-200 disabled:cursor-default">
            Open slot{claim && <span className="ml-2 text-[0.6rem] font-bold tracking-[0.2em] not-italic uppercase opacity-0 group-hover/slot:opacity-100">Move here</span>}
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-bold">{slot.kind === 'person' ? slot.name : botName(i)}</span>
            {slot.kind === 'person' && slot.owner && <Crown />}
            {mine && <span className="text-[0.6rem] font-bold tracking-[0.2em] text-neutral-400 uppercase">You</span>}
            {slot.kind === 'bot' && <span className="text-[0.6rem] font-bold tracking-[0.2em] text-neutral-400 uppercase">Bot · {DIFFICULTIES[slot.skill].label}</span>}
          </span>
        )}
        {slot.kind === 'person' && (
          <span className={`text-[0.6rem] font-bold tracking-[0.2em] uppercase ${slot.away ? 'text-amber-300' : slot.owner ? 'text-neutral-400' : slot.ready ? 'text-emerald-400' : 'text-neutral-500'}`}>
            {slot.away ? 'Away' : slot.owner ? 'Host' : slot.ready ? 'Ready' : 'Not ready'}
          </span>
        )}
        {menuItems.length > 0 && (
          <button data-menu onClick={() => setMenu(menu === i ? -1 : i)} aria-label={slot.kind === 'empty' ? 'Add to this slot' : 'More'} aria-expanded={menu === i} className="flex h-7 w-7 items-center justify-center rounded text-lg text-neutral-400 hover:bg-white/10 hover:text-white">
            {slot.kind === 'empty' ? '+' : '⋯'}
          </button>
        )}
        {menu === i && (
          <ul data-menu role="menu" className="absolute top-11 right-2 z-20 min-w-44 border border-white/10 bg-[#12161f] py-1 shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
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
  const count = (team: number) => lobby.slots.filter((slot, i) => slot.kind !== 'empty' && side(lobby, i) === team).length
  const items = ITEM_GROUPS.filter(({ id }) => lobby.settings.items[id]).map((group) => group.label)
  const settingLines: Array<[string, string]> = [
    ['Mode', MODES[lobby.mode as Mode]?.label ?? lobby.mode],
    ['Players', lobby.mode === 'tdm' ? `${lobby.size / 2} v ${lobby.size / 2}` : `Up to ${lobby.size}`],
    ['Length', minutes(lobby.settings.duration)],
    ['Respawn', RESPAWN_LABELS[lobby.settings.respawn]],
    ...(lobby.mode === 'tdm' ? [['Friendly fire', lobby.settings.friendlyFire ? 'On' : 'Off'] as [string, string]] : []),
    ['Pickups', !items.length ? 'Off' : items.length === ITEM_GROUPS.length ? 'All' : items.join(', ')],
    ['Weapons', weaponsLabel(lobby.settings.weapons)],
    ['Kill limit', killLimitLabel(lobby.settings.killLimit)],
    ['Join in progress', lobby.jip ? 'On' : 'Off'],
  ]

  if (!me || me.kind !== 'person') return null

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.3em] text-red-400/90 uppercase">
            Waiting room · {lobby.open ? 'Public' : 'Invite only'}
            {lobby.locked && <Lock className="mb-0.5 ml-2 inline h-3 w-3" />}
          </p>
          <h2 className="m-0 mt-1 truncate font-display text-3xl font-semibold">{lobby.name}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 font-display text-base text-neutral-300 italic">
            Host: {lobby.host} <Crown />
          </p>
        </div>
        <button onClick={() => setLeaving(true)} className={SECONDARY}>
          Leave lobby
        </button>
      </header>

      <div className="mt-3 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_15rem] gap-4">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <span className={label}>Players</span>
            <span className="text-sm font-bold tabular-nums">
              {people(lobby).length + lobby.bots} / {lobby.size}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {columns.map((rows, column) => (
              <div key={column} className="border border-white/10 bg-black/60">
                {lobby.mode === 'tdm' && (
                  <p className={`flex justify-between border-b border-white/10 px-3 py-1.5 text-[0.65rem] font-bold tracking-[0.3em] uppercase ${column ? 'text-red-400' : 'text-sky-300'}`}>
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
          <div className="flex min-h-28 flex-1 flex-col border border-white/10 bg-black/55 p-3 backdrop-blur-md">
            <span className={label}>Chat</span>
            <div className="mt-2 min-h-0 flex-1">
              <ChatBox chat={chat} docked />
            </div>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col overflow-y-auto border border-white/10 bg-black/55 backdrop-blur-md">
          <div className="relative aspect-[2/1] shrink-0 overflow-hidden">
            <img src={MAPS[lobby.map as MapId]?.image} alt="" className="h-full w-full object-cover" />
            <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pt-6 pb-2 font-display text-xl font-semibold">{MAPS[lobby.map as MapId]?.name ?? lobby.map}</p>
          </div>
          <div className="flex items-center justify-between px-3 pt-3">
            <span className={label}>Match settings</span>
            {owner ? (
              <button onClick={() => setEditing(true)} disabled={!waiting} className="text-xs font-bold tracking-[0.15em] text-red-400 uppercase hover:text-red-300 disabled:opacity-40">
                Edit
              </button>
            ) : (
              <span title="Only the owner changes these" className="text-neutral-500">
                <Lock className="h-3 w-3 text-neutral-500" />
              </span>
            )}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-3 py-3 text-sm">
            {settingLines.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-neutral-400">{name}</dt>
                <dd className="text-right font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-white/10 px-3 py-3">
            <span className={label}>Invite</span>
            <p className="mt-1 font-mono text-xl tracking-[0.2em] text-[#f2ece0]">{`${lobby.code.slice(0, 4)}-${lobby.code.slice(4)}`}</p>
            <div className="mt-2 flex gap-2">
              <button onClick={copy} className={SECONDARY}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
              {owner && (
                <button onClick={() => ask({ t: 'lb', do: 'reset' })} title="A new code: the old link stops working" className={SECONDARY}>
                  Reset
                </button>
              )}
            </div>
          </div>
          <div className="border-t border-white/10 px-3 py-3">
            <span className={label}>Tally</span>
            <div className="mt-1">
              <Tally lobby={lobby} />
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-3 flex items-center gap-4 border border-white/10 bg-black/55 px-4 py-2.5 backdrop-blur-md">
        {!waiting ? (
          <>
            <p className="font-display text-base text-neutral-200 italic">
              Match in progress · <span className="tabular-nums">{waited(left * 1000)}</span> left
            </p>
            {lobby.jip && (
              <button onClick={() => ask({ t: 'lb', do: 'play' })} className={`ml-auto ${PRIMARY}`}>
                Join match
              </button>
            )}
          </>
        ) : (
          <>
            <p role="status" className={`font-display text-base italic ${custom.note ? 'text-red-300' : 'text-neutral-300'}`}>
              {custom.note || (owner ? hint || 'Everyone’s ready' : me.ready ? 'Ready — waiting for the owner to start' : 'Ready up when you are')}
            </p>
            {owner ? (
              <button onClick={primary} disabled={!!hint || custom.asked === 'start'} className={`ml-auto ${PRIMARY}`}>
                {custom.asked === 'start' ? 'Starting…' : 'Start match'}
              </button>
            ) : (
              <button onClick={primary} className={`ml-auto ${me.ready ? SECONDARY : PRIMARY}`}>
                {me.ready ? 'Not ready' : 'Ready'}
              </button>
            )}
          </>
        )}
      </div>

      {editing && <LobbyForm lobby={lobby} host={me.name} asked={custom.asked === 'edit'} onClose={() => setEditing(false)} />}
      {leaving && (
        <Confirm
          title="Leave the lobby?"
          body={!owner ? 'You can come back with the invite link, or from the list while there’s room.' : lobby.heir ? `${lobby.heir} becomes the owner.` : 'Nobody else is here: the lobby will be deleted.'}
          confirm={owner && !lobby.heir ? 'Delete lobby' : 'Leave lobby'}
          onConfirm={() => {
            setLeaving(false)
            ask({ t: 'lb', do: 'leave' })
          }}
          onCancel={() => setLeaving(false)}
        />
      )}

      {active && !editing && !leaving && (
        <div className="fixed bottom-8 left-[6vw] flex items-center gap-4 font-sans text-xs tracking-[0.1em] text-neutral-400 uppercase">
          {waiting && (
            <>
              <span className={keycap}>Enter</span>
              <span>{owner ? 'Start' : me.ready ? 'Not ready' : 'Ready'}</span>
            </>
          )}
          <span className={keycap}>T</span>
          <span>Chat</span>
          <span className={keycap}>Esc</span>
          <span>Leave</span>
        </div>
      )}
    </div>
  )
}

function Crown() {
  return (
    <svg viewBox="0 0 16 10" aria-label="Owner" className="h-2.5 w-4 shrink-0 fill-amber-300">
      <path d="M1 10h14l1-8-4.5 3.2L8 0 4.5 5.2 0 2z" />
    </svg>
  )
}
