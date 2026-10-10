import { initPhysics } from '../sim/physics.ts'
import { getRenderer } from '../render/renderer.ts'

// Loading: real work a screen can't open without, run as a list of tasks
// whose progress is reported as each one finishes. STARTUP is what the
// loading screen waits for before the main menu; a match start (runtime.ts)
// runs its own list the same way. Everything else loads when something
// first needs it (.claude/work/arch/LOADING_ARCHITECTURE.md).

export interface Task {
  label: string // what the player reads while it runs
  run: () => unknown // the work; may return a promise; throws or rejects on failure
  hint?: string // told to the player if it fails; the error itself goes to the console
}

export interface Progress {
  done: number // tasks finished
  total: number
  label: string // the task running now; '' once all are done
}

// Runs `tasks` in order. Progress counts finished tasks — their sizes differ
// and depend on what earlier screens already cached, so they carry no
// weights — and each report is painted before its task starts, so one that
// blocks the main thread still shows its label. For that `onProgress` must
// put the report in the DOM before it returns (a screen commits it with
// flushSync), and reports never go out from inside the caller: a React
// effect can't flush. Resolves true when all have finished, false if
// `cancelled` stopped it between tasks; rejects with the first failure, the
// last report naming the task that failed.
export async function runTasks(tasks: Task[], onProgress: (progress: Progress) => void, cancelled = () => false) {
  await Promise.resolve() // out of the caller first
  for (const [done, task] of tasks.entries()) {
    onProgress({ done, total: tasks.length, label: task.label })
    await nextPaint()
    if (cancelled()) return false
    await task.run()
  }
  onProgress({ done: tasks.length, total: tasks.length, label: '' })
  return true
}

// Resolves once the browser has painted: an animation frame, then a task
// after it. A hidden tab paints nothing and runs no animation frames, so
// there it resolves at once, or as soon as the tab is hidden.
function nextPaint() {
  return new Promise<void>((resolve) => {
    if (document.hidden) return resolve()
    const painted = () => {
      document.removeEventListener('visibilitychange', painted)
      resolve()
    }
    document.addEventListener('visibilitychange', painted)
    requestAnimationFrame(() => {
      const { port1, port2 } = new MessageChannel()
      port1.onmessage = painted
      port2.postMessage(null)
    })
  })
}

// The main menu's backdrop; the garage and the arena select open on it too.
// Under the build's base path (/play/ on the site); `?.` for a module run
// without Vite, which has no import.meta.env.
export const MENU_BACKDROP = `${import.meta.env?.BASE_URL ?? '/'}bg/menu.jpg`

// What the main menu waits for: the two engines every match and the garage
// run on — started here, so a browser that can't run them says so now
// rather than after the player has picked a car and an arena — and the
// menu's own look. Each task can run again after a failure (retry): the
// engines are made once and kept, the art comes from the browser's cache.
export const STARTUP: Task[] = [
  { label: 'Starting physics', run: initPhysics, hint: "This browser couldn't start the physics engine (WebAssembly)." },
  { label: 'Starting graphics', run: getRenderer, hint: "This browser couldn't start WebGL. Turn on hardware acceleration, or try another browser." },
  { label: 'Loading the menu', run: menuArt },
]

// The menu's typefaces (the ones this screen is already drawing with) and
// its backdrop, so the menu opens whole instead of swapping fonts and
// popping the picture in. Load events, not decode(): Chrome holds decode()
// until the page is drawn, so a game opened in a background tab would wait
// on it. Cosmetic: if the backdrop fails, the menu opens on its dark ground;
// fonts that fail fall back on their own.
async function menuArt() {
  const backdrop = new Promise((loaded, failed) => {
    const image = new Image()
    image.onload = loaded
    image.onerror = failed
    image.src = MENU_BACKDROP
  })
  await Promise.all([backdrop.catch(() => console.warn(`The menu backdrop (${MENU_BACKDROP}) didn't load; the menu opens without it.`)), document.fonts.ready])
}
