# Architecture

The game client (`game/`) as it is after the refactor. Paths are under
`game/src/`. Companion docs: [GAME_LOOP.md](GAME_LOOP.md) (the frame and the
step, in order), [MODULE_BOUNDARIES.md](MODULE_BOUNDARIES.md) (who may use
whom), [STATE_OWNERSHIP.md](STATE_OWNERSHIP.md) (who owns which state and
resource), [LOADING_ARCHITECTURE.md](LOADING_ARCHITECTURE.md) (what loads
when, progress, failures), [REFACTOR_REPORT.md](REFACTOR_REPORT.md) (what
changed).

```
App.tsx ─ screens (React) ─────────────────────────────────────────────┐
  loading → menu → garage (Loadout) → map select (Mode, MapId) → game  │ React: screens, menus, HUD markup
                                                                       │
screens/GameCanvas.tsx ── startGame() ── game/runtime.ts               │ one browser session: scene, sun, sky,
                                            │                          │ arena (session cache), composer, loop
                                            ▼
                                     game/match.ts                       composition, fixed steps + interpolation,
                         ┌──────────────┼──────────────┬─────────────┐  player-view phase, pause/restart/dispose
                         ▼              ▼              ▼             ▼
                   simulation.ts     view.ts        pilot.ts      feed.ts
                   authoritative:    what the       the local     feed, callouts,
                   machines, step,   player sees    control       announcer
                   combat, respawn   and hears      source
                         │   ▲ SimEvents ┘
                         ▼
                   MatchMode (mode.ts) ◀── modes.ts registry ── ffa/mode.ts · tdm/mode.ts
                                                                    │           │
                                                               ffa/rules.ts  tdm/rules.ts + tactics.ts
                                                                  (pure, checked; scoring.ts shared)
```

## How the application starts

`main.tsx` mounts `App` (and the cursor auto-hide). `App` holds the screen,
the player's `Loadout` (`game/loadout.ts`: `{ vehicle, weapon }`, plain ids)
and the last mode/map pick. The loading screen (`screens/Loading.tsx`) runs
the startup tasks (`STARTUP` in `game/loading.ts`: start the physics engine,
start the WebGL renderer, load the menu's backdrop and fonts) through
`runTasks`, shows how many have finished and which one is running, and opens
the menu when the last one finishes; a failure shows what failed, with
Retry. Menus, garage and map select are plain React. The garage shows the
car on the turntable (`game/turntable.ts`, mounted by a small component in
`Garage.tsx`), built when the garage opens.

## How a match starts

`screens/GameCanvas.tsx` calls `startGame({ container, loadout, mode, map,
onPhase, onFrame, onProgress })` (`game/runtime.ts`) in an effect and
disposes it in the cleanup. `startGame` runs the match's loading steps
through `runTasks` (`game/loading.ts`), reported to the overlay: starting
physics, building the arena (`loadArena`, cached per map), synthesizing the
sounds (once), setting up the match (the shared renderer, the scene with
sky, sun and arena, the match, the composer, the settings watcher) and
compiling the shaders. Then it mounts the render loop and hands the match
back (`ready`); a failed step rejects `ready`, the overlay says which, and
`dispose` releases whatever was made. Every frame it runs the
arena animation, `match.frame`, the shadow follow, `onFrame` (the HUD) and
the composer. React re-renders only on the loading steps and player-view
phase changes (the HUD, written through its handle, skips even those).

`createMatch` (`game/match.ts`) seats everyone from the mode's line-up
(`MODES[mode].lineUp(arena)`: seat 0 is the player, bots in the rest), then
builds, in order: the physics world and the combatants (`enlist`), the view,
the running mode (`MODES[mode].create`), the simulation, the pilot and the
feed.

## Where state lives

- Authoritative gameplay: the simulation's combatants (hull, alive, pose,
  weapon, controls) and the running mode's rules (clock, lives, scores,
  items). The physics body owns the pose; it is read back once per step.
- Presentation: `view.ts` (models, effects, sound, camera, HUD pulses),
  `pilot.ts` (aim target, sight), `feed.ts` (lines), `match.ts` (player-view
  phase). The HUD reads all of it from the match object every frame.
- Preferences: `settings.ts`, never read by a rule.

Details: [STATE_OWNERSHIP.md](STATE_OWNERSHIP.md).

## How the systems talk

- **Controls** are plain data on each combatant (`Control`), written before
  each step by its control source: the pilot for the player, the brain
  (`ai.ts`, run by the simulation) for a bot.
- **SimEvents** — the simulation calls the view at the moment something
  happens in a step (a round fired, a hit, a wreck, a crash, a respawn).
  Direct calls through one interface, not a bus; a headless run passes no-ops.
- **Rules events** — each mode's rules queue events; the adapter drains them
  into the feed every step (`MatchMode.report`).
- **Everything else** is direct calls down the layers: match → simulation →
  mode rules; UI → match API (`pause`, `restart`, `lock`, `respawnIn`,
  `debug`).

Randomness: each match draws one seed (`match.seed`, shown in the F3
overlay). Everything random that affects play — bots, weapon spread, wrecks,
FFA items and zones — comes from it, so the same seed and the same controls
replay the same match; `simulation.check.ts` replays a bots-only match bit
for bit. Presentation (particles, sound, camera shake) stays unseeded.

## FFA and TDM

Each mode is a folder: config, pure rules (with a node self-check), and an
adapter (`mode.ts`) that fulfils `MatchMode` (`game/mode.ts`): the rules as
the simulation drives them (`tick`, `damage`, `kill`, `respawnDue`,
`pickSpawn`, `respawned`, `phase`, `now`, `contenders`, `remaining`), timing,
respawn starts, the bots' plan, speed factor, shots fired, outcome, event
reporting, per-frame scenery, debug lines, restart and dispose.
`game/modes.ts` registers both with their arena-screen card and line-up.
The runtime never branches on the mode; the HUD and results screen show a
mode's own panels by narrowing `match.mode.kind`.

- Free for all: each machine its own team; pickups are drawn by
  `items/pickups.ts` and the hot zone by `ffa/zone.ts`, handed to the
  adapter by the registry, so the adapter itself runs headless.
- Team deathmatch: seats from the arena's two bases; the team AI is
  `tdm/tactics.ts` behind the plan hooks; firing ends spawn protection
  through `fired`; pickups only when a custom lobby turns them on.

How a match is played comes in as `MatchSettings` (`game/matchSettings.ts`:
the line-up's size, the clock, respawn speed, friendly fire, pickups,
weapons, kill limit): Classic and practice pass `classic(mode)`, the
mode's own numbers; a custom lobby's room passes its owner's.

## Pickups: the supply

`items/supply.ts` is one match's pickups, for whichever mode plugs it in:
the items on the ground, waves on the match clock, expiry, who picks what
up, and what each machine has running (repair, speed, armor, damage
boost). The mode's rules own it (pure, node-checked) and create it with the
spots items may appear on, the types the match's settings allow
(`items/items.ts` `itemTypes`), the rules' clock and random stream, the
event queue to report into, the combat score an item earns, and `wave()`,
which shapes each drop: free for all adds its hot zone and comeback
weights (the zone itself stays in `ffa/rules.ts`), team deathmatch drops
plain waves. The rules tick it and ask it how hard a hit lands
(`damageFactor`, `shield`) and how fast a machine goes (`speedFactor`);
bots take its errands. The HUD's effect chips and the minimap read
`MatchMode.supply`; `items/pickups.ts` draws the tokens. Free for all
always plugs it in (a custom lobby may turn every group off); team
deathmatch only when a custom lobby turns any group on.

## Seats that can be empty

A custom lobby's match has seats nobody holds and no bot drives. Every
per-seat array keeps its length (snapshots, rewind, fair play,
statistics); the machine is out of play: `Combatant.present` false, its
body disabled (rays, blasts and cars pass through), never alive, and in
the rules' `absent` life: never due to respawn, out of spawn choice, the
lead and the standings. The simulation's `vacate(c)` takes a machine out
quietly (no death, no kill); `occupy(c)` brings it back on the next step
through a respawn at a start the rules pick, protected. On the wire an
empty seat's car row carries the `absent` flag, and a welcome's seat and a
`ro` say whether it is present; the page hides absent machines (view,
markers, minimap, scoreboard, results). Classic never makes one.

## Checks and build

From `game/`:

- `npm run check` — node self-checks: `ai.check.ts` (router),
  `ffa/ffa.check.ts`, `tdm/tdm.check.ts` (rules), `simulation.check.ts`
  (both real modes through the simulation, headless: hold, damage, wrecks,
  scoring, respawns, result, restart, content numbers), `loading.check.ts`
  (the loading runner: progress, failure, retry, cancel).
- `npm run lint` — oxlint. `npx tsc -b` — typecheck. `npm run build` —
  typecheck and bundle.
- The dev build (`:3000`) exposes `window.match`, `window.camera` and
  `window.tick(ms)`; F3 toggles the debug overlay. The balance probes in
  `.claude/work/{ffa,tdm}/*-metrics.js` play whole matches through
  `match.frame`.

## How to add …

**A vehicle** (same driving model, its own numbers and body)
1. `vehicle/vehicles.ts`: a `ROSTER` entry — name, kind, blurb, armour,
   `handling`, `chassis` (wheels fl/fr/rl/rr, radius, collision shells,
   inertia box), turret mount and barrel.
2. `vehicle/vehicle.ts`: its model builder in `MODELS` (or a glTF loader);
   node names `body`, `turret` > `gun`, `wheel_fl/fr/rl/rr`.
3. Garage: a vehicle pager (today the garage shows `loadout.vehicle` only).
4. `npm run check` validates its numbers. Nothing in the match, simulation,
   modes or HUD changes. A new *mechanic* (tracks, a jump) is a new
   capability in `drive.ts`/`simulation.ts`, not a copy.

**A map**
1. `arena/<name>.ts`: a builder returning the `Arena` contract (spawns;
   `bases` if it hosts team deathmatch; `zones` for hot zones; colliders; nav
   graph; emitters; minimap floor; `update`).
2. `maps.ts`: a `MAPS` entry (name, preview image, arrival line, modes it
   hosts, `build`). Map-specific animation stays in its `update`.

**A weapon**
1. `combat.ts`: a `ROSTER` entry (`WeaponSpec`: damage, rate, magazine,
   reload, range, spread, optional rocket).
2. Its turret model in `vehicle/parts.ts` and `VehicleOptions.turret`.
3. The garage lists it automatically; the HUD shows `spec.name` and ammo.
   A new firing behaviour (beam, homing) is a new branch in the simulation's
   `fire`, isolated there.

**A loadout slot** (e.g. a Super weapon)
1. `loadout.ts`: a field (`super: WeaponId`).
2. Garage: a pager for it. `createMatch`: arm it on the combatant (a second
   `WeaponState`) and a control bit (`Control.super`) the pilot sets.
3. `simulation.ts` fires it in the step like the primary; `SimEvents`
   already cover shots and bursts. HUD: a second weapon panel.
   Rules, physics, runtime and navigation are untouched.

**A game mode**
1. `game/<mode>/`: config, pure rules exposing the `ModeRules` shape plus
   its own state, a node check, and `mode.ts` with `lineUp` and a
   `create…Mode` that returns a `MatchMode` (with `kind`).
2. `modes.ts`: an entry (label, tags, blurb, lineUp, create).
3. UI integration: its HUD panel and results panel (narrow on
   `match.mode.kind`); `MapSelect` lists it from the registry.

**A pickup** (any mode that plugs the supply in)
1. `items/items.ts`: an `ITEMS` entry (label, rarity, colour) and its group
   (`GROUPS`: what a custom lobby turns on); `items/supply.ts` `apply()` for
   its effect (a timed effect is an `Effect` key).
2. `items/pickups.ts`: its token geometry; the HUD effect chip list
   (`EFFECTS` in `Hud.tsx`) if it is timed.
3. `ffa/ffa.check.ts`: its effect.

**A HUD feature**
1. Markup in `hud/Hud.tsx` with a `data-hud` name (rendered once).
2. Its element in `collect()`, and its write in `update()` from the match
   state; mode-specific data through `match.mode.kind`.
3. If it needs data the match doesn't expose yet, add it to the match state
   (from the view, pilot or feed) — never compute gameplay in the HUD.

## Future multiplayer (Nakama)

Not implemented. The seams that exist:

- The simulation (`simulation.ts` + a mode adapter) runs without a scene,
  sound, DOM, React or local player — `simulation.check.ts` runs it in node.
  The client can keep it for prediction; where the authoritative copy runs
  is still open (Nakama's JavaScript runtime is not node and Rapier needs
  WebAssembly, so it is a sidecar process or a server-side port — decide
  before building it).
- Controls are plain data per combatant, written before each step. A
  network player is a third control source: write its `Control` from the
  latest input message, like `pilot.read` does from the keyboard. Nothing
  in the simulation assumes "not the player ⇒ a bot": bots are the machines
  with a `brain`.
- Presentation hears the simulation only through `SimEvents` and reads the
  combatants and the mode's rules; a client applying server snapshots would
  write those and replay events into the same view.
- The loadout is plain ids, ready to send.

What does not exist yet: sessions, match join, input sequencing, snapshots,
reconciliation, interpolation of remote machines. The practice roster in
`createMatch` is where a server-provided roster would plug in.
