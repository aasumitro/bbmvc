# Module boundaries

What each module owns, what it may use, and what it must not. Paths under
`game/src/`. Checked with an import-graph scan (type imports included):
**no cycles** (before the refactor: `game/ai.ts ↔ game/match.ts`).

## Layers

```
Application / UI        App.tsx, screens/*, hud/*                      React: screens, menus, HUD markup
      ↓
Browser runtime         game/runtime.ts, game/turntable.ts,            scene, lighting, composer, loop, settings;
                        game/loading.ts                                loading: task runner, startup tasks
      ↓
Match (client)          game/match.ts                                  composition, frame, player-view phase, lifecycle
      ↓                         ↓                     ↓
Presentation            game/view.ts, feed.ts, pilot.ts,        Mode adapters   game/modes.ts (registry)
                        camera.ts, effects.ts, audio.ts,                        game/ffa/mode.ts, game/tdm/mode.ts
                        items/pickups.ts, ffa/zone.ts,                                  ↓
                        hud/minimap.ts
      ↓                                                         Mode rules      ffa/rules.ts, tdm/rules.ts,
Simulation              game/simulation.ts                      (pure)          tdm/tactics.ts, scoring.ts
      ↓                                                                                 ↑ (contract)
Engine adapters /       ai.ts, combat.ts, physics.ts, vehicle/drive.ts,         game/mode.ts (types)
content                 vehicle/vehicles.ts, arena/*, maps.ts, loadout.ts
      ↓
Rendering content       vehicle/vehicle.ts, vehicle/parts.ts, materials/*, geometry.ts, environment.ts, postprocessing.ts
```

## Modules

| Module | Owns | Uses | Must not use |
| --- | --- | --- | --- |
| `App.tsx` | screen state, the selected `Loadout`, the mode/map pick | screens | the match internals |
| `screens/Loading.tsx` | first screen: startup progress, failure, Retry | `STARTUP`, `runTasks` | what the tasks do |
| `screens/GameCanvas.tsx` | gameplay screen: match loading overlay (progress, failure), pause menu, exit confirm, results, Esc/Tab/F3/pointer-lock keys | `startGame`, `Match` API, HUD | Three.js scene set-up, physics |
| `screens/Garage.tsx` | garage UI; edits the loadout | `VEHICLES`, `WEAPONS`, `drivePerformance`, `createTurntable` | the match |
| `screens/MapSelect.tsx` | mode and arena choice | `MODES` (cards), `MAPS` | mode configs directly |
| `screens/Results.tsx`, `hud/Hud.tsx` | result screen; per-frame HUD DOM writes | `Match` state; the running mode's rules for mode panels (`mode.kind`) | Rapier, meshes other than `match.cars` poses |
| `game/runtime.ts` | one browser session: the match's loading steps, renderer settings, scene, sky, sun, arena borrowing, match, composer, settings watch, loop, dev globals | everything below | React, screens, HUD |
| `game/loading.ts` | the task runner (`runTasks`: order, progress, paint, cancel, first failure) and the startup list (`STARTUP`) | `physics.ts` (`initPhysics`), `renderer.ts` (`getRenderer`) | React, screens, the match |
| `game/match.ts` | practice roster, wiring, the frame (fixed steps + interpolation), player-view phase, pause/restart/dispose, HUD-facing state | simulation, view, pilot, feed, modes, physics | a specific mode, React, DOM (beyond the canvas it hands the pilot) |
| `game/simulation.ts` | combatants, the fixed step, driving, firing, hitscan, rockets, blast, damage, wrecks, crash detection, respawns; its seeded stream | `ai.ts`, `combat.ts`, `vehicle/drive.ts`, `vehicles.ts`, `rng.ts`, `MatchMode` | Three.js scene objects, audio, effects, camera, DOM, the local player, a specific mode |
| `game/view.ts` | car models (build, paint, wrecks, turrets, wheels, interpolation), effects, sound, chase camera, HUD pulses; implements `SimEvents` | `MODELS`, effects, audio, camera, materials | rules, damage, anything authoritative |
| `game/pilot.ts` | the local control source: input → controls, aim + lock-on, sight of rivals | `input.ts`, camera, world ray casts | rules, presentation |
| `game/feed.ts` | kill feed lines, callouts, announcer, countdown beeps; implements `Feed` | audio, scoring titles | mode internals (the adapters call it) |
| `game/mode.ts` | the mode contract (`MatchMode`, `ModeRules`, `Feed`, `Seat`, `ModeTiming`) | types only | values from any mode |
| `game/modes.ts` | mode registry: cards, line-up by size, adapter factory, the pickups and hot-zone views handed in | the adapters, `items/pickups.ts`, `ffa/zone.ts` | the match |
| `game/ffa/mode.ts`, `game/tdm/mode.ts` | the mode's integration: seats, rules creation, bot plan, outcome, event reporting, debug lines | own rules, config, tactics; `mode.ts` | rendering, audio, DOM (FFA's scenery is handed in) |
| `game/ffa/rules.ts`, `tdm/rules.ts`, `tdm/tactics.ts`, `scoring.ts`, `items/` (not `pickups.ts`) | the domain rules and statistics; the pickups any mode plugs in | config, `rng.ts`, `matchSettings.ts` | anything else (pure, node-checked) |
| `game/ai.ts` | bot driving and targeting | `Agent` (its own interface), Rapier casts, nav graph | the simulation module, modes |
| `game/combat.ts` | weapon registry (`WEAPONS` by id), weapon state, trigger, hitscan cast | Rapier | combatants |
| `game/vehicle/vehicles.ts` | vehicle registry (`VEHICLES` by id): handling, chassis, turret mount, armour, garage copy | types | Three.js, visuals |
| `game/vehicle/drive.ts` | the ray-cast car, driven by a car's own handling/chassis | Rapier, `physics.ts` | visuals, the registry |
| `game/vehicle/vehicle.ts` | vehicle models (`MODELS` by id) | `VEHICLES` layout, parts, materials | physics |
| `game/maps.ts` | arena registry (`MAPS`) and the session arena cache (`loadArena`) | arena builders | the match |
| `game/loadout.ts` | the `Loadout` type (ids) and the default | ids | everything else |

## Rules of thumb

- Direction: UI → runtime → match → (view | pilot | feed | mode adapters) →
  simulation → engine adapters and content. Nothing imports upward.
- The simulation reports; the view presents. A headless run gives it a
  no-op `SimEvents` (the simulation check does exactly that).
- A mode is reached only through `MatchMode`; the only places that ask
  which mode runs are its own adapter and the UI panels that show that
  mode's detail (`match.mode.kind` in `Hud.tsx`, `Results.tsx`).
- Registries are plain records keyed by id: `WEAPONS`, `VEHICLES` (+
  `MODELS`), `MAPS`, `MODES`. TypeScript's `Record<Id, …>` makes a missing
  entry a compile error; `simulation.check.ts` checks the numbers.
- Modules the node self-checks load write `.ts` on their local value
  imports (plain node needs the extension; type imports are erased): the
  rules, `scoring`, `simulation`, `vehicle/drive`, the mode adapters.
