import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { runTasks, STARTUP, type Progress, type Task } from '../runtime/loading.ts'
import { ActionButton } from './Menu.tsx'

interface LoadingProps {
  onDone: () => void
}

// The first screen. It stays up while the startup tasks (runtime/loading.ts)
// run: the bar is the share of them finished, the line under it the one
// running. The menu opens when the last one finishes. A failure stops it
// there and says what failed; Retry (Enter) runs the list again.
export function Loading({ onDone }: LoadingProps) {
  const [progress, setProgress] = useState<Progress>({ done: 0, total: STARTUP.length, label: STARTUP[0].label })
  const [failed, setFailed] = useState<Task | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    let at = 0 // the task running
    runTasks(
      STARTUP,
      (next) => {
        at = next.done
        if (live) flushSync(() => setProgress(next)) // on screen before the task starts
      },
      () => !live,
    ).then(
      (finished) => {
        if (live && finished) onDone()
      },
      (error: unknown) => {
        console.error(`Startup failed at "${STARTUP[at].label}":`, error)
        if (live) setFailed(STARTUP[at])
      },
    )
    return () => {
      live = false
    }
  }, [attempt, onDone])

  useEffect(() => {
    if (!failed) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      e.preventDefault() // no second press through a focused button
      setFailed(null)
      setAttempt((n) => n + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [failed])

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-8 bg-cover bg-center text-[#f2ece0] before:absolute before:inset-0 before:bg-black/55 before:content-['']"
      style={{ backgroundImage: `url('${import.meta.env.BASE_URL}bg/loading.jpg')` }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="relative text-red-500">
        <path d="M12 2 L14 9 L21 9 L15.5 13.5 L17.5 21 L12 16.5 L6.5 21 L8.5 13.5 L3 9 L10 9 Z" stroke="currentColor" strokeWidth="1" />
      </svg>

      <div className="relative text-center">
        <h1 className="m-0 font-display text-6xl font-semibold tracking-wider drop-shadow-[0_0_32px_rgba(220,38,38,0.5)] sm:text-7xl">Scrapyard</h1>
        <p className="mt-3 font-display text-lg text-red-400/90 italic">Car Battle</p>
      </div>

      <div className="relative w-[70vw] max-w-105">
        <div
          role="progressbar"
          aria-label="Loading"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-valuetext={progress.label}
          className="h-px overflow-hidden bg-white/15"
        >
          <div
            className="h-full bg-linear-to-r from-red-700 via-red-500 to-orange-400 shadow-[0_0_10px_rgba(239,68,68,0.8)] transition-[width] duration-150 ease-linear"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
        {failed ? (
          <div role="alert" className="mt-4 text-center">
            <p className="font-sans text-xs tracking-[0.3em] text-red-400 uppercase">{failed.label} failed</p>
            {failed.hint && <p className="mt-2 font-display text-sm text-neutral-300 italic">{failed.hint}</p>}
            <ActionButton
              primary
              title="Retry"
              line="Try starting again"
              onClick={() => {
                setFailed(null)
                setAttempt((n) => n + 1)
              }}
              className="mt-6 w-full"
            />
          </div>
        ) : (
          <p className="mt-4 text-center font-sans text-xs tracking-[0.3em] text-neutral-400 uppercase">{progress.label}</p>
        )}
      </div>
    </div>
  )
}
