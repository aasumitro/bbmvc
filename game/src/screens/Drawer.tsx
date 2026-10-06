import { useCallback, useEffect, useState, type ReactNode } from 'react'

interface DrawerProps {
  kicker: string
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode // actions at the right of the Esc · Back bar, always in view
}

const CLOSE_DURATION_MS = 300

export function Drawer({ kicker, title, onClose, children, footer }: DrawerProps) {
  const [open, setOpen] = useState(false)

  const close = useCallback(() => {
    setOpen(false)
    setTimeout(onClose, CLOSE_DURATION_MS)
  }, [onClose])

  // Slides in once: a parent's re-render (a new onClose) mustn't slide a closing drawer back.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  return (
    <div className="fixed inset-0 z-10">
      <button aria-label="Close" onClick={close} className="absolute inset-0 cursor-default" />
      <div
        className={`absolute inset-y-0 right-0 flex w-[36vw] min-w-[380px] max-w-[540px] flex-col border-l border-white/10 bg-[#12161f]/95 text-[#f2ece0] shadow-[-20px_0_60px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex-1 overflow-y-auto px-10 py-10">
          <p className="text-xs font-bold tracking-[0.25em] text-red-400/90 uppercase">{kicker}</p>
          <h2 className="m-0 mt-1 font-display text-4xl font-semibold">{title}</h2>
          <div className="mt-8">{children}</div>
        </div>
        <div className="flex items-center gap-4 border-t border-white/10 px-10 py-5 font-sans text-xs tracking-[0.1em] text-neutral-400 uppercase">
          <span className="rounded border border-neutral-500/50 px-1.5 py-0.5">Esc</span>
          <span>Back</span>
          {footer && <span className="ml-auto">{footer}</span>}
        </div>
      </div>
    </div>
  )
}
