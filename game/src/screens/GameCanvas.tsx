import { useEffect, useMemo, useRef, useState } from 'react'
import type { Difficulty } from '../game/ai'
import { flushSync } from 'react-dom'
import { playSound } from '../game/audio'
import type { Progress } from '../game/loading'
import type { Loadout } from '../game/loadout'
import { MAPS, type MapId } from '../game/maps'
import type { Match, MatchPhase } from '../game/match'
import type { Mode } from '../game/modes'
import { startGame } from '../game/runtime'
import { createChat, type Chat } from '../net/chat'
import { NetError, type Link } from '../net/connection'
import { settings, updateSettings } from '../game/settings'
import { ChatBox } from '../hud/Chat'
import { Hud, type HudHandle } from '../hud/Hud'
import { Confirm } from './Confirm'
import { Drawer } from './Drawer'
import { ActionButton, Menu } from './Menu'
import { Results } from './Results'
import { useCustom } from './search'
import { RestoreDefaults, SettingsPanel } from './SettingsPanel'

interface GameCanvasProps {
  loadout: Loadout // from the garage
  mode: Mode
  map: MapId
  difficulty: Difficulty // the bots' (practice)
  link: Link | null // online: the seat matchmaking found (its room's arena and mode); null: practice
  onExit: () => void
}

// The gameplay screen. It starts the game runtime (game/runtime.ts) in its
// container and disposes it on the way out; React only re-renders here on
// the loading steps and on match phase changes (pause, destroyed, victory).
// The runtime's loop drives the simulation, camera, HUD and rendering every
// frame. Online, Esc opens a menu over a match that runs on, the results
// count down to the next match, and a lost connection says so; a failed
// start can't be retried (the seat is gone with it), only left. A custom
// lobby's match leaves for the lobby's waiting room instead (App moves there
// on the server's word).
export function GameCanvas({ loadout, mode, map, difficulty, link, onExit }: GameCanvasProps) {
  const online = link !== null
  const people = link?.welcome.lineUp.filter((seat) => seat.human).length ?? 0
  const custom = useCustom()
  const lobby = link?.welcome.lobby && custom.phase === 'seated' ? custom.lobby : null // a custom lobby's match: its lobby as it stands
  const containerRef = useRef<HTMLDivElement>(null)
  const hudRef = useRef<HudHandle>(null)
  const [match, setMatch] = useState<Match | null>(null)
  const [phase, setPhase] = useState<MatchPhase | 'loading'>('loading')
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 1, label: '' }) // the match's loading steps
  const [failed, setFailed] = useState<string | null>(null) // a loading step failed, the match can't start: why ('' when the console says)
  const [attempt, setAttempt] = useState(0) // Retry starts the whole loading again
  const [drawer, setDrawer] = useState<'settings' | null>(null) // over the pause menu
  const [scores, setScores] = useState(false) // Tab held: the HUD scoreboard
  const [leaving, setLeaving] = useState(false) // Exit to garage picked mid-match: asking to confirm
  const chatting = useRef(false) // the chat line is open: the mouse is free without pausing anything

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let mounted = true
    const game = startGame({
      container,
      loadout,
      mode,
      map,
      difficulty,
      link,
      onPhase: setPhase,
      onFrame: (match, camera) => hudRef.current?.update(match, camera),
      onProgress: (next) => flushSync(() => setProgress(next)), // on screen before the step starts
    })
    game.ready.then(
      (match) => {
        if (!mounted || !match) return
        setMatch(match)
        setPhase('playing')
      },
      (error: unknown) => {
        console.error('The match failed to start:', error)
        if (mounted) setFailed(error instanceof NetError ? error.message : '')
      },
    )
    return () => {
      mounted = false
      game.dispose()
    }
  }, [loadout, mode, map, difficulty, link, attempt])

  // Online: the match's chat (net/chat.ts), joined for as long as the match runs.
  const chat: Chat | null = useMemo(() => (link && match ? createChat(link.welcome.chat, { names: () => match.combatants.map((c) => c.name), uids: () => match.uids, me: () => match.player.id }) : null), [link, match])
  useEffect(() => {
    if (!chat) return
    chat.start()
    return () => chat.dispose()
  }, [chat])
  // The chat box is up while the match is played, not under a menu or the results.
  const chatActive = (phase === 'playing' || phase === 'destroyed') && !drawer && !leaving
  useEffect(() => {
    if (!chatActive) chatting.current = false
  }, [chatActive])

  // The chat line opens (the mouse and every held key let go: typing never
  // drives) and closes (a message sent gives the game the mouse back; Enter
  // may take it, Esc may not).
  const typing = (open: boolean, sent = false) => {
    chatting.current = open
    if (open) match?.unlock()
    else if (sent) match?.lock()
  }

  const retry = () => {
    setFailed(null)
    setMatch(null)
    setPhase('loading')
    setAttempt((n) => n + 1)
  }

  // A failed start: Enter tries again (practice; online it leaves), Esc goes back to the garage.
  useEffect(() => {
    if (failed === null) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      e.preventDefault() // no second press through a focused button
      if (e.key === 'Enter' && !online) retry()
      else onExit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [failed, online, onExit])

  // Discrete keys and pointer-lock loss. Esc exits pointer lock without a
  // keydown in most browsers, so losing the lock pauses too; the guard stops
  // a keydown that does arrive from immediately resuming. With a drawer open
  // Esc belongs to the drawer. Tab shows the scoreboard while held, in play
  // or while down; kept from moving focus out of the page, which would drop
  // the mouse and pause (in menus Tab still moves focus).
  useEffect(() => {
    if (!match) return
    let lockLostAt = 0
    function onKeyDown(e: KeyboardEvent) {
      if (!match) return
      if (e.code === 'F3') {
        e.preventDefault()
        updateSettings({ debug: !settings.debug })
      }
      if (e.code === 'Escape' && !drawer && !leaving && performance.now() - lockLostAt > 300) match.pause(match.phase !== 'paused') // the match decides where it can pause; the exit confirmation has its own Esc
      if (e.code === 'Tab' && (match.phase === 'playing' || match.phase === 'destroyed')) {
        e.preventDefault()
        setScores(true)
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Tab') setScores(false)
    }
    const hideScores = () => setScores(false)
    function onLockChange() {
      if (document.pointerLockElement || !match || chatting.current) return // the chat line took the mouse
      lockLostAt = performance.now()
      match.pause(true)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', hideScores)
    document.addEventListener('pointerlockchange', onLockChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', hideScores)
      document.removeEventListener('pointerlockchange', onLockChange)
    }
  }, [match, drawer, leaving])
  useEffect(() => hudRef.current?.scoreboard(scores), [scores])

  const resume = () => {
    match?.pause(false)
    match?.lock()
  }
  const restart = () => {
    match?.restart()
    match?.lock()
  }

  return (
    <>
      <div ref={containerRef} className="fixed inset-0 cursor-none bg-[#0b0908]" /> {/* the crosshair is the pointer */}
      <Hud ref={hudRef} />
      {chat && chatActive && <ChatBox chat={chat} onTyping={typing} />}
      {/* the match's loading: the bar is the share of steps finished, the line under it the one running */}
      {phase === 'loading' && (
        <div className="fixed inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-[#0b0908] text-[#f2ece0]">
          <p className="font-display text-3xl italic">{online ? 'Joining the match' : MAPS[map].arrival}</p>
          {online && <p className="-mt-3 text-xs font-bold tracking-[0.3em] text-neutral-400 uppercase">{`${MAPS[map].name} · ${people} ${people === 1 ? 'player' : 'players'}`}</p>}
          <div
            role="progressbar"
            aria-label="Loading the match"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-valuetext={progress.label}
            className="h-px w-56 overflow-hidden bg-white/15"
          >
            <div className="h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)] transition-[width] duration-150 ease-linear" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          {failed !== null ? (
            <div role="alert" className="flex w-[min(90vw,420px)] flex-col items-center text-center">
              <p className="text-xs tracking-[0.3em] text-red-400 uppercase">{progress.label} failed</p>
              <p className="mt-2 font-display text-sm text-neutral-300 italic">{failed || "The match couldn't start. The details are in the browser console."}</p>
              {!online && <ActionButton primary title="Retry" line="Try starting again" onClick={retry} className="mt-6 w-full" />}
              <ActionButton primary={online} title={link?.welcome.lobby ? 'Back to lobby' : 'Back to garage'} line="Leave this match" onClick={onExit} className={online ? 'mt-6 w-full' : 'mt-3 w-full'} />
            </div>
          ) : (
            <p className="text-xs tracking-[0.3em] text-neutral-400 uppercase">{progress.label}</p>
          )}
        </div>
      )}
      {phase === 'paused' &&
        (online ? (
          <MatchMenu
            kicker={`${MAPS[match?.map ?? map].name} · Online`}
            title="Match menu"
            line="The match goes on without a pause"
            escape="Back"
            inactive={drawer !== null || leaving}
            options={[
              { label: 'Back to the match', action: resume },
              { label: 'Settings', action: () => setDrawer('settings') },
              { label: link?.welcome.lobby ? 'Back to lobby' : 'Leave match', action: () => setLeaving(true) },
            ]}
          />
        ) : (
          <MatchMenu
            kicker={MAPS[map].name}
            title="Paused"
            escape="Resume"
            inactive={drawer !== null || leaving}
            options={[
              { label: 'Resume', action: resume }, // no restart: a match runs to the end
              { label: 'Settings', action: () => setDrawer('settings') },
              { label: 'Exit to garage', action: () => setLeaving(true) },
            ]}
          />
        ))}
      {phase === 'paused' && drawer === 'settings' && (
        <Drawer kicker={online ? 'Match menu' : 'Paused'} title="Settings" onClose={() => setDrawer(null)} footer={<RestoreDefaults />}>
          <SettingsPanel />
        </Drawer>
      )}
      {(phase === 'victory' || phase === 'defeat') && match && <Results match={match} lobby={lobby} onPlayAgain={restart} onExit={onExit} />}
      {phase === 'lost' && match && <Lost reason={match.lost} onExit={onExit} />}
      {/* leaving a match still in progress asks first; after the result it's a plain exit */}
      {leaving &&
        (link?.welcome.lobby ? (
          <Confirm title="Back to the lobby?" body="Your machine leaves the match; you stay in the lobby." confirm="Back to lobby" onConfirm={onExit} onCancel={() => setLeaving(false)} />
        ) : online ? (
          <Confirm title="Leave the match?" body="A bot takes your machine over." confirm="Leave match" onConfirm={onExit} onCancel={() => setLeaving(false)} />
        ) : (
          <Confirm title="Leave the match?" body="Your progress in this match will be lost." confirm="Exit to garage" onConfirm={onExit} onCancel={() => setLeaving(false)} />
        ))}
    </>
  )
}

// An online match's connection went: why, and the way out.
function Lost({ reason, onExit }: { reason: string; onExit: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      e.preventDefault()
      onExit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onExit])
  return (
    <div role="alertdialog" aria-labelledby="lost-title" className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 text-[#f2ece0]">
      <div className="flex w-[min(90vw,440px)] flex-col items-center border border-white/10 bg-[#12161f] px-9 py-8 text-center shadow-[0_24px_70px_rgba(0,0,0,0.65)]">
        <p className="text-xs font-bold tracking-[0.3em] text-red-400 uppercase">Online</p>
        <h2 id="lost-title" className="m-0 mt-2 font-display text-4xl font-semibold">
          Connection lost
        </h2>
        <p className="mt-3 font-display text-base text-neutral-300 italic">{reason}</p>
        <ActionButton primary title="Back to garage" line="Leave this match" onClick={onExit} className="mt-7 w-full" />
      </div>
    </div>
  )
}

interface MatchMenuProps {
  kicker: string
  title: string
  line?: string // italic, under the title
  escape?: string // what Esc does here, for the key hints
  inactive?: boolean // a drawer is open over it and takes the keys
  options: Array<{ label: string; action: () => void }>
}

const keycap = 'rounded border border-neutral-500/50 px-1.5 py-0.5'

// In-match menu over the dimmed arena, in the main menu's style: arrows or
// W/S choose, Enter or Space selects, the mouse works too.
function MatchMenu({ kicker, title, line, escape, inactive, options }: MatchMenuProps) {
  const [selected, setSelected] = useState(0)
  const choose = (i: number) => {
    playSound('ui')
    options[i].action()
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || inactive) return // a key still held from driving must not run through the menu
      if (e.code === 'ArrowDown' || e.code === 'KeyS') setSelected((i) => (i + 1) % options.length)
      if (e.code === 'ArrowUp' || e.code === 'KeyW') setSelected((i) => (i - 1 + options.length) % options.length)
      if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault() // no second press through a focused button
        choose(selected)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="fixed inset-0 z-10 flex items-center bg-gradient-to-r from-black/80 via-black/50 to-black/10 pl-[8vw] text-[#f2ece0]">
      <div>
        <p className="text-xs font-bold tracking-[0.3em] text-red-400/90 uppercase">{kicker}</p>
        <h2 className="m-0 mt-2 font-display text-6xl font-semibold tracking-[0.03em]">{title}</h2>
        {line && <p className="mt-2 font-display text-lg text-neutral-300 italic">{line}</p>}
        <Menu items={options} selected={selected} onSelect={setSelected} onActivate={choose} className="mt-9" />
        <div className="mt-10 flex items-center gap-4 text-xs tracking-[0.1em] text-neutral-400 uppercase">
          <span className={keycap}>&uarr;&darr;</span>
          <span>Choose</span>
          <span className={keycap}>Enter</span>
          <span>Select</span>
          {escape && (
            <>
              <span className={keycap}>Esc</span>
              <span>{escape}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
