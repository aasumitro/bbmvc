# State and resource ownership

After the refactor. Paths under `game/src/game/` unless noted. "Owner"
writes it; everyone else reads. Nothing authoritative lives in React state,
in the DOM or in meshes.

## Gameplay state (authoritative)

| State | Owner | Presented by |
| --- | --- | --- |
| match clock, rules phase (preMatch → complete) | the mode's rules (`ffa/rules.ts`, `tdm/rules.ts`) | HUD clock, banner, countdown |
| lives, protection, respawn times, FFA effects | `rules.contenders[]` | HUD chips, markers, scoreboard |
| kills, deaths, assists, streaks, scores | the rules, via `scoring.ts`, in `Combatant.stats` | HUD, results |
| team score, MVP (TDM); hot zone, standings, seed (FFA); items and effects (the supply, `MatchMode.supply`) | the mode's rules | HUD, minimap, `items/pickups.ts`, `ffa/zone.ts`, results |
| result | `MatchMode.outcome()` → `match.winner` | results |
| hull, alive, deadFor | `Combatant` (`simulation.ts`; damage amount from `rules.damage`) | HUD, markers, view (smoke, wrecks) |
| vehicle pose and velocity | Rapier body; copied once per step into `Combatant.position/rotation/velocity/speed` (`last` keeps the step before) | `view.ts` models, interpolated |
| wheel state (suspension, contact, spin) | Rapier ray-cast vehicle controller | `poseWheels`, dust, tyre squeal, F3 overlay |
| weapon ammo, cooldown, reload | `Combatant.weapon` (`combat.ts` `pullTrigger`; FFA ammo pickup) | HUD weapon panel |
| rockets in flight | `simulation.ts` (private) | view trails and bursts via `SimEvents` |
| controls (throttle, steer, handbrake, fire, aim) | the control source: `pilot.ts` (player), `ai.ts` brain (bots) | turrets, engine audio |
| match seed | `match.ts` (`match.seed`; a new one per restart) → the simulation's stream (bots, spread, wreck throw) and the FFA rules' stream (items, zones) | F3 overlay |

One deliberate duplicate: the pose exists in Rapier and on the combatant,
read back once per step so every system reads the same pose for that step.

## Local presentation state

| State | Owner |
| --- | --- |
| player-view phase (playing, paused, destroyed, victory, defeat) | `match.ts` (`state.phase`; React mirrors it through `onPhase` for menus only) |
| camera pose, look offsets, shake | `camera.ts` chase camera (in `view.ts`) |
| aim target and distance, rivals in sight | `pilot.ts` (`match.aim`, `match.seen`) |
| HUD pulses (hit, kill, damage), callout and pickup lines, last killer | `match.feedback` (`view.ts` writes pulses, `feed.ts` the lines) |
| kill feed lines | `feed.ts` (`match.feed`) |
| models, paint, wreck materials, turret angles | `view.ts` (`match.cars`) |
| particles, blast light | `effects.ts` |
| audio voices, listener | `view.ts` (engines, loops), `audio.ts` (context, buses) |
| scoreboard open (Tab) | `screens/GameCanvas.tsx` → `hud.scoreboard(open)` |
| loading progress, failed step | `screens/Loading.tsx` (startup), `screens/GameCanvas.tsx` (match start), from `runTasks` reports (`game/loading.ts`) |

## Preferences (not match state)

`settings.ts`: quality, resolution scale, FPS/debug toggles, sensitivity,
shake, volumes — saved in localStorage, read live by the camera, HUD, audio
and the runtime's composer. No gameplay rule reads a setting.

## Resources

| Resource | Created by | Released by |
| --- | --- | --- |
| Rapier WASM module | `initPhysics` (`physics.ts`), a startup task | never — session |
| WebGL renderer and context | `renderer.ts` (once), a startup task | never — one per session |
| animation loop | `mountRenderer` (runtime, turntable) | its teardown |
| scene, sun (shadow map), hemisphere light | `startGame` | its teardown: `sun.dispose()`, `scene.clear()` |
| sky dome, sky environment map | `environment.ts` (once) | never — session |
| arena meshes and colliders | `MAPS[id].build()` via `loadArena` (once per map), a match loading step | never — session cache; a match borrows it and `scene.clear()` hands it back |
| sound buffers | `prepareSounds` (`audio.ts`), a step of the first match's loading | never — session |
| materials, baked textures | `materials/library.ts` | never — session |
| composer and its render targets | `createComposer` (runtime; again on a quality change) | `disposeComposer` |
| Rapier world, bodies, colliders | `createWorld` + `enlist` (match) | `match.dispose` → `world.free()` |
| vehicle geometries, muzzle light | `view.ts` (per combatant) | `view.dispose` → `disposeGeometries` |
| particle pools, blast light | `effects.ts` (view) | `view.dispose` |
| pickups and hot-zone meshes | `items/pickups.ts`, `ffa/zone.ts` (handed to the adapter) | `mode.dispose` |
| engine and loop voices | `view.ts` | `view.dispose` (every voice stopped) |
| input listeners, pointer lock | `input.ts` (pilot) | `pilot.dispose` |
| settings listener | `startGame` | its teardown |
| `window.match`, `window.camera`, `window.tick` (dev) | `startGame` | its teardown (only if still its own) |
| garage scene, orbit controls, car | `turntable.ts` | `turntable.dispose` |

Teardown order for a match (`startGame`'s dispose): loop off → settings
listener → match (view, pilot, mode, world) → composer → sun → scene
cleared → dev globals. A start that failed or was abandoned halfway releases
what it had made the same way (`startGame`'s dispose works at any point).
