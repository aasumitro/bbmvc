import { useEffect, useState } from 'react'
import { playSound } from '../view/audio.ts'
import { Menu } from './Menu.tsx'

// The menu over a match (GameCanvas.tsx): practice pauses (Resume, Settings,
// Exit to garage); online the match goes on behind it (Back to the match,
// Settings, Leave match, or Back to lobby in a lobby's match).

interface PauseMenuProps {
  online: boolean
  arena: string // its name
  lobby: boolean // a custom lobby's match
  inactive: boolean // a drawer or a dialog over it takes the keys
  onResume: () => void
  onSettings: () => void
  onLeave: () => void // asks first (ExitConfirm.tsx)
}

export function PauseMenu({ online, arena, lobby, inactive, onResume, onSettings, onLeave }: PauseMenuProps) {
  return online ? (
    <MatchMenu
      kicker={`${arena} · Online`}
      title="Match menu"
      line="The match goes on without a pause"
      escape="Back"
      inactive={inactive}
      options={[
        { label: 'Back to the match', action: onResume },
        { label: 'Settings', action: onSettings },
        { label: lobby ? 'Back to lobby' : 'Leave match', action: onLeave },
      ]}
    />
  ) : (
    <MatchMenu
      kicker={arena}
      title="Paused"
      escape="Resume"
      inactive={inactive}
      options={[
        { label: 'Resume', action: onResume }, // no restart: a match runs to the end
        { label: 'Settings', action: onSettings },
        { label: 'Exit to garage', action: onLeave },
      ]}
    />
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
    <div className="fixed inset-0 z-10 flex items-center bg-linear-to-r from-black/80 via-black/50 to-black/10 pl-[8vw] text-[#f2ece0]">
      <div>
        <p className="text-xs font-bold tracking-[0.3em] text-red-400/90 uppercase">{kicker}</p>
        <h2 className="m-0 mt-2 font-display text-6xl font-semibold tracking-[0.03em]">{title}</h2>
        {line && <p className="mt-2 font-display text-lg text-neutral-300 italic">{line}</p>}
        <Menu items={options} selected={selected} onSelect={setSelected} onActivate={choose} className="mt-9" />
        <div className="mt-10 flex items-center gap-4 text-xs tracking-widest text-neutral-400 uppercase">
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
