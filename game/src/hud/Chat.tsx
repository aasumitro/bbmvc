import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Chat, ChatKind } from '../net/chat.ts'
import { CHAT_LIMIT } from '../net/chatCommand.ts'
import { useClock } from '../screens/hooks.ts'

// The match chat (net/chat.ts), online only: its last lines at the left
// edge above the speedometer, each fading 10 s after it came. Enter opens a
// line to everyone, T to the team (team deathmatch; Tab switches while
// typing), Enter sends, Esc lets it go. While the line is open the keys are
// the chat's — the game hears none of them, so typing never drives — and the
// mouse is free; sending gives the game the mouse back (Esc or a click on the
// arena does too, the click as it always does). Docked in a custom lobby's
// waiting room instead: its lines stay, and T opens the line (Enter is Ready
// there).

const FRESH = 10_000 // ms a line stays up while the chat line is closed
const SHOWN = { closed: 6, open: 12 } // lines at most
const TAGS: Record<ChatKind, string> = { all: '', team: '[Team] ', from: '[From] ', to: '[To] ', note: '' }
const TONES: Record<ChatKind, string> = {
  all: 'text-[#f2ece0]',
  team: 'text-sky-300',
  from: 'text-fuchsia-300',
  to: 'text-fuchsia-300/80',
  note: 'text-neutral-400 italic',
}

interface ChatBoxProps {
  chat: Chat
  onTyping?: (typing: boolean, sent?: boolean) => void
  docked?: boolean // in the page's flow (the waiting room), not over the arena
}

// Up while the match is being played (GameCanvas takes it away under a menu or the results).
export function ChatBox({ chat, onTyping = () => {}, docked = false }: ChatBoxProps) {
  useSyncExternalStore(chat.subscribe, chat.version)
  const [to, setTo] = useState<'all' | 'team' | null>(null) // the open line, and whom it goes to
  const [text, setText] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const now = useClock(!docked, 500)
  const shown = to || docked ? chat.lines.slice(-SHOWN.open) : chat.lines.filter((line) => now - line.at < FRESH).slice(-SHOWN.closed)

  function open(kind: 'all' | 'team') {
    setTo(kind)
    onTyping(true)
  }
  function close(sent: boolean) {
    setTo(null)
    setText('')
    onTyping(false, sent)
  }

  useEffect(() => {
    if (to) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return
      if (docked) {
        if (e.code !== 'KeyT') return
        e.preventDefault()
        open('all')
      } else if (e.key === 'Enter') {
        e.preventDefault()
        open('all')
      } else if (e.code === 'KeyT' && chat.team) {
        e.preventDefault()
        open('team')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })
  useEffect(() => {
    if (to) field.current?.focus()
  }, [to])

  return (
    <div
      className={`text-[0.78rem] leading-snug font-semibold [text-shadow:0_1px_3px_rgba(0,0,0,0.9)] ${docked ? 'flex h-full flex-col' : 'pointer-events-none fixed bottom-[calc(2.6vh+clamp(150px,13vw,240px)+2vh)] left-[2vw] z-5 w-[min(36vw,460px)]'}`}
    >
      <ol
        aria-live="polite"
        aria-label={docked ? 'Lobby chat' : 'Match chat'}
        className={`flex flex-col gap-0.5 ${to ? 'rounded bg-black/45 p-2 backdrop-blur-xs' : ''} ${docked ? 'min-h-0 flex-1 overflow-y-auto' : ''}`}
      >
        {shown.map((line) => (
          <li key={line.id} className={`wrap-break-word ${TONES[line.kind]}`}>
            {TAGS[line.kind]}
            {line.who && <span className="font-extrabold">{line.who}: </span>}
            {line.text}
          </li>
        ))}
      </ol>
      {docked && !to && (
        <button
          onClick={() => open('all')}
          className="mt-1.5 flex w-full items-center gap-2 rounded border border-white/15 bg-black/40 px-2 py-1.5 text-left text-neutral-500 hover:border-white/30"
        >
          <span className="rounded border border-neutral-500/50 px-1.5 text-[0.62rem] text-neutral-400">T</span>
          Say something to the lobby
        </button>
      )}
      {to && (
        <label className="pointer-events-auto mt-1.5 flex items-center gap-2 rounded border border-white/20 bg-black/70 px-2 py-1.5 backdrop-blur-xs">
          <span className={`text-[0.62rem] font-bold tracking-[0.2em] uppercase ${to === 'team' ? 'text-sky-300' : 'text-red-400'}`}>
            {to === 'team' ? 'Team' : 'All'}
          </span>
          <input
            ref={field}
            type="text"
            value={text}
            maxLength={CHAT_LIMIT}
            aria-label={to === 'team' ? 'Message to your team' : 'Message to everyone'}
            placeholder="Say something · /w name to whisper"
            onChange={(e) => setText(e.target.value)}
            onBlur={() => close(false)}
            onKeyDown={(e) => {
              e.stopPropagation() // the chat's keys: nothing in the game hears them
              if (e.key === 'Enter') {
                e.preventDefault()
                const typed = text
                close(true)
                void chat.send(typed, to)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close(false)
              } else if (e.key === 'Tab' && chat.team) {
                e.preventDefault()
                setTo(to === 'all' ? 'team' : 'all')
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[#f2ece0] outline-hidden placeholder:text-neutral-500"
          />
        </label>
      )}
    </div>
  )
}
