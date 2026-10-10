# Architecture

The game client (`game/`) as it is after the refactor. Paths are under
`game/src/`. Companion docs: [GAME_LOOP.md](GAME_LOOP.md) (the frame and the
step, in order), [MODULE_BOUNDARIES.md](MODULE_BOUNDARIES.md) (who may use
whom), [STATE_OWNERSHIP.md](STATE_OWNERSHIP.md) (who owns which state and
resource), [LOADING_ARCHITECTURE.md](LOADING_ARCHITECTURE.md) (what loads
when, progress, failures), [REFACTOR_REPORT.md](REFACTOR_REPORT.md) (what
changed).

```
App.tsx ─ screens (React) ─────────────────────────────────────────────────┐
  loading → menu → garage (Loadout) → map select (Mode, MapId) → game      │ React: screens, menus, HUD markup
                                                                           │
screens/GameCanvas.tsx ── startGame() ── runtime/runtime.ts                │ one browser session: scene, sun, sky,
                                            │                              │ arena (session cache), composer, loop
                                            ▼
                                     runtime/match.ts                        composition, fixed steps + interpolation,
                         ┌──────────────┼──────────────┬──────────────┐     player-view phase, pause/restart/dispose
                         ▼              ▼              ▼              ▼
                 sim/simulation.ts  view/view.ts   view/pilot.ts  view/feed.ts
                   authoritative:    what the       the local     feed, callouts,
                   machines, step,   player sees    control       announcer
                   combat, respawn   and hears      source
                         │   ▲ SimEvents ┘
                         ▼
          MatchMode (sim/matchMode.ts) ◀── modes/modes.ts registry ── modes/ffa/mode.ts · modes/tdm/mode.ts
                                                                         │                   │
                                                               modes/ffa/rules.ts   modes/tdm/rules.ts + tactics.ts
                                                                  (pure, tested; sim/scoring.ts shared)
```

## How the application starts

`main.tsx` mounts `App` (and the cursor auto-hide). `App` holds the screen,
the player's `Loadout` (`sim/loadout.ts`: `{ vehicle, weapon }`, plain ids)
and the last mode/map pick. The loading screen (`screens/Loading.tsx`) runs
the startup tasks (`STARTUP` in `runtime/loading.ts`: start the physics engine,
start the WebGL renderer, load the menu's backdrop and fonts) through
`runTasks`, shows how many have finished and which one is running, and opens
the menu when the last one finishes; a failure shows what failed, with
Retry. Menus, garage and map select are plain React. The garage shows the
car on the turntable (`view/turntable.ts`, mounted by a small component in
`Garage.tsx`), built when the garage opens.

## How a match starts

`screens/GameCanvas.tsx` calls `startGame({ container, loadout, mode, map,
onPhase, onFrame, onProgress })` (`runtime/runtime.ts`) in an effect and
disposes it in the cleanup. `startGame` runs the match's loading steps
through `runTasks` (`runtime/loading.ts`), reported to the overlay: starting
physics, building the arena (`loadArena`, cached per map), synthesizing the
sounds (once), setting up the match (the shared renderer, the scene with
sky, sun and arena, the match, the composer, the settings watcher) and
compiling the shaders. Then it mounts the render loop and hands the match
back (`ready`); a failed step rejects `ready`, the overlay says which, and
`dispose` releases whatever was made. Every frame it runs the
arena animation, `match.frame`, the shadow follow, `onFrame` (the HUD) and
the composer. React re-renders only on the loading steps and player-view
phase changes (the HUD, written through its handle, skips even those).

A practice match (`createMatch`, `runtime/practice.ts`) seats everyone
through the roster (`recruits`, `modes/roster.ts`: the mode's line-up at
Classic's size, the player in seat 0 with the garage loadout, bots in the
rest, each drawing its gun and its vehicle from the match seed), then
builds, in order: the physics world and the combatants (`enlist`), the
view, the running mode (`MODES[mode].create`), its scenery, the simulation
and the feed; `playMatch` (`runtime/match.ts`) adds the pilot and runs it.
An online match (`createOnlineMatch`, `runtime/online.ts`) is seated from
the server's welcome instead (`seatOnline`, `net/client.ts`: each seat's
vehicle and gun, the mode on the room's seed) and runs through the same
`playMatch`, its steps and poses from the server (below, "Online play").

## Where state lives

- Authoritative gameplay: the simulation's combatants (hull, alive, pose,
  weapon, controls) and the running mode's rules (clock, lives, scores,
  items). The physics body owns the pose; it is read back once per step.
- Presentation: `view/view.ts` (models, effects, sound, camera, HUD pulses),
  `view/pilot.ts` (aim target, sight), `view/feed.ts` (lines), `runtime/match.ts` (player-view
  phase). The HUD reads all of it from the match object every frame.
- Preferences: `view/settings.ts`, never read by a rule.

Details: [STATE_OWNERSHIP.md](STATE_OWNERSHIP.md).

## How the systems talk

- **Controls** are plain data on each combatant (`Control`), written before
  each step by its control source: the pilot for the player, the brain
  (`sim/ai/`, run by the simulation) for a bot.
- **SimEvents** — the simulation calls the view at the moment something
  happens in a step (a round fired, a hit, a wreck, a crash, a respawn).
  Direct calls through one interface, not a bus; a headless run passes no-ops.
- **Rules events** — each mode's rules queue events; the adapter drains them
  into the feed every step (`MatchMode.report`).
- **Everything else** is direct calls down the layers: match → simulation →
  mode rules; UI → match API (`pause`, `restart`, `lock`, `respawnIn`,
  `debug`).

Randomness: each match draws one seed (`match.seed`, shown in the F3
overlay). Everything random that affects play — bots (their guns and
vehicles too), weapon spread, wrecks, FFA items and zones — comes from it,
so the same seed and the same controls replay the same match;
`sim/simulation.test.ts` replays a bots-only match bit for bit.
Presentation (particles, sound, camera shake) stays unseeded.

## FFA and TDM

Each mode is a folder: config, pure rules (with their tests), and an
adapter (`mode.ts`) that fulfils `MatchMode` (`sim/matchMode.ts`): the rules as
the simulation drives them (`tick`, `damage`, `kill`, `respawnDue`,
`pickSpawn`, `respawned`, `phase`, `now`, `contenders`, `remaining`), timing,
respawn starts, the bots' plan, speed factor, shots fired, outcome, event
reporting, debug lines, restart and dispose. A mode draws nothing: what the
browser shows of it besides the machines is `modes/scenery.ts` (below).
`modes/modes.ts` registers both with their arena-screen card and line-up.
The runtime never branches on the mode, nor do the HUD and the results
screen: they show a mode's own panels from `MODE_VIEWS` (`modes/views.ts`):
its `HudPanel` (its block at the top left, and what the shared HUD shows of
it: a leader, a zone, an objective line, overtime's clock, the
scoreboard's order and headers) and its `ResultsPanel` (the verdict, the
record's details, the standings, in `screens/ResultsFrame.tsx`).

- Free for all: each machine its own team; pickups are drawn by
  `modes/items/pickups.ts` and the hot zone by `modes/ffa/zone.ts`, both made
  by the runtime through `modes/scenery.ts` (the tokens from any mode's
  supply; a mode's own scenery from `MODE_SCENERY`), so the adapter runs
  headless and the server bundle carries neither.
- Team deathmatch: seats from the arena's two bases; the team AI is
  `modes/tdm/tactics.ts` behind the plan hooks; firing ends spawn protection
  through `fired`; pickups only when a custom lobby turns them on.

How a match is played comes in as `MatchSettings` (`modes/matchSettings.ts`:
the line-up's size, the clock, respawn speed, friendly fire, pickups,
weapons, kill limit): Classic and practice pass `classic(mode)`, the
mode's own numbers; a custom lobby's room passes its owner's.

## Pickups: the supply

`modes/items/supply.ts` is one match's pickups, for whichever mode plugs it in:
the items on the ground, waves on the match clock, expiry, who picks what
up, and what each machine has running (repair, speed, armor, damage
boost). The mode's rules own it (pure, tested) and create it with the
spots items may appear on, the types the match's settings allow
(`modes/items/items.ts` `itemTypes`), the rules' clock and random stream, the
event queue to report into, the combat score an item earns, and `wave()`,
which shapes each drop: free for all adds its hot zone and comeback
weights (the zone itself stays in `modes/ffa/rules.ts`), team deathmatch drops
plain waves. The rules tick it and ask it how hard a hit lands
(`damageFactor`, `shield`) and how fast a machine goes (`speedFactor`);
bots take its errands. The HUD's effect chips and the minimap read
`MatchMode.supply`; `modes/items/pickups.ts` draws the tokens. Free for all
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

## Tests and build

From `game/`:

- `npm test` — Vitest, every test: the unit project (the rules, the
  simulation headless, the bots, the wire, the stores' pure parts), then the
  integration one (the arenas, a real server over sockets, headless pages,
  netplay); `game/AGENTS.md` lists them by folder.
- `npm run lint` — oxlint. `npx tsc -b` — typecheck. `npm run build` —
  typecheck and bundle.
- The dev build (`:3000`) exposes `window.match`, `window.camera` and
  `window.tick(ms)`; F3 toggles the debug overlay. The balance probes in
  `.claude/work/{ffa,tdm}/*-metrics.js` play whole matches through
  `match.frame`.

## How to add …

**A vehicle** (same driving model, its own numbers and body)
1. `content/vehicles/vehicles.ts`: a `ROSTER` entry — name, kind, blurb, armour,
   `handling`, `chassis` (wheels fl/fr/rl/rr, radius, collision shells,
   inertia box), turret mount and barrel.
2. `content/vehicles/models/<id>.ts`: its body builder, returning `ModelParts`
   (the rigid body unmerged, its turret ring, its tyres' width), and its
   `MODELS` entry in `content/vehicles/models.ts`, which adds what every model
   shares: the merged body, the turret, the wheels, named `body`, `turret` >
   `gun`, `wheel_fl/fr/rl/rr`.
3. That is all the code. The garage pages through `VEHICLES` (its pager
   shows once there are two) and the turntable builds `MODELS[id]`; the
   stored loadout and a page's hello keep the id (`parseLoadout` takes any
   id the registry has). Online, the room seats the person in it:
   `changeVehicle` (`sim/simulation.ts`) replaces a bot's body where it
   stands when they take the seat over mid-match, and gives the bot its
   own back when they leave; a custom lobby's seat is built in it from the
   seat plan. The welcome's line-up, `ro` and the journal's `join` name it,
   so every page and every replay builds the same machine. Nothing in the
   match, modes or HUD changes.
4. Bots draw their vehicles from the registry (`modes/roster.ts`, from a
   seeded stream of their own), practice's and the server's alike: a new
   vehicle changes how the bots play, and the pins move (the yard's in
   `sim/simulation.test.ts`; Classic's and the custom rooms' in
   `server/server.test.ts`). Re-pin in a commit of its own that gives the
   reason and shows the old hashes still come out without the new entry.
5. `npm test`: the arena tests put its collision shells on every start of
   every map; the two-vehicle tests run on a test-only second vehicle
   (`server/testVehicle.ts`: a takeover mid-match, a custom room of mixed
   vehicles replayed to the bit, netplay), which a real one can replace.
   Then the balance probes, then the site's copy (root `AGENTS.md`).
   A new *mechanic* (tracks, a jump) is a new capability in
   `sim/drive.ts`/`sim/simulation.ts`, not a copy.

**A map**
1. `content/arenas/<name>.ts`: a builder returning the `Arena` contract (spawns;
   `bases` if it hosts team deathmatch; `zones` for hot zones; colliders; nav
   graph; emitters; minimap floor; `update`).
2. `content/arenas/maps.ts`: a `MAPS` entry (name, preview image, arrival line, modes it
   hosts, `build`). Map-specific animation stays in its `update`. The arena
   screen and the lobby form list it from there; the game server takes
   tickets and lobbies for it (`server/seating.ts`) and builds it headless
   at start (`server/arenas.ts`).
3. `server/digests.json`: its digest, as the arena test prints it. The
   deploy's smoke test (`scripts/match-smoke.mjs`) and
   `scripts/arena-parity.mjs` hold the server and the browser to it.
4. `npm test` holds it to the checklist (`server/arenas.test.ts`): built
   headless with nothing left to look at, the same digest build after build
   and the one in `digests.json`; its preview card a file in `public/`; a
   start for every machine of the biggest free for all a lobby may ask for
   (12); two team bases of six starts or more; a hot zone; a road graph in
   one piece; every start clear of anything solid, for every vehicle's
   shells; room for a full drop of pickups (`SUPPLY.maxActive` item spots,
   clear of the starts); every mode it hosts built headless at its biggest
   line-up, each seat its own start. Then the balance probes on it, then
   the site's copy.

**A weapon**
1. `content/weapons/weapons.ts`: its id in `WeaponId` and a `WEAPONS` row
   (`WeaponSpec`: its `kind`, `gun` or `rocket` (a rocket's speed and blast);
   damage, rate, magazine, reload, range, spread).
2. Its `turret`: an existing `TurretKey`, or a new one with its builder in
   `content/weapons/turrets/<name>.ts` and a `TURRETS` entry
   (`content/weapons/turrets.ts`); the compiler holds keys and builders
   equal.
3. The garage lists it automatically; the HUD shows `spec.name` and ammo;
   its id goes on the wire, into the match record and the replay, and a
   lobby may make it the match's one gun. Bots draw it (`armBot` over
   `WEAPON_IDS`), so the pins move as for a vehicle: re-pin in a commit of
   its own.
4. A new firing behaviour (mines, homing) is a new `kind` in the
   `WeaponSpec` union. Every place that behaves by kind is a switch or a
   `Record<WeaponKind, …>`, so the compiler lists them: the simulation's
   `fire` and the recorder's `fired` (`satisfies never`), the bots'
   `TACTICS` and `flightTime` (`sim/ai/think.ts`) and `blastRadius`
   (`sim/ai/perception.ts`), the view's `FIRE_CUE` and `SPINS`, the
   garage's `ROUND` and `kindSpecs`. The compiler can't list the rest:
   what the kind leaves in the world (a rocket's flight, a mine) in the
   simulation's state and step, its wire event (`net/events.ts`) and the
   recorder's line, the view's effects, and how the bots use it beyond
   the tables.

**A loadout slot** (e.g. a Super weapon)
1. `sim/loadout.ts`: a field (`super: WeaponId`), and its line in
   `parseLoadout` (the one reader: storage and the wire).
2. Garage: a pager for it. `createMatch`: arm it on the combatant (a second
   `WeaponState`) and a control bit (`Control.super`) the pilot sets.
3. `sim/simulation.ts` fires it in the step like the primary; `SimEvents`
   already cover shots and bursts. HUD: a second weapon panel.
   Rules, physics, runtime and navigation are untouched.

**A game mode**
1. `modes/<mode>/`: config, pure rules exposing the `ModeRules` shape plus
   its own state, its tests, and `mode.ts` with `lineUp` and a
   `create…Mode` that returns a `MatchMode` (with `kind`). The config also
   exports its traits (`TDM_TRAITS`): what code outside the folder may know
   about it (its name in a sentence, sides or not, a lobby's sizes, whether
   friendly fire means anything, Classic's size, length and pickups).
2. `modes/ids.ts`: its id; `modes/traits.ts`: its traits in `MODE_TRAITS`;
   `modes/modes.ts`: an entry (label, tags, blurb, lineUp, create).
3. UI integration: `modes/<mode>/HudPanel.tsx` and `ResultsPanel.tsx`, and
   their line in `modes/views.ts` (`MODE_VIEWS`); `MapSelect` lists it from
   the registry.

**A match setting** (a choice a custom lobby's owner makes)
1. `modes/matchSettings.ts`: its field in `MatchSettings` (what it means,
   in its comment), its value in `classic(mode)` (what Classic and
   practice play), its choices in `CUSTOM`, its line in `checkSettings`
   (the one check: the lobby form shows its errors, the server's `lb`
   check runs it and keeps nothing it didn't name) and its label.
2. Whatever plays by it reads it from `settings` (the mode's rules, the
   roster, the room), never from the mode's config.
3. Screens: its field in `screens/lobbies/LobbyForm.tsx`, its row in
   `SettingsCard.tsx`.
4. It travels by itself: the welcome, the `lb` messages, a lobby's view
   and a replay's header carry the whole `MatchSettings`. A new field
   changes their shape, so `PROTOCOL` goes up and the fixtures that hold
   settings change in that commit (`net/protocol.test.ts`'s welcome,
   `server/lobbies.test.ts`'s view). Its tests: the check's cases in
   `net/protocol.test.ts`, and the rules' in the mode's own tests.

**A pickup** (any mode that plugs the supply in)
1. `modes/items/items.ts`: an `ITEMS` entry (label, rarity, colour) and its group
   (`GROUPS`: what a custom lobby turns on); `modes/items/supply.ts` `apply()` for
   its effect (a timed effect is an `Effect` key).
2. `modes/items/pickups.ts`: its token geometry. A timed one (`timed: true`)
   is an `Effect` by that flag: the supply's effects, their sharing online and
   the HUD's chip follow (add its key to `noEffects` in `supply.ts`: the
   compiler asks).
3. `modes/ffa/rules.test.ts`: its effect.

**A HUD feature**
1. Markup in `hud/Hud.tsx` with a `data-hud` name (rendered once).
2. Its element in `collect()`, and its write in `update()` from the match
   state; mode-specific data through the mode's panel (`HudPanelHandle`,
   `hud/dom.ts`), never by asking which mode runs.
3. If it needs data the match doesn't expose yet, add it to the match state
   (from the view, pilot or feed) — never compute gameplay in the HUD.

## Online play

Online matches run on the game server (`game/server/`): the same
simulation, modes and bots, and the authority over every outcome. A page
sends its controls a step at a time and mirrors the room; Nakama signs
players in and carries the match chat, never the gameplay. Matchmaking,
who owns what, the two sources of a match, the loop per step, prediction
and lag compensation, adding content online, anti-cheat, what a room
keeps, the chat and the tests: [NET_ARCHITECTURE.md](../net/NET_ARCHITECTURE.md).
