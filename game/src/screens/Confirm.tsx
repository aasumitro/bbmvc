import { useEffect, useState } from 'react'
import { playSound } from '../view/audio.ts'
import { Menu } from './Menu.tsx'

interface ConfirmProps {
  title: string
  body: string
  confirm: string // the action being confirmed, e.g. Exit to garage
  onConfirm: () => void
  onCancel: () => void
}

// A yes/no over everything else. The safe answer comes first and starts
// selected, so a second Enter from the menu underneath can't slip through;
// Esc or a click outside the box is the same as Stay.
export function Confirm({ title, body, confirm, onConfirm, onCancel }: ConfirmProps) {
  const [selected, setSelected] = useState(0) // 0: stay, 1: confirm
  const choose = (i: number) => {
    playSound('ui')
    if (i) onConfirm()
    else onCancel()
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat) return
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(e.code)) setSelected((i) => 1 - i)
      if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault() // no second press through a focused button
        choose(selected)
      }
      if (e.code === 'Escape') choose(0)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={onCancel}
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 text-[#f2ece0]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(90vw,460px)] border border-white/10 bg-[#12161f] px-9 py-8 shadow-[0_24px_70px_rgba(0,0,0,0.65)]"
      >
        <h2 id="confirm-title" className="m-0 font-display text-4xl font-semibold">
          {title}
        </h2>
        <p className="mt-3 font-display text-base text-neutral-300 italic">{body}</p>
        <Menu
          row
          items={[{ label: 'Stay' }, { label: confirm, danger: true }]}
          selected={selected}
          onSelect={setSelected}
          onActivate={choose}
          className="mt-8"
        />
        <div className="mt-8 flex items-center gap-4 text-xs tracking-widest text-neutral-400 uppercase">
          <span className={keycap}>&larr;&rarr;</span>
          <span>Choose</span>
          <span className={keycap}>Enter</span>
          <span>Select</span>
          <span className={keycap}>Esc</span>
          <span>Stay</span>
        </div>
      </div>
    </div>
  )
}

const keycap = 'rounded border border-neutral-500/50 px-1.5 py-0.5'
