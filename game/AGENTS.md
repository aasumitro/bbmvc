<!-- BEGIN:agent-rules -->

# game/ — the client and the game server

Architecture docs: `.claude/work/arch/` (ARCHITECTURE, GAME_LOOP, MODULE_BOUNDARIES, STATE_OWNERSHIP, LOADING_ARCHITECTURE).

## Commands

Client (`game/`):
- `npm run build` — `tsc -b && vite build` (typecheck then build; `tsc -b` covers `server/` too)
- `npm run lint` — oxlint
- `npm run preview` — preview production build

Game server (`game/`, same package; plan, log and runbook: `.claude/work/net/`):
- `npm run server` — build `dist-server/`, then run it on `:7360` (Nakama's local default key; `ALLOWED_ORIGINS`, `MAX_ROOMS`, `MAX_LOBBIES`, `NET_LAG_MS` / `NET_JITTER_MS` to feel latency locally; `MATCH_DIR` to keep match records and replays, `REPLAY_DAYS`: `server/main.ts`)
- `npm run server:build` — `vite build --config vite.server.config.ts` (the server and the bundled checks); `npm run server:check` — build, then the bundled checks
- `node dist-server/load.js` — capacity estimate (`ROOMS`, `SEATS`, `PLAYERS`, `SECONDS`)
- `node dist-server/replay.js <room.ndjson.gz> [matches-YYYY-MM.jsonl ...]` — a room run again from its replay: each match's result, its people and their fair-play counts; given the kept match records, whether each came out the same (exit 1 if not)

## Checks

No test runner runs yet (Vitest is installed, unused). `npm run check` runs the assert-style self-checks under plain node:
- `src/game/ai.check.ts` (bots' router)
- `src/game/bots.check.ts` (bots at every difficulty on a headless city yard: guns and leading, never stuck or parked, both guns pull their weight, cover and ambushes, harder wrecks more)
- `src/game/ffa/ffa.check.ts` (free-for-all rules)
- `src/game/tdm/tdm.check.ts` (team deathmatch rules and team AI)
- `src/game/simulation.check.ts` (both modes through the real simulation, headless: damage, wrecks, scoring, respawns, result, restart; a bots-only match replayed bit for bit from its seed; content numbers)
- `src/game/loading.check.ts` (the loading runner: progress counts finished tasks, failure, retry, cancel)
- `src/net/protocol.check.ts` (the wire: round trips, the binary snapshot frame, every rule a client message must pass)
- `src/net/chat.check.ts` (what a line typed into the match chat asks for: messages, whispers by whole or partial names with spaces, replies, mute, the notes)
- `server/matchmaker.check.ts` (Classic's matchmaking on a clock moved by hand: the queue and its grace, group sizes as the oldest waits, the ready check and every way it ends, requeue keeping the place, backfill)
- `server/custom.check.ts` (custom lobbies on a clock moved by hand: every member's and owner's action and its refusals, starting from 2 of 12, sides, the owner leaving, the grace, idle lobbies, caps, codes, passwords and bans, the tally, a list with no secrets)
- `server/fairplay.check.ts` (the fair-play signals: a fair player is never flagged; aim inside a hidden hostile, snaps and instant triggers are)

then `server:check`, bundled:
- `server/arena.check.ts` (both arenas built headless: starts, bases, zones, nav in one piece, digests — the ones in `server/digests.json`)
- `server/server.check.ts` (a real server over real sockets: the door and the build id, rooms and seats, the welcome's chat channels and user ids, the bot at the wheel until a newcomer's first input, authority, forged and stale input, a page that stops reading, the next match, a room is the practice simulation bit for bit, a room's match record and its replay run again to the same end, rewound rounds and a machine's past life, bytes and step times; matchmaking sessions: a second tab takes the ticket, a seated player can't search, the ready check, a drop and its grace, a room per proposal opened once, the first match held for the pages to load, the load timeout, backfill; custom lobbies: a room from a seat plan, empty seats, the end handed to the lobby, its replay to the bit, and over real sockets the list, joins by password and by code, a lobby's match on its members' sockets, join in progress, a kick, a minute without input, a drop and back, the tally, no code or password in the logs)
- `server/client.check.ts` (headless pages through `net/`: mirror, events, inputs, seats, catch-up, lost connection, a matchmade seat on the socket that searched; a custom lobby's store: a lobby made, its match on the same socket and back to the waiting room, the tally, back in after a drop (waiting or in a match) or a reload, too late after the grace, an invite link, a kick mid-match)
- `server/netplay.check.ts` (50–150 ms each way: prediction corrections and errors, drawn poses, lag-compensated hits; a rough link with stalls: the input queue drained)

Node checks import local modules with `.ts`; the bundled ones need Vite (extensionless imports, `import.meta.env`).

In dev builds the runtime exposes `window.match` (live state; `match.mode` is the running mode, `match.mode.rules` its rules, `match.mode.kind` which), `window.camera` and `window.tick(ms)` (step one frame by hand — rAF stops in hidden tabs); F3 toggles the debug overlay.

## Technology stack

- **React** — UI layer only (menus, HUD, lobby, connection status, debug UI). Must NOT drive the high-frequency game loop or hold physics state — don't re-render the component tree every physics tick.
- **TypeScript** — strict typing throughout the client. Explicit domain types for vehicle/player/weapon/projectile state, network messages, config, match state.
- **Three.js** — rendering only (scene, camera, meshes, materials, lighting, particles, procedural geometry, imported glTF models via `GLTFLoader`). Three.js meshes are never the authoritative source of gameplay state.
- **Rapier 3D** — physics (rigid bodies, colliders, vehicle physics, collisions, impulses). Arcade-style vehicle handling, not a realistic sim. Fixed physics timestep, decoupled from render FPS.
- **Game server** (`game/server`, Node + `ws`) — the authority for online matches: runs the client's own simulation, modes and bots (one implementation), validates every input, owns every outcome.

## Imported assets (glTF/GLB)

Vehicles, arena structures, and other hero visuals may be authored externally (Blender, or AI-generated mesh output) and imported as **`.glb`/`.gltf` only** via Three.js `GLTFLoader`. This replaces the earlier procedural-only rule — that rule produced a real, fixed realism ceiling (stylized low-poly, no baked normal/roughness/AO maps), and the project wants to push past it.

- Only `.glb`/`.gltf`. No `.fbx`/`.obj`/`.dae` — convert to glTF at the source (Blender's glTF exporter, or ask the generating tool for glTF directly).
- Store imported assets under `game/public/models/`, load via `GLTFLoader` at runtime.
- Baked textures (Base Color/Normal/Roughness/Metallic/AO) travel inside the glTF file; favor 1–2K over 4K for web delivery until there's a reason to go bigger.
- Procedural generation (`arena/`, `vehicle/`, `materials/` under `game/src/game/`) is no longer mandatory, but stays valid for placeholder geometry, prototyping, and cheap runtime effects (explosions, particles, projectiles, weathering) where authoring a real asset isn't worth it.
- Don't delete the existing procedural vehicle/arena code when a real asset lands for the same slot — keep it as fallback/reference until the replacement is confirmed good.

## Code map (`game/src/game/`)

```
runtime.ts           startGame(): one browser session — the match's loading steps (physics, arena, sounds, match set-up, shaders; progress to the overlay), renderer set-up, scene (sky, sun, cached arena), match, composer + live settings, render loop, dev globals; dispose releases whatever exists, even after a failed start; screens/GameCanvas.tsx (the gameplay screen: loading overlay, pause menu, results, keys) starts and disposes it
loading.ts           loading: runTasks (tasks in order, progress = finished/total, each report painted before its task, cancel, first failure) and STARTUP, what the main menu waits for (physics engine, WebGL renderer, menu backdrop + fonts); screens/Loading.tsx shows it, with Retry. Everything else loads on first use — no timers, no fake progress
match.ts             one local match: seats the line-up (player + bots), wires simulation / mode / view / pilot / feed, fixed 60 Hz steps + interpolation, the player's view phase, pause/restart/dispose; the HUD reads it. Never branches on the mode
simulation.ts        authoritative + player-agnostic: combatants (enlist), the fixed step (bots think, drive, fire, physics, crashes, rockets), hitscan, rocket blast, damage, wrecks, respawns, stuck recovery (back on the nearest free road node: by itself after 4 s, or the player's R); reports to the view through SimEvents; runs headless (simulation.check.ts). Gameplay randomness comes from the match seed (match.seed, F3) — never Math.random in gameplay code
view.ts              the match as the player sees/hears it: car models (MODELS, liveries, wrecks, turrets, wheels, interpolation), effects, engine/loop audio, chase camera, HUD pulses; implements SimEvents
pilot.ts             the local control source: input -> player controls, aim from the crosshair + lock-on, rivals in sight; feed.ts kill feed, callouts, announcer, countdown beeps
mode.ts / modes.ts   the mode contract (MatchMode, ModeRules, Feed, Seat; the life cycle, an empty seat's `absent` too) / the registry: arena-screen cards, lineUp by size, adapter factory (ffa/mode.ts, tdm/mode.ts); matchSettings.ts: how a match is played (size, clock, respawn speed, friendly fire, pickups, weapons, kill limit), classic(mode) for Classic and practice
maps.ts              arena registry: name, preview, modes hosted (both arenas host both modes); loadArena() = the session arena cache
loadout.ts           Loadout = { vehicle, weapon } as registry ids: garage -> App -> match; the last pick kept in localStorage (scrapyard.loadout), unknown ids back to the default
physics.ts           Rapier init (initPhysics: once, retryable, a startup task) + static world built from arena.colliders; vehicle/drive.ts = ray-cast car driven by each car's own Handling + Chassis (drivePerformance() = the garage spec sheet); vehicle/vehicles.ts = VEHICLES registry (handling, chassis, turret mount, armour, garage copy)
camera.ts            chase camera (CHASE_CAMERA tuning); input.ts keyboard/mouse/pointer lock; combat.ts WEAPONS registry by id (the garage loadout) + trigger + hitscan; turntable.ts the garage car stage
ai.ts                bots: DIFFICULTIES (the arena screen's Easy/Normal/Hard: gun scaling and skill), armBot (a seeded pick off the WEAPONS roster), target choice, routes over the arena's nav graph (pure pursuit, right lane, braking for bends), combat by gun (circle, or weave at range; aim led by the target's speed), cover and ambushes out of sight, backing out toward open ground; optional Plan hooks (target value, errands)
scoring.ts           combat statistics shared by both modes: Stats, per-life damage attribution, assists, streaks, multi-kills, revenge/nemesis, combat score (numbers from each mode's config)
items/               pickups, for any mode that plugs them in: config.ts (SUPPLY tuning), items.ts (catalogue, drops, bot errands), supply.ts (a match's items and effects: waves, expiry, pickups, damage/armor/speed; hooks shape each drop), pickups.ts (view, handed to the adapter)
ffa/                 free for all: config.ts (FFA tuning), rules.ts (pure rules: clock/phases, overtime, respawn waits, spawn scoring, kills, hot zones and the supply plugged in, standings; event queue), mode.ts (the MatchMode adapter: seats, bot plan, outcome, events -> feed), zone.ts (the hot zone's view), ffa.check.ts; docs in .claude/work/ffa/
tdm/                 team deathmatch: config.ts (TDM tuning), types.ts, rules.ts (pure rules: pre-match/active/overtime/complete, team score, respawn waits, protection that ends on firing, team-aware spawn scoring, MVP; event queue), tactics.ts (team AI: target value, errands, stances — the ai.ts Plan hooks), mode.ts (the MatchMode adapter), tdm.check.ts; docs in .claude/work/tdm/
effects.ts           pooled point particles: tracers, flashes, sparks, explosions, debris, fire, smoke, tyre smoke, dust
audio.ts             Web Audio playback (CUES/LOOPS levels, distance falloff + pan, engine revs); sounds.ts synthesizes every sound in code, no audio files
renderer.ts          one shared WebGLRenderer for the whole app; screens call mountRenderer(), never new WebGLRenderer()
environment.ts       sunset sky dome, sun + shadows, sky environment map (IBL), haze
postprocessing.ts    arena composer: MSAA -> GTAO -> bloom -> ACES output; QUALITY presets (low/medium/high) drop the costly steps
settings.ts          player settings (quality, resolution scale, sensitivity, shake, volumes, debug): live values read each frame or via onSettingsChange, saved in localStorage
geometry.ts          part/tube/bentTube/truss/extrudeProfile helpers, boxUV, mergeByMaterial, scatter (instancing)
materials/           library.ts is the only material source; recipes.ts = GLSL surface recipes baked to PBR textures on the GPU (bake.ts); facade.ts = building styles + the lit-rooms (interior mapping) shader
vehicle/             parts.ts (wheel, blade, lamp, minigun...) + vehicle.ts (war rig model; MODELS by vehicle id) + vehicles.ts (specs) + drive.ts (physics)
arena/               arena.ts: the Arena contract (spawns, bases, zones, colliders, nav graph, emitters, minimap floor) + shared helpers (clutterKit: shells, walls, heaps, bales, tyres, drums; chunks; spreadOut); props.ts (barrier, container, tower, crane, shed, plane, tank, crusher...); ground.ts
                     scrapyard.ts: the Scrapyard at City scale (walled octagon: the Crest + ring road at its heart, 8 walled spokes, middle track, perimeter road, 8 themed yards = hot zones, gate-apron crew bases, skyline)
                     city.ts: The City (street grid, themed blocks, boundary, skyline, nav); buildings.ts (facade walls, tenements, panels, glass towers); street.ts (signals, buses, trees, cranes, signs...)
```

- More in `src/game/`: `online.ts` (an online match: the welcome's line-up seated locally, run through match.ts `playMatch` like practice — match.ts holds the player's side shared by both, the source of steps is practice's simulation or the net client), `roster.ts` (who takes each seat: practice and online rooms), `arena/digest.ts` (the arena's fingerprint: F3 `ARENA`, checked against the server's on joining).
- Outside `src/game/`:
  - `src/net/session.ts` signs the player in once the main menu shows (the site's stored session, refreshed; else a guest by device ID) and names them in the menu; practice never waits on it and shows "Offline" without a server; `freshSession()` for going online.
  - `src/net/matchmaking.ts` Classic's matchmaking as the page sees it (a store every screen reads: Find Match, the server's word on the ticket, the ready check, the seat's welcome turned into the match's link; the socket from Find Match on, back within the server's grace after a drop or a reload), shown by `screens/Matchmaking.tsx` over any screen (a practice match included) and the arena screen's Classic button.
  - `src/net/protocol.ts` the wire (messages, quantized numbers, the snapshot as a binary frame of the same integers — `packSnapshot` / `readServer` — everything else JSON; `parseClient` and the server's rules for client input; `PROTOCOL` bumps on any change; `BUILD`, the build id from `game/build-id.ts` — a hash of `src/`, `server/` and the lockfile that Vite puts in both bundles — which the server must match: 'dev' pages from the dev server pass unless `TRUST_PROXY`), `connection.ts` the socket (hello, a seat at once for the checks, the match's link, reasons in the player's words), `client.ts` the page's mirror of a server match (DOM-free), `prediction.ts` the player's own car ahead of the server, `snapshots.ts` the others drawn a little in the past.
  - `src/net/custom.ts` custom lobbies as the page sees them (a store the arena screen's Custom entry reads: the list, the waiting room, the lobby's match — its welcome turned into the match's link with the lobby's word passed aside, the socket taken back once the match is over for the player; back within the server's grace after a drop or a reload, the tab's lobby in sessionStorage `scrapyard.lobby`; an invite link `?join=CODE`, read by `App.tsx`), shown by `screens/Custom.tsx`: `Lobbies.tsx` (the list, join by code), `LobbyForm.tsx` (the create and edit drawer), `Lobby.tsx` (the waiting room, its chat docked); `Avatar.tsx` (a helmet drawn from the user id), `Confirm.tsx` (the yes/no dialog: leaving a match, leaving a lobby).
  - `src/net/chat.ts` the match chat over the page's Nakama socket (`session.ts` `onSocket`): the room's and the team's channels the welcome names, whispers as direct messages to a seat's user id; what a typed line asks for (`/w`, `/r`, `/mute`, names with spaces) is `chatCommand.ts`'s, pure; `hud/Chat.tsx` its box (Enter, T), which `screens/GameCanvas.tsx` shows while an online match is played — typing never drives (the chat's keys stop at its input; `input.ts` ignores text boxes).
  - `src/analytics.ts` Google Analytics: one page view on the first main menu, only if the site's cookie banner got a yes (root `AGENTS.md`); nothing from a match.
  - Public assets are addressed through `import.meta.env.BASE_URL` (the build's base is `/play/` on the site).
- `game/server/`:
  - `main.ts` (environment, arenas built up front), `server.ts` (http `/health`, ws `/match`, the door's limits, one fixed-step loop), `auth.ts` (HS256 session tokens)
  - `matchmaker.ts` (Classic's matchmaking, pure: every number in `MATCHMAKING`; tickets, groups by mode, arena and build as the oldest waits, the ready check, requeue, backfill offers; a match plays on the arena its tickets picked); `custom.ts` (custom lobbies, pure the same way: every number in `LOBBIES`; lobbies, members, slots and sides, owners, bans, invite codes, passwords, the tally, the grace, idle lobbies, the list; hooks for what it can't do itself)
  - `lobby.ts` (rooms and who goes where: matchmaking sessions, one live connection per user, a room for each proposal that starts, a backfill into a bot's seat; a session uses Classic's queue or custom lobbies, not both: a lobby's match gets a room of its own, its members seated on their lobby sockets and handed back after; a hello with a mode and an arena is seated at once in a room there — the checks, the load tool, the deploy's smoke test)
  - `room.ts` (one match: seats, inputs, snapshots, state, results -> next match; a matchmade room holds its first match until its people's pages load; each seat's chat channels; the match record when a match ends; the journal a replay needs; a custom lobby's room: its seat plan, empty seats, the lobby's settings and chat channel, the end handed back to the lobby), `recorder.ts` (SimEvents -> wire events), `rewind.ts` (lag compensation)
  - `fairplay.ts` (signs of aim help per person, pure: firing into a hidden hostile, snaps onto hostiles, instant triggers; flags for a person to review, nothing automatic), `records.ts` (`MATCH_DIR`: a JSON line per match, a gzipped replay per room, old replays pruned), `replay.ts` + `replay-main.ts` (a room run again from its journal, to the bit: `dist-server/replay.js`)
  - `arenas.ts` + `headless.ts` (the browser's arena builders run in Node), `digests.json` (each arena's expected digest: `arena.check` asserts it, `scripts/match-smoke.mjs` holds the deployed server to it), `browser.ts` (a headless page, for the checks).
- Gameplay state (health, weapons, poses) lives in the simulation's combatants and Rapier bodies, match rules in the running mode's rules; meshes only mirror it (view.ts), interpolated between physics steps. React never re-renders per frame: the HUD writes to the DOM from the game loop.
- Adding content is additive: a vehicle = a VEHICLES entry + its MODELS builder; a weapon = a WEAPONS entry (+ turret model); a map = a builder + a MAPS entry; a mode = its folder (rules, check, mode.ts adapter) + a MODES entry + its HUD/results panels. How-tos: `.claude/work/arch/ARCHITECTURE.md`.
- Solid props declare collision shapes with `solid()` in props.ts; arena.ts collects them (world space) into `arena.colliders`, which feed both physics and the minimap.

- Library materials and baked textures live for the session — never dispose them from scene code; dispose only geometries (`disposeGeometries`).
- Static props are plain groups merged per material (`mergeByMaterial`); anything that moves on its own (wheels, turret, crane claws) stays outside the merged root. High-count clutter goes through `scatter` (InstancedMesh).
- Conventions: metres, +Y up, +Z forward (glTF convention, so imported models drop in facing the same way), driver's left is +X, north is -Z. No negative scales on merged parts.
- Vehicle node names are a contract for gameplay: `body`, `turret` (yaw) > `gun` (pitch), `wheel_fl/fr/rl/rr`.
- The old flat-box generators (`VehicleGenerator.ts`, `ArenaGenerator.ts`, `proceduralTexture.ts`) are unused and only kept as reference until the new ones are confirmed.

## Architecture: client vs server authority

The client is never trusted for gameplay outcomes. It sends **input/intent** — its controls, where it aims, the tick it sees, a sequence number — never results (never "I hit Player 2 for 100 damage"). The game server resolves and owns: damage, kills, hit results, destruction, weapon cooldowns and ammo, projectiles, respawns, protection, pickups, scores, recovery, match lifecycle. That authority is the anti-cheat; `server/server.ts` and `protocol.ts` add the door (origins, signed sessions, sizes, rates, strikes, a cap on what waits for a page that stopped reading). What authority can't stop, aim help, `server/fairplay.ts` flags for review, with the replay to look at. Known limits (aim help, wallhacks, token revocation): `.claude/work/net/NET_PLAN.md`.

Client responsibilities: input, rendering, camera, local prediction, interpolation, animation, particles, audio, UI.
Game server responsibilities: matchmaking (who plays whom, when, which arena), the match (the same `simulation.ts`, modes and bots as practice), validation, weapon rules, damage, destruction, respawn, lag compensation for hitscan.

Conceptual split inside `game/`:
```
React            — UI/HUD/menus (no game loop)
Game Runtime     — Three.js (rendering) + Rapier (physics) + game systems (vehicles, weapons, combat, projectiles, arena, effects, camera)
Net client       — src/net: the match socket, the mirror of the server's match, prediction, interpolation
Game server      — game/server: rooms running the simulation, headless
```

## Networking model

Authoritative server: Classic matches take 8 machines (people take bots' seats; bots fill the rest), a custom lobby's up to 12 (bots only where its owner put them; an empty seat stays empty). Classic is matchmaking on the one game server process: a session per player, a ticket per mode and arena, groups formed as the oldest waits (8, then 4+, then 2+), a ready check, a room per proposal, backfill into bots' seats; plan and log in `.claude/work/mm/`. Custom lobbies live in that process's memory too (`server/custom.ts`): a list, invite codes, a waiting room, matches their owner starts with the lobby's settings, each in a room of its own that shares `MAX_ROOMS` with Classic's; plan and log in `.claude/work/custom/`. The simulation steps at 60 Hz on both sides (`PHYSICS_STEP`); snapshots go out at 30 Hz, the rules' state when it changes, one input comes in per client step. WebSocket: the snapshots as binary frames, everything else JSON, all of it quantized integers (`protocol.ts`). Every match that ends is recorded with each person's fair-play counts, and each room keeps a replay that runs it again (`MATCH_DIR`). Chat goes over Nakama, never through the game server. Nakama is the control plane only; why gameplay stays here: `.claude/work/nakama-mm/PLAN.md`. The local car is predicted and reconciled; the others are drawn two snapshot intervals (67 ms) in the past; hitscan is rewound on the server to what the shooter saw, 200 ms at most. The server's events are played as the drawing reaches them, the player's own at once. Design, measurements and limits: `.claude/work/net/` (NET_PLAN, NET_LOG, NET_RUNBOOK).

## Engineering principles

1. React stays out of the realtime game loop; rendering stays out of simulation; physics stays out of networking presentation.
2. Never use Three.js meshes or React state as authoritative game state.
3. Never trust client-reported combat results — server validates everything.
4. Procedural generation should be deterministic where practical.

## Where this project departs from the shared guides

- Tests: the plain-node `npm run check` and the bundled server checks above, not `ts/testing.md`'s Vitest conventions or `*.test.ts` files.
- Formatting: no formatter is configured; lint is oxlint (`.oxlintrc.json`). `ts/README.md` rule 5 (prettier/biome) waits until one is added.
- tsconfig: TypeScript 6 is strict by default, so the tsconfigs don't set `"strict"`; `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (`ts/tooling-and-migration.md`) are off. Don't change the tsconfigs to match the guide.
- File names: PascalCase components (`screens/GameCanvas.tsx`), camelCase modules (`simulation.ts`, `materials/canvasTextures.ts`), not `ts/patterns.md`'s kebab-case default.

<!-- END:agent-rules -->
