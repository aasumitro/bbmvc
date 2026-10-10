<!-- BEGIN:agent-rules -->

# game/ — the client and the game server

Architecture docs: `.claude/work/arch/` (ARCHITECTURE, GAME_LOOP, MODULE_BOUNDARIES, STATE_OWNERSHIP, LOADING_ARCHITECTURE).

## Commands

Client (`game/`):
- `npm run build` — `tsc -b && vite build` (typecheck then build; `tsc -b` covers `server/` too)
- `npm run lint` — oxlint
- `npm run format` — Prettier over `src/`, `server/` and the root's `.ts` files (`.prettierrc`; Tailwind classes sorted by its plugin); `npm run format:check` — the same, checked only (CI)
- `npm test` — every test, once (Vitest: the unit project, then the integration one; `npm run test:watch` keeps watching)
- `npm run test:coverage` — the same, with V8's coverage of `src/` and `server/` printed (no threshold yet)
- `npm run preview` — preview production build

Game server (`game/`, same package; plan, log and runbook: `.claude/work/net/`):
- `npm run server` — build `dist-server/`, then run it on `:7360` (Nakama's local default key; `ALLOWED_ORIGINS`, `MAX_ROOMS`, `MAX_LOBBIES`, `NET_LAG_MS` / `NET_JITTER_MS` to feel latency locally; `MATCH_DIR` to keep match records and replays, `REPLAY_DAYS`: `server/main.ts`)
- `npm run server:build` — `vite build --config vite.server.config.ts` (the server, the capacity tool, the replay runner)
- `node dist-server/load.js` — capacity estimate (`ROOMS`, `SEATS`, `PLAYERS`, `SECONDS`)
- `node dist-server/replay.js <room.ndjson.gz> [matches-YYYY-MM.jsonl ...]` — a room run again from its replay: each match's result, its people and their fair-play counts; given the kept match records, whether each came out the same (exit 1 if not)

## Tests

`npm test` runs Vitest (`vitest.config.ts`), in node, two projects. `unit`: `src/**/*.test.{ts,tsx}`, `server/**/*.test.ts` and `*.test.ts` at the game's root (`__BUILD__` `'dev'`). `integration`: `server/{arenas,server,client,netplay}.test.ts`, one file at a time in forks, after the unit tests, with this tree's build id. What a test prints shows even when it passes: the bots' kills a minute, Classic's and the custom pins, the arenas' digests. The build id skips tests. By folder:
- `src/shared/`, `src/sim/`: the math and time helpers, the difficulties, the loadout parser; the bots' router (`ai/navigation.test.ts`) and the bots at every difficulty on a headless city yard (`bots.test.ts`: guns and leading, never stuck or parked, both guns pull their weight, cover and ambushes, harder wrecks more, its kills a minute); both modes through the real simulation, headless (`simulation.test.ts`: damage, wrecks, scoring, respawns, result, restart, a bots-only match replayed from its seed, the two yard pins, content numbers)
- `src/content/`, `src/modes/`: the weapon table; the mode traits; the item catalogue; free for all's and team deathmatch's rules (`ffa/rules.test.ts`, `tdm/rules.test.ts`, with the team AI)
- `src/runtime/`: the loading runner (progress, failure, retry, cancel)
- `src/net/`: the wire (`protocol.test.ts`: round trips, the binary snapshot, every rule a client message must pass, fixtures pinned to the byte), the event codec, the lobby rules, the session socket's retries and mark, the chat line (`chatCommand.test.ts`)
- `server/` (unit): Classic's matchmaking and custom lobbies on clocks moved by hand (`matchmaker.test.ts`, `lobbies.test.ts`: a lobby's row and view pinned as JSON), the fair-play signals, the input queue, the event codec against a real room's events
- `server/` (integration): both arenas built headless (`arenas.test.ts`: digests from `server/digests.json`, the new-map checklist, every mode each hosts at its biggest); a real server over real sockets (`server.test.ts`: the door and the build id, rooms and seats, authority, each wire event as recorded, whole matches of bots pinned by hash — Classic's four, two custom — replays to the bit, matchmaking sessions, custom lobbies over sockets, two vehicles: a takeover in the other, a mixed custom room replayed); headless pages through `net/` (`client.test.ts`: the mirror, a matchmade seat, a custom lobby's store through drops and reloads); 50–150 ms each way (`netplay.test.ts`: prediction, drawn poses, lag-compensated hits, a second vehicle predicted, a rough link's input queue drained)
- the root: `repo.test.ts` (no `*.check.ts` comes back; no mode literal outside the modes)

Every relative import names its file (`./rng.ts`, `./Hud.tsx`).

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
- Procedural generation (`content/` and `render/materials/` under `game/src/`) is no longer mandatory, but stays valid for placeholder geometry, prototyping, and cheap runtime effects (explosions, particles, projectiles, weathering) where authoring a real asset isn't worth it.
- Don't delete the existing procedural vehicle/arena code when a real asset lands for the same slot — keep it as fallback/reference until the replacement is confirmed good.

## Code map

`game/src/` is in layer folders, lowest first: a module imports from its own level or a lower one. `game/server/` stays flat.

```
shared/     rng.ts: mulberry32, the one seeded stream every other rests on; math.ts: wrap (an angle into -π..π), Point {x, z}, distance;
            time.ts: clock (mm:ss), ms (match-clock times on the wire: whole milliseconds)
render/     renderer.ts (one shared WebGLRenderer: screens call mountRenderer(), never new WebGLRenderer()), environment.ts (sky, sun, IBL, haze),
            postprocessing.ts (MSAA -> GTAO -> bloom -> ACES; QUALITY presets), geometry.ts (part/tube/truss helpers, boxUV, mergeByMaterial, scatter);
            materials/: library.ts the only material source, recipes.ts GLSL surfaces baked to PBR textures (bake.ts), facade.ts building styles + lit rooms
content/    parts.ts (wheel, blade, lamp, spike, the turret's yoke); vehicles/: vehicles.ts (VEHICLES: handling, chassis, turret mount, armour, garage
            copy), types.ts (Handling, Chassis, VehicleOptions, ModelParts), models.ts (MODELS by vehicle id; what every model shares: the merged
            body, the turret on its ring, the wheels), models/ (a body builder per vehicle: razor.ts); arenas/: arena.ts (the Arena contract: spawns,
            bases, zones, colliders, nav, emitters, minimap floor; clutterKit), maps.ts (MAPS: name, preview, modes hosted; mapsFor), digest.ts (the
            arena's fingerprint, F3 ARENA, checked against the server's), scrapyard.ts, city.ts, kit/ (props, ground, buildings, street); weapons/:
            weapons.ts (WEAPONS, the one table: WeaponId, WeaponSpec by kind, TurretKey; no Rapier, no Three.js), turrets.ts (TURRETS by key),
            turrets/ (a builder per turret)
sim/        simulation.ts (authoritative, player-agnostic: enlist, changeVehicle, the fixed step, hitscan, rockets, damage, wrecks, respawns, stuck recovery;
            SimEvents to the view; runs headless), matchMode.ts (the mode contract: MatchMode, ModeRules, Feed, Seat, SupplyView), combat.ts (a weapon
            in the match: trigger, hitscan), physics.ts (initPhysics, the static world), drive.ts (the ray-cast car; drivePerformance), scoring.ts
            (Stats, assists, streaks, nemesis), ai/ (bots: brain.ts what a bot is, armBot, Plan hooks; perception.ts; navigation.ts routes;
            think.ts targets, combat by gun, cover), difficulty.ts (DIFFICULTIES: how well bots play), loadout.ts (Loadout ids; parseLoadout, the
            one reader for storage and the wire)
modes/      modes.ts (MODES: the arena screen's cards, lineUp by size, the adapter factory), traits.ts (MODE_TRAITS: what shared code may know of a
            mode; MAX_SEATS, sideOf), matchSettings.ts (how a match is played; classic(mode)), roster.ts (who takes each seat; SeatPlan); items/
            (pickups any mode plugs in: SUPPLY, the catalogue, a match's supply, the tokens' view); scenery.ts (what the browser draws of a
            mode: tokens, MODE_SCENERY); views.ts (MODE_VIEWS: each mode's HudPanel and ResultsPanel, client-only); ffa/, tdm/: config, pure
            rules with an event queue, the MatchMode adapter (mode.ts), HudPanel.tsx, ResultsPanel.tsx, tests; ffa's hot zone (zone.ts), tdm's
            types and team AI (tactics.ts); docs in .claude/work/ffa/ and tdm/
view/       view.ts (the match as the player sees and hears it: car models, turrets, wheels, interpolation; implements SimEvents), pilot.ts (input ->
            controls, aim, lock-on), feed.ts (kill feed, callouts, announcer), input.ts, camera.ts (CHASE_CAMERA), effects.ts (pooled particles),
            audio.ts + sounds.ts (Web Audio; every sound synthesized), settings.ts (the player's, in localStorage), turntable.ts (the garage stage)
runtime/    runtime.ts (startGame: the match's loading steps, renderer, scene, match, composer, render loop, dev globals; dispose releases whatever
            exists; the arenas built, kept for the session), match.ts (one match: seats, wiring, fixed 60 Hz steps + interpolation, the player's
            phase; never branches on the mode), practice.ts (a practice match: the player and bots, the simulation run here), online.ts (an
            online match through the same playMatch), loading.ts (runTasks; STARTUP, what the main menu waits for), stored.ts (the loadout
            this browser keeps: localStorage scrapyard.loadout)
net/        protocol.ts (the wire: messages, quantized numbers, the binary snapshot, parseClient and the server's rules, PROTOCOL, BUILD),
            events.ts (the match's wire events: each code's fields and quantization, encode/decode, whose they are), connection.ts (the
            socket), client.ts (the mirror of a server match, DOM-free), prediction.ts, snapshots.ts (the others drawn 67 ms back), session.ts
            (Nakama: the site's session or a guest), matchmaking.ts (Classic's store), lobbies.ts (custom lobbies' store; ?join=),
            sessionSocket.ts (what both stores share: the dial, the retries within the grace, the tab's mark), lobbyRules.ts
            (a lobby's rules the server holds and the waiting room shows: startable, tallyKey), lobbyProtocol.ts (the lobbies' wire: their
            messages and the 'lb' check), limits.ts (what the wire holds messages to), chat.ts + chatCommand.ts (the match chat over Nakama)
screens/    MainMenu, Garage, MapSelect, Matchmaking (the ready check over any screen), GameCanvas (the gameplay screen; LoadingOverlay,
            PauseMenu, ExitConfirm), Results (the mode's ResultsPanel, the tally, the buttons), ResultsFrame + resultsFormat (what the panels
            fill), Loading; hooks.ts (useSearch, useCustom, useClock); lobbies/: Custom, Lobbies (the list), LobbyForm (the drawer),
            Lobby (the waiting room: SlotGrid, SettingsCard, InviteCard; kit.ts, what they share)
hud/        Hud.tsx (written to the DOM from the game loop; the mode's HudPanel at the top left), dom.ts (the DOM writes and HudPanelHandle:
            what the HUD asks of a mode's panel), minimap.ts, Chat.tsx (Enter, T; typing never drives)
server/     main.ts, server.ts (/health, ws /match, the door, one fixed-step loop), netsim.ts (the dev latency simulator), auth.ts, seating.ts (who goes where: sessions, a room per
            proposal, backfill, a lobby's match in a room of its own), matchmaker.ts (Classic, pure), lobbies.ts (custom lobbies, pure), room.ts (one
            match: seats, inputs, snapshots, results, the record and the journal), inputs.ts (a person's input queue, pure), journal.ts (the
            replay's lines: the one persisted format), recorder.ts, rewind.ts, fairplay.ts, records.ts (MATCH_DIR),
            replay.ts + replay-main.ts, arenas.ts + headless.ts (the browser's builders in Node), digests.json, load.ts, browser.ts (the tests' page), testVehicle.ts (the tests' second vehicle)
```

- Gameplay state (health, weapons, poses) lives in the simulation's combatants and Rapier bodies, the rules in the running mode; meshes only mirror it, interpolated between steps. React never re-renders per frame. Gameplay randomness comes from the match seed (`match.seed`, F3), never `Math.random`.
- `BUILD` (`net/protocol.ts`) is the build id from `game/build-id.ts`: a hash of `src/` and `server/` (tests aside) and the lockfile, put in both bundles; the server lets in only pages of its own ('dev' from the dev server passes unless `TRUST_PROXY`).
- `net/session.ts` signs the player in once the main menu shows; practice never waits on it. Classic's store (`net/matchmaking.ts`) and the custom lobbies' (`net/lobbies.ts`, the tab's lobby in sessionStorage `scrapyard.lobby`) keep their socket through a drop or a reload within the server's grace. `src/analytics.ts`: one page view, only after the site's cookie banner got a yes (root `AGENTS.md`).
- Public assets are addressed through `import.meta.env.BASE_URL` (the build's base is `/play/` on the site).
- Adding content is additive: a vehicle = a `VEHICLES` row + its `MODELS` builder; a weapon = a `WEAPONS` row (+ turret model); a map = a builder + a `MAPS` row; a mode = its folder (rules, tests, adapter) + a `MODES` row + its HUD and results panels. How-tos: `.claude/work/arch/ARCHITECTURE.md`.
- Solid props declare collision shapes with `solid()` (`content/arenas/kit/props.ts`); `arena.ts` collects them (world space) into `arena.colliders`, which feed both physics and the minimap.
- Library materials and baked textures live for the session: never dispose them from scene code, only geometries (`disposeGeometries`). Static props are plain groups merged per material (`mergeByMaterial`); anything that moves on its own (wheels, turret, crane claws) stays outside the merged root; high-count clutter goes through `scatter`.
- Conventions: metres, +Y up, +Z forward (glTF's, so imported models face the same way), driver's left is +X, north is -Z. No negative scales on merged parts. Vehicle node names are a contract: `body`, `turret` (yaw) > `gun` (pitch), `wheel_fl/fr/rl/rr`.

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

Authoritative server: Classic matches take 8 machines (people take bots' seats; bots fill the rest), a custom lobby's up to 12 (bots only where its owner put them; an empty seat stays empty). Classic is matchmaking on the one game server process: a session per player, a ticket per mode and arena, groups formed as the oldest waits (8, then 4+, then 2+), a ready check, a room per proposal, backfill into bots' seats; plan and log in `.claude/work/mm/`. Custom lobbies live in that process's memory too (`server/lobbies.ts`): a list, invite codes, a waiting room, matches their owner starts with the lobby's settings, each in a room of its own that shares `MAX_ROOMS` with Classic's; plan and log in `.claude/work/custom/`. The simulation steps at 60 Hz on both sides (`PHYSICS_STEP`); snapshots go out at 30 Hz, the rules' state when it changes, one input comes in per client step. WebSocket: the snapshots as binary frames, everything else JSON, all of it quantized integers (`protocol.ts`). Every match that ends is recorded with each person's fair-play counts, and each room keeps a replay that runs it again (`MATCH_DIR`). Chat goes over Nakama, never through the game server. Nakama is the control plane only; why gameplay stays here: `.claude/work/nakama-mm/PLAN.md`. The local car is predicted and reconciled; the others are drawn two snapshot intervals (67 ms) in the past; hitscan is rewound on the server to what the shooter saw, 200 ms at most. The server's events are played as the drawing reaches them, the player's own at once. Design, measurements and limits: `.claude/work/net/` (NET_PLAN, NET_LOG, NET_RUNBOOK).

## Engineering principles

1. React stays out of the realtime game loop; rendering stays out of simulation; physics stays out of networking presentation.
2. Never use Three.js meshes or React state as authoritative game state.
3. Never trust client-reported combat results — server validates everything.
4. Procedural generation should be deterministic where practical.
5. Lint holds the layers: `.oxlintrc.json` bans each level from importing the ones above it (`.claude/work/arch/MODULE_BOUNDARIES.md`); a break fails `npm run lint`.

## Where this project departs from the shared guides

- tsconfig: TypeScript 6 is strict by default, so the tsconfigs don't set `"strict"`; `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (`ts/tooling-and-migration.md`) are off. Don't change the tsconfigs to match the guide.
- File names: PascalCase components (`screens/GameCanvas.tsx`), camelCase modules (`simulation.ts`, `render/materials/canvasTextures.ts`), not `ts/patterns.md`'s kebab-case default.

<!-- END:agent-rules -->
