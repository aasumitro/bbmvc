import { useEffect, useMemo, useRef, useState } from 'react'
import { botName } from '../../modes/roster.ts'
import { TEAMS } from '../../modes/tdm/config.ts'
import { ChatBox } from '../../hud/Chat.tsx'
import { createChat } from '../../net/chat.ts'
import { ask, currentCustom, type Custom } from '../../net/lobbies.ts'
import { emptySide, startable } from '../../net/lobbyRules.ts'
import type { LobbySlot, LobbyView } from '../../net/lobbyProtocol.ts'
import { Confirm } from '../Confirm.tsx'
import { Lock } from './Lobbies.tsx'
import { LobbyForm } from './LobbyForm.tsx'
import { InviteCard } from './InviteCard.tsx'
import { keycap, label, modeOf, PRIMARY, SECONDARY, traitsOf } from './kit.ts'
import { SettingsCard } from './SettingsCard.tsx'
import { Crown, SlotGrid } from './SlotGrid.tsx'
import { useClock, waited } from '../hooks.ts'

type Person = Extract<LobbySlot, { kind: 'person' }>
type Waiting = Extract<Custom, { phase: 'lobby' }>

interface LobbyProps {
  custom: Waiting
  active: boolean // the keys are here
}

const inviteLink = (code: string) => `${location.origin}${import.meta.env.BASE_URL}?join=${code}`
const people = (lobby: LobbyView) => lobby.slots.filter((slot): slot is Person => slot.kind === 'person')
// The lobby as it stands now, for the chat's roster (read when the chat needs it).
function standing() {
  const now = currentCustom()
  return now.phase === 'lobby' || now.phase === 'seated' ? now.lobby : null
}

// Why the owner can't start yet ('' they can), as the server holds it
// (net/lobbyRules.ts): two people, everyone else ready and here, and in a
// team mode someone on each side. Never how many slots are open.
function startHint(lobby: LobbyView) {
  const all = people(lobby)
  const waiting = all.filter((p) => !p.owner && (!p.ready || p.away))
  const mode = modeOf(lobby)
  switch (startable({ mode, size: lobby.size, slots: lobby.slots, people: all.length, waiting: waiting.length })) {
    case 'alone':
      return 'A match needs two people: invite someone'
    case 'waiting':
      return `Waiting for ${waiting[0].name}${waiting.length > 1 ? ` and ${waiting.length - 1} more` : ''}`
    case 'sides':
      return `${TEAMS[emptySide(mode, lobby.size, lobby.slots)]} has nobody: move there, or add a bot`
    case '':
      return ''
  }
}

// The lobby's wins so far (`won`: one more to count, the match just played): by side, or the top players.
export function Tally({ lobby, won }: { lobby: LobbyView; won?: string }) {
  const wins = (key: string) => (lobby.tally[key] ?? 0) + (key === won ? 1 : 0)
  if (traitsOf(lobby).teams)
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
  return (
    <p className="font-display text-base text-neutral-200">
      {named.length
        ? named
            .slice(0, 4)
            .map((each) => `${each.name} ${each.wins}`)
            .join(' · ')
        : 'No wins yet'}
    </p>
  )
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
          <SlotGrid lobby={lobby} owner={owner} menu={menu} onMenu={setMenu} onCopy={copy} />
          <div className="flex min-h-28 flex-1 flex-col border border-white/10 bg-black/55 p-3 backdrop-blur-md">
            <span className={label}>Chat</span>
            <div className="mt-2 min-h-0 flex-1">
              <ChatBox chat={chat} docked />
            </div>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col overflow-y-auto border border-white/10 bg-black/55 backdrop-blur-md">
          <SettingsCard lobby={lobby} owner={owner} onEdit={() => setEditing(true)} />
          <InviteCard lobby={lobby} owner={owner} copied={copied} onCopy={copy} />
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
          body={
            !owner
              ? 'You can come back with the invite link, or from the list while there’s room.'
              : lobby.heir
                ? `${lobby.heir} becomes the owner.`
                : 'Nobody else is here: the lobby will be deleted.'
          }
          confirm={owner && !lobby.heir ? 'Delete lobby' : 'Leave lobby'}
          onConfirm={() => {
            setLeaving(false)
            ask({ t: 'lb', do: 'leave' })
          }}
          onCancel={() => setLeaving(false)}
        />
      )}

      {active && !editing && !leaving && (
        <div className="fixed bottom-8 left-[6vw] flex items-center gap-4 font-sans text-xs tracking-widest text-neutral-400 uppercase">
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
