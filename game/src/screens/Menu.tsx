import { Fragment, type ReactNode } from 'react'

// The game's shared controls, one look on every screen.

export interface MenuItem {
  label: string
  hint?: string // said beside the chosen entry; beside a disabled one always
  danger?: boolean // chosen, it reads red: a destructive answer
  disabled?: boolean // shown dimmed, never chosen (the screen's keys step over it)
}

interface MenuProps {
  items: MenuItem[]
  selected: number
  onSelect: (i: number) => void // pointed at or tabbed to
  onActivate: (i: number) => void // clicked
  row?: boolean // side by side (a dialog's answers): no bar
  className?: string
}

// A diamond per entry; the chosen one filled red, its label underlined, a
// red bar at its left in a column. Each screen keeps its own keys for moving
// the choice; pointing at an entry or tabbing to it chooses it too, so focus
// shows as the choice instead of a browser ring.
export function Menu({ items, selected, onSelect, onActivate, row = false, className = '' }: MenuProps) {
  return (
    <nav className={`flex font-sans ${row ? 'flex-wrap gap-x-10 gap-y-3' : 'flex-col gap-3'} ${className}`}>
      {items.map((item, i) => {
        const chosen = i === selected
        return (
          <button
            key={item.label}
            disabled={item.disabled}
            onClick={() => onActivate(i)}
            onMouseEnter={() => !item.disabled && onSelect(i)} // a disabled button still hears the mouse
            onFocus={() => onSelect(i)}
            className="group relative flex items-start gap-4 text-left disabled:cursor-not-allowed disabled:opacity-45"
          >
            {!row && <span className={`absolute top-2.5 -left-6 h-7 w-0.5 -translate-y-1/2 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] transition-opacity ${chosen ? 'opacity-100' : 'opacity-0'}`} />}
            <span className="flex h-5 w-3 shrink-0 items-center justify-center">
              <span className={chosen ? 'h-2.5 w-2.5 rotate-45 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)]' : 'h-2 w-2 rotate-45 border border-neutral-300/70'} />
            </span>
            <span className="flex items-baseline gap-3">
              <span className="flex flex-col gap-2">
                <span className={`text-sm font-bold tracking-[0.15em] whitespace-nowrap uppercase ${chosen ? (item.danger ? 'text-red-400' : 'text-white') : item.disabled ? 'text-neutral-400' : 'text-neutral-400 group-hover:text-neutral-200'}`}>{item.label}</span>
                <span className={`h-0.5 bg-red-500 transition-[width] duration-200 ${chosen ? 'w-1/2' : 'w-0'}`} />
              </span>
              {(chosen || item.disabled) && item.hint && <span className="font-display text-sm whitespace-nowrap text-neutral-400 italic">{item.hint}</span>}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

const chevron = (left: boolean, className = 'h-5 w-5') => (
  <svg viewBox="0 0 16 16" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={left ? 'm10 3-5 5 5 5' : 'm6 3 5 5-5 5'} />
  </svg>
)

const PAGE = 'flex h-10 w-12 items-center justify-center text-neutral-200 transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white active:bg-white/20'

// Previous / next through a set (arenas, weapons) in one frosted control; ←/→ do the same.
export function Pager({ what, onStep }: { what: string; onStep: (step: number) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-white/15 bg-black/45 backdrop-blur-md">
      <button onClick={() => onStep(-1)} aria-label={`Previous ${what}`} title={`Previous ${what} (←)`} className={PAGE}>
        {chevron(true)}
      </button>
      <span className="w-px bg-white/15" />
      <button onClick={() => onStep(1)} aria-label={`Next ${what}`} title={`Next ${what} (→)`} className={PAGE}>
        {chevron(false)}
      </button>
    </div>
  )
}

interface ActionButtonProps {
  title: string
  line: string // italic, under the title
  icon?: ReactNode
  onClick?: () => void // none: shown, but can't be picked yet
  primary?: boolean // red-framed: what Enter does
  note?: string // tooltip
  className?: string
}

// A screen's big call to action: title over an italic line, a chevron.
export function ActionButton({ title, line, icon, onClick, primary, note, className = '' }: ActionButtonProps) {
  const look = primary ? 'border-2 border-red-500 shadow-[0_0_18px_rgba(239,68,68,0.45)] hover:bg-black/70 focus-visible:bg-black/70' : 'border border-white/25'
  return (
    <button onClick={onClick} disabled={!onClick} title={note} className={`flex items-center gap-5 rounded bg-black/55 px-5 py-3.5 text-left text-white disabled:cursor-not-allowed disabled:opacity-60 ${look} ${className}`}>
      {icon}
      <span>
        <span className="block text-base font-bold tracking-[0.12em] uppercase">{title}</span>
        <span className="block font-display text-sm text-neutral-300 italic">{line}</span>
      </span>
      {chevron(false, 'ml-auto h-5 w-5')}
    </button>
  )
}

interface SegmentedProps<T> {
  label: string // what it chooses, for screen readers
  options: ReadonlyArray<{ id: T; label: string }>
  value: T
  onChange: (id: T) => void
  focused?: boolean // the keys are on it: a red frame
  disabled?: boolean
}

// One of a few, side by side in one frosted frame: the practice bots, a lobby's settings.
export function Segmented<T extends string | number | boolean>({ label, options, value, onChange, focused, disabled }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex w-fit overflow-hidden rounded-md border bg-black/45 backdrop-blur-md ${focused ? 'border-red-500' : 'border-white/15'}`}>
      {options.map((option, i) => (
        <Fragment key={String(option.id)}>
          {i > 0 && <span className="w-px bg-white/15" />}
          <button
            type="button" // inside a form (the lobby drawer) a choice isn't a submit
            role="radio"
            aria-checked={option.id === value}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={`px-4 py-1.5 text-xs font-bold tracking-[0.2em] whitespace-nowrap uppercase disabled:cursor-not-allowed disabled:opacity-50 ${option.id === value ? 'bg-red-500/30 text-white' : 'text-neutral-400 enabled:hover:text-white'}`}
          >
            {option.label}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
