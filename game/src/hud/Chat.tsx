import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Chat, ChatKind } from '../net/chat'
import { CHAT_LIMIT } from '../net/chatCommand'
import { useClock } from '../screens/search'

// The match chat (net/chat.ts), online only: its last lines at the left
// edge above the speedometer, each fading 10 s after it came. Enter opens a
// line to everyone, T to the team (team deathmatch; Tab switches while
// typing), Enter sends, Esc lets it go. While the line is open the keys are
// the chat's — the game hears none of them, so typing never drives — and the
// mouse is free; sending gives the game the mouse back (Esc or a click on the
// arena does too, the click as it always does).

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
  onTyping: (typing: boolean, sent?: boolean) => void
}

// Up while the match is being played (GameCanvas takes it away under a menu or the results).
export function ChatBox({ chat, onTyping }: ChatBoxProps) {
  useSyncExternalStore(chat.subscribe, chat.version)
  const [to, setTo] = useState<'all' | 'team' | null>(null) // the open line, and whom it goes to
  const [text, setText] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const now = useClock(true, 500)
  const shown = to ? chat.lines.slice(-SHOWN.open) : chat.lines.filter((line) => now - line.at < FRESH).slice(-SHOWN.closed)

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
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Enter') {
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
    <div className="pointer-events-none fixed bottom-[calc(2.6vh+clamp(150px,13vw,240px)+2vh)] left-[2vw] z-[5] w-[min(36vw,460px)] text-[0.78rem] leading-snug font-semibold [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
      <ol aria-live="polite" aria-label="Match chat" className={`flex flex-col gap-0.5 ${to ? 'rounded bg-black/45 p-2 backdrop-blur-xs' : ''}`}>
        {shown.map((line) => (
          <li key={line.id} className={`break-words ${TONES[line.kind]}`}>
            {TAGS[line.kind]}
            {line.who && <span className="font-extrabold">{line.who}: </span>}
            {line.text}
          </li>
        ))}
      </ol>
      {to && (
        <label className="pointer-events-auto mt-1.5 flex items-center gap-2 rounded border border-white/20 bg-black/70 px-2 py-1.5 backdrop-blur-xs">
          <span className={`text-[0.62rem] font-bold tracking-[0.2em] uppercase ${to === 'team' ? 'text-sky-300' : 'text-red-400'}`}>{to === 'team' ? 'Team' : 'All'}</span>
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
