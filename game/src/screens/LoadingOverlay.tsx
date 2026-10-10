import { MAPS, type MapId } from '../content/arenas/maps.ts'
import type { Progress } from '../runtime/loading.ts'
import { ActionButton } from './Menu.tsx'

// The match's loading (GameCanvas.tsx): the bar is the share of steps
// finished, the line under it the one running; a failed step says why and
// offers Retry (practice) and the way out.

interface LoadingOverlayProps {
  online: boolean
  map: MapId
  people: number // online: the room's people
  progress: Progress
  failed: string | null // why a step failed ('' when the console says); null while it runs
  back: string // the way out's title
  onRetry: () => void
  onExit: () => void
}

export function LoadingOverlay({ online, map, people, progress, failed, back, onRetry, onExit }: LoadingOverlayProps) {
  return (
    <div className="fixed inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-[#0b0908] text-[#f2ece0]">
      <p className="font-display text-3xl italic">{online ? 'Joining the match' : MAPS[map].arrival}</p>
      {online && (
        <p className="-mt-3 text-xs font-bold tracking-[0.3em] text-neutral-400 uppercase">{`${MAPS[map].name} · ${people} ${people === 1 ? 'player' : 'players'}`}</p>
      )}
      <div
        role="progressbar"
        aria-label="Loading the match"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
        aria-valuetext={progress.label}
        className="h-px w-56 overflow-hidden bg-white/15"
      >
        <div
          className="h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)] transition-[width] duration-150 ease-linear"
          style={{ width: `${(progress.done / progress.total) * 100}%` }}
        />
      </div>
      {failed !== null ? (
        <div role="alert" className="flex w-[min(90vw,420px)] flex-col items-center text-center">
          <p className="text-xs tracking-[0.3em] text-red-400 uppercase">{progress.label} failed</p>
          <p className="mt-2 font-display text-sm text-neutral-300 italic">{failed || "The match couldn't start. The details are in the browser console."}</p>
          {!online && <ActionButton primary title="Retry" line="Try starting again" onClick={onRetry} className="mt-6 w-full" />}
          <ActionButton primary={online} title={back} line="Leave this match" onClick={onExit} className={online ? 'mt-6 w-full' : 'mt-3 w-full'} />
        </div>
      ) : (
        <p className="text-xs tracking-[0.3em] text-neutral-400 uppercase">{progress.label}</p>
      )}
    </div>
  )
}
