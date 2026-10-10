# Loading architecture

The loading pass asked for in `.claude/work/LOADING_PROMPT.md`, done on
27 Sept 2026. Paths under `game/src/`. Companion docs:
[ARCHITECTURE.md](ARCHITECTURE.md), [STATE_OWNERSHIP.md](STATE_OWNERSHIP.md),
[MODULE_BOUNDARIES.md](MODULE_BOUNDARIES.md). No gameplay value, rule, mode
or visual design changed.

## Current problem

What the first screen did before this pass (`screens/Loading.tsx`):

- A `setInterval` every 150 ms added `Math.random() * 18` % to a number;
  at 100 % a `setTimeout` of 300 ms opened the menu. About 2 s on average,
  different on every load.
- The status lines ("Fueling engines", "Arming weapons", "Loading arena",
  "Finalizing") were picked from that number. None of them matched any work.
- Nothing was awaited. The screen held the player back for ~2 s and loaded
  nothing.

What really ran, and when:

| Work | When it ran | Cost (measured) |
| --- | --- | --- |
| Rapier WASM (`RAPIER.init()`) | at import of `sim/physics.ts`, unawaited until the first match | ~15 ms |
| Google Fonts, `/bg/loading.jpg` | page load, not awaited | network |
| menu backdrop `/bg/menu.jpg` (556 kB) | only when the menu mounted: it popped in | network |
| WebGL context (`getRenderer()`) | first garage visit, or first match | ~14 ms |
| sky environment map (PMREM) | first garage visit, or first match | ~26 ms |
| garage car + its materials' texture bakes + its shaders | every garage visit (bakes and shaders once) | ~210 + ~210 ms first time, ~45 ms after |
| arena build + its texture bakes | first match on each arena (`loadArena`, session cache) | 0.7–1.3 s |
| sound synthesis (`prepareSounds`) | first match (once per session) | ~0.15 s (1.2 s in a background tab) |
| match: physics world, 8 cars, effects, composer | every match | ~0.2–0.35 s |
| scene shader compile (`compileAsync`) | every match (cached programs after the first) | ~15–60 ms |

The match had its own overlay (`screens/GameCanvas.tsx`: the arena's
arrival line over a bar filled to a third, pulsing). It waited for the real
start (`startGame().ready`), but the bar never moved, and a failed start
(the `ready` promise rejected) left the overlay up forever, with an
unhandled rejection in the console.

## Loading architecture

One small module owns loading: `runtime/loading.ts`.

```
screens/Loading.tsx ── runTasks(STARTUP) ──┐
                                           ├── runtime/loading.ts   runTasks: in order, progress per finished task,
screens/GameCanvas.tsx ── startGame() ─────┤                        a paint before each task, cancel, first failure
                       runtime/runtime.ts ─┘                        STARTUP: what the main menu waits for
                          runTasks([match steps])
```

- `runTasks(tasks, onProgress, cancelled)` runs the tasks in order. Before
  each task it reports `{ done, total, label }` and waits until that report
  has been painted (an animation frame, then a message after it; at once in
  a hidden tab, or as soon as the tab is hidden). It stops, resolving
  `false`, if `cancelled()` turns true between tasks. It rejects with the
  first failure; the last report then names the failed task. When all are
  done it reports `{ done: total, label: '' }` and resolves `true`.
- A task is `{ label, run, hint? }`. `run` does the work and may return a
  promise. `hint` is what the player reads if it fails.
- The contract with a screen: `onProgress` puts the report in the DOM
  before it returns. Both screens commit it with `flushSync`; the runner
  never reports from inside its caller (it starts one microtask later),
  because the caller is a React effect, where React can't flush. Without
  this, React committed each report in its own task after the frame the
  runner waited for, and the frame before a long step showed the previous
  step's label (found in the browser, fixed, covered by the check).
- `STARTUP` is the application's startup list (below). `startGame`
  (`runtime/runtime.ts`) runs the match's own list through the same runner.
- The screens hold no loading logic: they show the reports and the failure.

Loading and initialization stay distinct inside the lists: the startup
*initializes* the two engines and *loads* the menu's art; the match start
*loads* (builds) its arena and sounds, then *initializes* the match (world,
cars, composer) and compiles its shaders.

```
page load → Loading screen: STARTUP (physics, graphics, menu art) → Main menu
         → Garage (car built on demand) / Arena select
         → GameCanvas: match steps (physics, arena, sounds, match, shaders) → play
```

The transition to the menu is the `.then` of `runTasks(STARTUP)`: no timer
anywhere in either path.

## Startup tasks

What the main menu waits for (`STARTUP` in `runtime/loading.ts`):

| # | Label | Work | Why before the menu | On failure |
| --- | --- | --- | --- | --- |
| 1 | Starting physics | `initPhysics()` (`sim/physics.ts`): Rapier's WASM module, started once (in the page's build a file of its own, fetched and compiled as it streams in: `vite.config.ts`; the dev server and Node have it inline) | every match needs it; a browser that can't run it should say so now, not after the player picked a car and an arena | fatal: error, Retry |
| 2 | Starting graphics | `getRenderer()` (`render/renderer.ts`): the app's one WebGL renderer and context | the garage and every match need it; before this pass a browser without WebGL crashed the garage screen (blank page) | fatal: error, Retry |
| 3 | Loading the menu | the menu backdrop (`MENU_BACKDROP`, load event) and `document.fonts.ready` | the menu is drawn with them; without, it opened on system fonts and the picture popped in | cosmetic: a backdrop failure is logged (`console.warn`) and the menu opens on its dark ground; fonts that fail fall back by themselves |

`MENU_BACKDROP` is also what the menu, garage and arena select draw
(`MainMenu.tsx`, `Garage.tsx`, `MapSelect.tsx` import it), so the preload
and the screens cannot drift apart; the menu's CSS background reuses the
preloaded image (one request). The backdrop is waited on with its load
event, not `decode()`: Chrome holds `decode()` until the page is drawn, so
a game opened in a background tab sat on "Loading the menu" (found in the
browser, fixed).

## Lazy resources

Loaded when something first needs them, never at startup:

| Resource | Loaded by | When |
| --- | --- | --- |
| sky environment map | `addSunsetLighting` (`render/environment.ts`) | first garage visit or first match; kept for the session |
| garage car, its materials and shaders | `createTurntable` → `MODELS[id]` (`view/turntable.ts`) | each garage visit; materials, baked textures and programs are session caches, the car geometry is rebuilt (~45 ms) |
| an arena | `loadArena(id)` (`runtime/runtime.ts`) | the first match on that arena; kept for the session |
| sound buffers | `prepareSounds()` (`view/audio.ts`) | the first match; kept for the session (the menus play no sound) |
| the match (world, cars, effects, composer) | `createMatch` or `createOnlineMatch`, `createComposer` (in `startGame`) | every match; released at its end |
| arena preview images | `<img>` in `MapSelect.tsx` | when the arena select shows them |

Nothing loads every map or vehicle up front. Checked in the browser: after
startup the renderer holds 0 geometries, 0 textures and 0 programs (no
bake, no build, no compile), and the first match still spends its time on
the arena and the sounds.

## Progress model

Progress is **finished tasks / total tasks**: 0/3 → 1/3 → 2/3 → menu at
startup; 0/5 … 4/5 → play at a match start. No weights: task sizes differ
by orders of magnitude and depend on what earlier screens already cached
(the arena step is ~0.7 s on the first match on an arena and one frame
after), so any fixed weight would be made up.

- The bar is `done / total`; the line under it is the task running now.
- 100 % is reported only after the last task has finished; the check
  asserts that every report counts exactly the tasks finished so far.
- The screens switch on the runner's completion, not on the number.
  Nothing waits to show 100 %: the menu or the match replaces the screen.
- A CSS transition (150 ms) eases the bar between real values: presentation
  only.

## Error handling

- A task that throws or rejects stops the list; later tasks do not run.
- Startup (`Loading.tsx`): the bar stays where it was, the line reads
  "<task> failed", the task's hint says what to do (e.g. "This browser
  couldn't start WebGL. Turn on hardware acceleration, or try another
  browser."), and a **Retry** button (Enter) runs the list again. The
  console gets the error with its stack: `Startup failed at "<task>": …`.
  No stack trace on screen.
- Match start (`GameCanvas.tsx`): the overlay reads "<step> failed" and
  "The match couldn't start. The details are in the browser console.", with
  **Back to garage** (Enter or Esc). The console gets `The match failed to
  start: …`. No retry here: a failure at this point is a code bug and would
  fail again; starting the match again from the arena select runs the list
  again.
- The cosmetic menu art never fails the startup (see above).

## Retry

Retry runs the same list again. Each task is safe to repeat:

| Task | Why repeating it duplicates nothing |
| --- | --- |
| `initPhysics` | one start, memoised; a failed start is forgotten so the retry starts it again (Rapier only keeps a module that loaded) |
| `getRenderer` | the singleton is assigned only when construction succeeds |
| menu art | the browser cache answers; fonts are shared by the document |
| `loadArena`, `prepareSounds` | session caches (per map; once) |

Checked in the browser: a WASM instantiate refused once → "Starting physics
failed" → Retry → exactly one more instantiate → menu. A WebGL context
refused once → "Starting graphics failed" → Enter → one renderer, the
physics step passing at once → menu.

## Resource ownership

| Resource | Made by | When | Released |
| --- | --- | --- | --- |
| Rapier WASM module | `initPhysics` (`sim/physics.ts`) | startup | never (session) |
| WebGL renderer and context | `getRenderer` (`render/renderer.ts`) | startup | never (session) |
| sky environment map, sky dome | `render/environment.ts` | first garage visit or match | never (session) |
| materials, baked textures | `render/materials/library.ts` | first use | never (session) |
| arena meshes and colliders | `loadArena` (`runtime/runtime.ts`) | first match on the arena | never (session cache) |
| sound buffers | `prepareSounds` (`view/audio.ts`) | first match | never (session) |
| scene, sun, match, composer, settings watcher | `startGame`'s `assemble` (`runtime/runtime.ts`) | each match start ("Setting up the match") | `startGame().dispose` → `release`: all of it once running, and whatever exists after a failed or abandoned start |
| render loop, dev globals | `startGame` | after the last step | `startGame().dispose` |
| garage scene, car, controls | `createTurntable` | each garage visit | `turntable.dispose` |
| loading progress and failure (React state) | `Loading.tsx`, `GameCanvas.tsx`, fed by `runTasks` | while loading | with the screen |

`startGame().dispose` is idempotent and safe at any point: before the
first step (StrictMode's double mount), between steps (the runner is
cancelled and stops), during the shader compile, after a failure, or while
running.

## Performance

| | Before | After |
| --- | --- | --- |
| Startup (loading screen) | ~2 s of random-timer delay, no work | ~20–35 ms of real work after the first render (localhost, warm cache); the menu is up ~0.3 s after navigation (dev), ~0.47 s (production bundle) |
| Menu backdrop | fetched when the menu mounted: popped in | fetched during startup; the menu reuses it |
| WebGL context | made on the first garage visit or match | made at startup (~14 ms) |
| First match start (Scrapyard) | same work, frozen overlay | ~1.5 s shown step by step: arena ~710 ms, sounds ~150 ms, match set-up ~350 ms, shaders ~60 ms, then the first frame |
| Later match, same arena | not measured (same work, no paint waits) | ~0.3 s: arena and sounds pass in one frame each, set-up ~200 ms |

- The runner spends one frame per step on the paint (5 at a match start,
  3 at startup): the cost of the label being on screen before a step
  blocks the main thread.
- Each report re-renders the gameplay screen, and that re-rendered the
  whole HUD (718 nodes, ~44 ms per report in the dev build) although the
  HUD is written through its handle and never needs React to redraw it.
  `Hud` is now `memo`: a warm match start went from ~0.5 s to ~0.3 s. It
  also skips the HUD on pause and phase changes.
- Garage entry is unchanged (car, bakes and shaders on the first visit,
  ~0.4 s; ~45 ms after). Nothing was added to startup to speed it up: the
  garage may never be visited before a match.

## Validation

What ran when the loading work landed (the check scripts have since become
Vitest tests: `game/loading.check.ts` is `src/runtime/loading.test.ts`).

- check: pass — `router ok`, `ffa ok (143 checks)`, `tdm ok (163 checks)`,
  `simulation ok (28 checks)`, `loading ok (23 checks)` (new,
  `game/loading.check.ts`: reports count exactly the finished tasks, sync
  or async; all-done only after the last one; no report while the caller
  is still running; a thrown or rejected failure stops the list and is
  never reported as done; a retry completes without remaking what a task
  keeps; cancel stops between tasks; physics starts once). Mutation tests:
  not awaiting a task, dropping the cancel check, reporting a task as done
  before it runs, and reporting from inside the caller each fail the check.
- lint: pass; the one warning is the pre-existing `screens/Drawer.tsx:24`
  exhaustive-deps.
- typecheck (`npx tsc -b`): clean.
- build: pass; bundle 4,003 kB (4,000 kB before; the > 500 kB chunk warning
  predates this).
- browser (Chrome, dev build on :3000 unless noted):
  - Fresh startup, traced from the first render (same-origin iframe, its
    realm instrumented before the app ran): 0/3 physics → 1/3 graphics →
    2/3 menu art → menu, each label painted in its own frame, each change
    right after the real work finished (WASM instantiated, WebGL context
    made, backdrop loaded).
  - Slow startup (the backdrop request held 1.5 s): the screen stayed on
    "Loading the menu", 2/3, for the whole 1.5 s; the menu opened 8 ms
    after the backdrop arrived.
  - A document that is shown but never drawn (`display: none` iframe) and a
    tab hidden from its first moment both reach the menu.
  - Failure and retry: physics (WASM refused once) and graphics (WebGL
    refused once), as above; the error screen keeps the menu's look.
  - Match start, recorded frame by frame: before each long step (arena
    ~710 ms, sounds ~150 ms, set-up ~350 ms) the last painted frame shows
    that step's label.
  - Matches: Scrapyard TDM, three times in a row; The City FFA (8 seats,
    playing, the clock running under `window.tick`).
  - Re-entry: menu → arena select → match → exit → garage → menu, three
    times: in the garage after each match the renderer holds the same
    190 geometries, 98 textures and 30 programs; `window.match`,
    `window.camera`, `window.tick` removed; listeners added during the
    cycle net back to the garage's own keydown; the runner's
    `visibilitychange` listeners net to 0.
  - Failed match start (the shader compile made to reject): "Compiling
    shaders failed" with Back to garage; the loop never started; back in
    the garage the counts were as before the attempt, and the arena was
    detached from the failed scene, so `release` ran to its end.
  - The HUD still updates every frame through its handle after the `memo`.
  - Production bundle (`vite preview`): startup to menu and a match start
    pass; no dev globals.
  - Console over a full clean flow (startup, garage, arena select, match,
    exit): no warnings or errors.
  - Not checked: other browsers, a cold network (bundle, fonts and backdrop
    over a slow link), audio by ear.

## Remaining limitations

- The long steps are single synchronous tasks (arena build 0.7–1.3 s, match
  set-up ~0.2–0.35 s, sound synthesis ~0.15 s): their label is on screen,
  but the page cannot repaint until the step ends, so the bar does not move
  within a step and CSS animations stall. Finer progress would mean
  building arenas in chunks or in a worker.
- A throw inside `createMatch` itself (a code bug, e.g. a mode rejecting an
  arena) can leave that half-built match's physics world unreleased until
  reload; everything `startGame` made around it is released.
- Match start has no Retry (see Error handling).
- `document.fonts.ready` waits on Google Fonts: a font request that hangs
  (rather than failing) holds "Loading the menu" until the browser gives up
  on it.
- `compileAsync` compiles the scene's materials; the post-processing passes
  compile on the first frame (~0.2 s), after the last step.
- Nothing shows before React runs: the 4 MB bundle downloads and parses
  behind a blank page.
- Timings come from an automated Chrome window on localhost with a warm
  HTTP cache; a background tab ran the same work up to ~7x slower.
