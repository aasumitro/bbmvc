# Online play — plan

The design for online Scrapyard, as built: players in different browsers in
one match, a server that decides every outcome. Phase 0 wrote it from the code
and from measurements on this branch; each later phase brought it in line
with what it built (§11 lists where that differs from the prompt). The log of
what was done, the final report and the numbers are in `NET_LOG.md`; the
owner's steps are in `NET_RUNBOOK.md`; `NET_ARCHITECTURE.md` is the section for
`.claude/work/arch/ARCHITECTURE.md`.

**The rule: the server decides; the client asks and shows.**

---

## 1. Facts from the audit

The prompt's §2 map of the codebase holds. What the audit added or corrected,
with the evidence:

| # | Fact | Evidence |
|---|------|----------|
| F1 | Both arenas build headless in Node under a canvas shim, with the material library's GPU bake skipped: Scrapyard 1.2 s (503 boxes, 309 cylinders, 1 hull; 16 spawns, 2×4 bases, 9 zones, 60 nav nodes), City 1.4 s (371 boxes, 241 cylinders; 16 spawns, 2×4 bases, 11 zones, 72 nav nodes). | Throwaway spike bundled with `vite build --ssr` (scratchpad, not committed) |
| F2 | A room is cheap: 8 Normal bots on a real arena step in 0.27–0.34 ms on average (p99 0.7–1.1 ms, max 8 ms once) per 1/60 s step. That is ~2 % of one core per room. | Same spike, 60 s of play per arena and mode, this container (Intel Xeon 2.1 GHz, 4 vCPU) |
| F3 | `vite build` copies `public/` into an SSR build's output. The server config needs `publicDir: false`. | Spike output had `bg/`, `maps/`, `favicon.png` |
| F4 | Vite 8.3.0 / Rolldown 1.2.10: the options are `build.ssr`, `build.rolldownOptions.input`, `ssr.noExternal` (`rollupOptions` is deprecated). | `node_modules/vite/dist/node/index.d.ts` |
| F5 | Rapier 0.20: after moving a kinematic body, `propagateModifiedBodyPositionsToColliders()` leaves ray casts blind to it at **both** the old and the new place; only `world.step()` refreshes the query structure. | Measured: ray at old spot 9.00 → miss, at new spot miss → miss |
| F6 | `city.ts` paints the ground layout (`createGround` → `paintStreets(tint, wet, rng, …)`) with the **same** seeded stream it lays the city out with. The canvas shim must accept every call, or the stream shifts. This confirms "never skip builder work". | `arena/city.ts:640`, `:770` |
| F7 | Node's built-in WebSocket (undici) sends a custom `Origin` header when given `{ headers: { Origin } }`. The smoke test can pass an Origin check. | Measured against a raw TCP listener |
| F8 | This container runs Node 22.22.2; CI runs 24. Both strip types by default (22.18+) and have a global `WebSocket` (22.4+). Nothing here needs more than 22. | `node --version`; CI `ci.yml` |
| F9 | `ModeRules` does not expose `events`, but both rules objects have an `events` array that `report()` drains. | `mode.ts`, `ffa/rules.ts`, `tdm/rules.ts` |
| F10 | The HUD and the results call rules **methods**, not only data: `standings()`, `place()`, `soleLeader()`, `nemesisOf()`, `overtimeLeft()`, `remaining()` (FFA); `standings()`, `deficit()`, `overtimeElapsed()`, `remaining()` (TDM). A mirror must answer them from mirrored data. | `hud/Hud.tsx`, `screens/Results.tsx` |
| F11 | FFA `standings()` re-sorts `order` only behind a private `dirty` flag, and `nemesisOf()` reads the scoring's private feud matrix. A mirror that copies data alone gets a stale order and never a nemesis. | `ffa/rules.ts`, `scoring.ts` |
| F12 | `BOT_NAMES` has seven names, indexed `(id − 1) % 7` for seats 1–7. A room also needs a name for seat 0, which holds a bot until a human takes it. | `match.ts` |
| F13 | `armBot()` returns a scaled **copy** of a `WEAPONS` spec, with no id. The wire names a weapon by the registry id whose `model` matches. | `ai.ts` |
| F14 | `rocket(from, to)` fires per rocket per step, without an id. Consecutive steps chain exactly: the next `from` is the same floats as the previous `to` (`rocket.position.copy(ahead)`). A recorder can join a rocket's segments without changing `SimEvents`. | `simulation.ts` `flyRockets` |
| F15 | `createTdmMode(combatants, arena)` takes no seed: TDM's rules draw no random numbers. `MODES.tdm.create` ignores the seed. | `modes.ts` |
| F16 | The deploy bind-mounts `../site` (the directory), so the site's `current` symlink switches live. A server release mounted as `server/current` is resolved when its container is created, so a new server bundle needs the `game` container recreated. That is what `--server` does. | `deploy/compose.yml`, `scripts/deploy.sh` |
| F17 | The effects draw a rocket trail as puffs every 0.5 m along the segment (`effects.rocket`), so a trail sent as one segment per snapshot looks the same as one per step. | `effects.ts` |
| F18 | Nakama's local config sets no `session.encryption_key`, so local tokens are signed with Nakama's default, `defaultencryptionkey`. The deploy passes `NAKAMA_ENCRYPTION_KEY` to Nakama already. | `nakama/data/config.yml`, `deploy/compose.yml` |

Nothing in the audit breaks D1–D8. (F2's figures are the spike's; the
committed server's are in `NET_LOG.md`: 0.22–0.25 ms average a step.)

---

## 2. Architecture

```
browser (game/src)                                   game server (game/server, Node)
 React UI ── runtime ── online match                   http :7360  GET /health
               │  view, pilot, feed, HUD (as practice)  ws  /match (upgrade only)
               │  net/client  ── mirror of the rules     │
               │  net/prediction (local car)            lobby ── rooms by (mode, map)
               │  net/snapshots (other machines)         │
               └─ net/connection ─── WebSocket JSON ─────┘ room = world + seats + mode + simulation
                     hello (Nakama token)                     the same simulation.ts, modes, bots
Nakama: accounts, guests, sessions, online count (unchanged). The game server verifies the
session token's HS256 signature itself; it never calls Nakama.
```

### D1 — the authority is a Node game server running the existing simulation

The server runs the same `simulation.ts`, the same mode adapters and the same
bots as a practice match. F1 and F2 confirm this is feasible and cheap.

Rejected alternatives:

- **(a) A Go port inside Nakama.** Nakama's JavaScript runtime (goja) has no WebAssembly, so Rapier can't run there. A Go port would be a second copy of the physics, both modes' rules and the bots. The copies would drift, and prediction would never agree with the server.
- **(b) Nakama as the transport, with the game server as a privileged match participant.** It keeps one socket, but adds a relay hop, a host identity to protect, and client-side filtering of who may send snapshots. It adds more parts than it removes.
- **(c) One player's browser as the host.** That gives no anti-cheat at all.

### D2 — WebSocket, JSON

The server uses `ws` (the only new runtime dependency) and the browser uses its
own `WebSocket`. Messages are JSON, with numbers quantized to integers (§4). The
checks measure bytes per client; a binary format comes only if the §5 budget
breaks.

### D3 — identity is the Nakama session token

The hello carries `scrapyard.session`'s token, freshened the way the menu's
sign-in freshens it.

- The server checks the JWT: `alg` must be HS256, the signature must match (constant-time compare, `node:crypto`), and `exp` must be in the future.
- The key is `NAKAMA_ENCRYPTION_KEY`, default `defaultencryptionkey` (F18).
- Names: an account plays as the token's `usn`. A guest (the hello says `guest`, cosmetic only) plays as `Guest` plus the last four characters of its uid.
- There is one seat per uid per process. A second connection replaces the first, which gets `replaced`.

### D4 — layout and build

```
game/server/         server-only: main, server, auth, lobby, room, arenas, headless, checks
game/src/net/        shared by browser and server: protocol (+ check); browser: connection, client,
                     prediction, snapshots, session (exists)
game/src/game/       roster.ts (the shared line-up), online.ts (the browser's online match),
                     arena/digest.ts
game/vite.server.config.ts   one SSR build: main.js + bundled checks → game/dist-server/
game/tsconfig.server.json    server/ in `tsc -b` (Node + DOM libs: the arena code names DOM types)
```

npm scripts: `server:build`, `server:check` (build, then the bundled checks),
`server` (build, then run on :7360). `check` gains `protocol.check` (plain node)
and `server:check`.

### D5 — the real arenas, headless

1. `materials/library.ts` skips the GPU bake when there is no `window`. It returns the same materials without texture maps. The browser path is unchanged.
2. `server/headless.ts` installs `document.createElement('canvas')`. It returns a fake canvas whose 2D context accepts every call: methods return a chainable dummy, `measureText` returns `{ width: 0 }`, and `getImageData` / `createImageData` return zeros of the requested size.
3. The builders run unchanged (F6).
4. `server/arenas.ts` keeps the gameplay fields, disposes the geometries, empties `root`, and caches per map.
5. `arenaDigest(arena)` (`arena/digest.ts`, pure) is an FNV-1a hash over colliders, spawns, bases, zones and nav, with numbers rounded to millimetres. The arena check prints it, the F3 overlay shows it (`ARENA`), the server sends it in `welcome`, and the client refuses a mismatch with "Arena mismatch — reload the page".

### D6 — rates

| What | Rate |
|---|---|
| Simulation | 60 Hz (`PHYSICS_STEP`), one drift-free loop for every room: accumulate `performance.now()`, catch up at most 5 steps, then drop the backlog and log it |
| Snapshot | 30 Hz: every second step |
| State (`st`) | When the shared rules state changed, checked every 12 steps (5 Hz), and on the snapshot after any rules event; always once right after `welcome` |
| Input | One per local fixed step (60 Hz), numbered `seq` |
| Ping | Every 2 s |

The server's input queue per player:

- It consumes one input per step.
- If the queue is empty, it repeats the last input. If the queue grows past 6, it drops the oldest.
- It drains standing delay: every 30 steps, if the queue never had fewer than *m* ≥ 2 inputs waiting in that window, it lets go of the oldest *m* − 1 (counted as drops). Inputs that waited a whole half second weren't absorbing jitter. Without this, a stall's burst leaves the queue 4–5 deep for good (review E, `NET_LOG.md`).
- The depth after every step is kept as a histogram; `left` logs its p50, p95 and max.
- No input for 250 ms: the controls go neutral (no throttle, no fire).
- `ack` is the last `seq` consumed. A repeat doesn't move it.

### D7 — rooms and seats

- Joining is by (mode, map): the first room with a free bot seat that isn't in its results window. Otherwise the server makes a new one, up to `MAX_ROOMS`.
- Seats come from `MODES[mode].lineUp(arena)`, through the shared roster (§8).
- A human takes a bot seat. In TDM it's the team with fewer humans, lowest seat first; in FFA the lowest bot seat.
- Takeover: the name changes and the human's loadout weapon goes on (validated), but the bot keeps the wheel, with a bot's copy of that gun, until the page's first input. The page still builds its match and compiles shaders for seconds after the welcome, and a machine nobody drives would sit under fire. At the first input the brain goes and the gun is fitted at full rating. The machine stays where it is. The seat keeps its stats (a known limit). `IDLE` counts from the join, so a page that never sends anything is let go after a minute.
- Leave: the seat gets a Normal brain back, its name back, and its gun scaled the way bots' guns are.
- The end: when `mode.outcome()` is defined, the bots and humans stand down. After 15 s of results the room restarts with a fresh seed (`sim.restart` + `mode.restart`, as Play again does) and broadcasts `go`.
- A room with no humans for 30 s is disposed (`world.free()`, `mode.dispose()`).

### D8 — prediction scope

- The local car's driving is predicted and reconciled (Phase 4).
- Other machines are interpolated two snapshot intervals (4 steps, 67 ms) behind (Phase 5; the prompt said about 100 ms, §9 says why it's shorter).
- Shots are not predicted. Tracers, hits and damage come from server events.
- The server rewinds a human's hitscan round to the tick that human saw (at most 12 steps, 200 ms). Rockets are never rewound.

---

## 3. The seam in the mode contract

Two additions, both generic. Nothing branches on the mode.

1. **`ModeRules.events: unknown[]`**: the array both rules already have (F9).
   - Server: after each step, it copies `rules.events` into the outgoing event list, then `mode.report()` drains them, as headless practice does.
   - Client: incoming rules events are pushed into the local `rules.events`, then `mode.report(feed)` runs. The adapter's own `announce` personalises them through `feed.me` / `feed.name` (the nemesis callout, "you").
2. **`MatchMode.share(): unknown`** and **`MatchMode.mirror(state: unknown): void`**: each adapter names the plain data its rules show the player.
   - `share` runs on the server; `mirror` runs in the browser and writes data fields only (`Object.assign`, in place), never methods.
   - The adapter is the one place that knows which fields the HUD reads, so a new mode brings its own pair.

`now` is not in `share`: it travels in every snapshot. The client sets it with
`Object.assign(rules, { now })`, the idiom `simulation.check.ts` already uses.

### What each mode mirrors

**Free for all** (`ffa/mode.ts`):

| Field | Why the client needs it |
|---|---|
| `phase`, `overtimeAt`, `winner`, `draw` | clock, banner, `outcome()`, results |
| `order` = `rules.standings()`, sorted on the server before sharing | the HUD board, results placings. The sort is a pure function of the stats with an index tie-break, so sorting more often changes nothing in the simulation. The bit-exact check proves it. |
| `items` (`id, type, rarity, x, z, expires, hot`) | pickups view, minimap |
| `zone` (by name; the mirror resolves it to the arena's own zone object, so the pickups view keeps its reference) | ring, HUD line |
| `contenders[i].{life, respawnAt, protectedUntil, effects}` | shield chip, effect chips, markers, `respawnIn()`, `speedFactor()` for prediction |
| `feuds`: the scoring's `[k][v]` unanswered-kills table | `nemesisOf()` (F11) |

**Team deathmatch** (`tdm/mode.ts`): `phase`, `overtimeAt`, `winner`, `draw`,
`mvp`, `score`, and `contenders[i].{life, respawnAt, protectedUntil}`. Its
`standings()`, `deficit()` and `overtimeElapsed()` are pure over mirrored data.

**Stats** go per seat, for both modes: every `Stats` field, as an array in
`STAT_KEYS` order, rounded to 0.01.

Small rules changes this needs. None changes a gameplay number; the checks prove it.

- `scoring.ts`: the feud table becomes a field of the scoring (`feuds`), and `reset()` zero-fills it in place instead of replacing it.
- `ffa/rules.ts`: the rules object holds `feuds`, the scoring's own table.

---

## 4. Protocol (`src/net/protocol.ts`, `PROTOCOL = 2`)

> This section is the plan as the online phase wrote it, at `PROTOCOL` 2.
> The wire as it stands is `src/net/protocol.ts` and `src/net/events.ts`
> (`PROTOCOL` 9), whose tests pin it to the byte. Since this plan: the
> snapshot went binary and the welcome grew a match's settings, chat
> channels and a lobby (`.claude/work/nakama-mm/`, `.claude/work/custom/`);
> the content phase (`.claude/work/content/LOG.md`, steps 7 and 8) added
> `lk` to the input (the seat a missile locks on), the lock's target and
> time to the player's own row, the events `ml` and `mg` (a mine laid,
> a mine gone) and the welcome's `mines`.

Every message is a JSON object with `t` (its type).

**Versions.** A page and a server play together only if they were built
from the same sources. `v` must equal `PROTOCOL` (2), which is bumped by hand
whenever a message changes shape. `build` must equal the server's build id:
`game/build-id.ts` hashes (sha256, first 12 hex digits) every file under
`src/` and `server/` (the self-checks aside) plus `package-lock.json`, by
relative path and contents. Vite puts it into both bundles as `__BUILD__`.
Pages from Vite's dev server say `dev`: a server lets them in unless it's
strict (`TRUST_PROXY`, production). Either mismatch gets `err version` ("Game
updated — reload the page") before the token is even checked. So a tab left
open across a deploy stops at the door, even when no message changed shape
(a handling tweak, a gun's numbers, a mode's `share()`) or a `PROTOCOL` bump
was forgotten. A www-only change leaves the id, and the game server's
bundle, alone.

Numbers on the wire are integers:

| Quantity | Unit on the wire |
|---|---|
| positions | cm |
| rotations (quaternions) | ×10⁴ |
| velocities | cm/s |
| angular velocity | mrad/s |
| directions | ×10⁴ |
| normals | ×100 |
| health | ×10 |
| throttle, steer | ×100 |
| timers | ms |
| `now` | ms |

### Client → server

| `t` | Fields | Limits |
|---|---|---|
| `hello` | `v`, `build`, `token`, `guest?`, `mode`, `map`, `loadout {vehicle, weapon}` | ≤ 4 KB; once; within 5 s of connecting. Unknown vehicle or weapon ids get the defaults. `mode`/`map` are checked by the lobby against `MODES`/`MAPS`. A missing or odd `build` (over 64 characters) is kept as `''`, so that page is told `version`, not struck. |
| `in` | `s` seq, `th`, `st` (×100), `hb`, `f`, `r` (0/1), `a` [x, y, z] cm, `w` the server tick displayed | ≤ 1 KB. Numbers finite; `th`/`st` clamped to [−100, 100]; booleans coerced; every other field ignored. |
| `ping` | `c` client time | |
| `bye` | — | |

### Server → client

| `t` | Fields |
|---|---|
| `welcome` | `v`, `room`, `seat`, `mode`, `map`, `seed`, `tick`, `rate {step: 60, snap: 30}`, `digest`, `lineUp [{name, team, vehicle, weapon, human}]` |
| `s` | `k` tick, `ack`, `now`, `cars [[id, x, y, z, qx, qy, qz, qw, vx, vy, vz, hp, flags, ax, ay, az, th, st], …]`, `me [wx, wy, wz, steer ×10⁴, upended ms, ammo, reload ms, cooldown ms, stuck ms, recovery ms]`, `ev [...]` |
| `st` | `k`, `rules` (`mode.share()`), `stats [[…12]…]`, `next` (the tick the room restarts at; −1 while a match runs) |
| `ro` | `seat`, `name`, `human`, `weapon` (a seat changed hands) |
| `pong` | `c`, `k` |
| `err` | `code` (`version`, `auth`, `full`, `bad-request`, `replaced`, `idle`, `closing`; `arena` is the client's own), `text` |

`flags` is a bitfield: 1 alive, 2 handbrake, 4 fire. `speed` is not sent; the
client works it out from the rotation and the velocity, as `forwardSpeed()` does.

### Events (`ev`)

Each event is an array `[code, tick, …]`, in step order.

| Code | SimEvent | Fields after the tick |
|---|---|---|
| `sh` | `fired` + `shot` (hitscan) | id, muzzle (3), point (3), normal (3), struck 0/1, victim (−1 none) |
| `ln` | `fired` (a rocket) | id, muzzle (3), heading (3) |
| `rk` | `rocket` | from (3), to (3): one rocket's segments since the last snapshot, joined (F14) |
| `bu` | `burst` | at (3) |
| `hu` | `hurt` | victim, attacker |
| `wr` | `wrecked` | victim, attacker |
| `cr` | `crashed` | id, x, z (×100), force (×100) |
| `rl` | `reloading` | id, started 0/1 |
| `sp` | `respawned` | id |
| `rc` | `recovered` | id |
| `ru` | a raw rules event | the event object |
| `go` | the room restarted | seed |

The server serialises the shared part of a snapshot (`k`, `now`, `cars`, `ev`)
once per tick and wraps it with each client's `ack` and `me`. Per-message
compression stays off.

Budget, measured by the server check with 8 machines fighting (§5 of the prompt):

| | Budget | Scrapyard | The City |
|---|---|---|---|
| Down per client, average | ≤ 48 KB/s | 24.6 KB/s (worst second 32.3) | 26.7 KB/s |
| Snapshot, average / largest | ≤ 1.5 KB | 757 / 1021 B | 775 / 1125 B |
| Up per client | ≤ 6 KB/s | 4.9 KB/s | 5.0 KB/s |

JSON stays: the budget holds with room to spare.

### What the snapshot carries, and who reads it

| Reader | Reads | Source online |
|---|---|---|
| `view.ts` | `position`, `rotation`, `last` (interpolation), `velocity` (slip, dust), `speed` (engine, dust), `alive`, `health`/`maxHealth` (smoke), `control.throttle` (engine), `control.handbrake` (dust), `control.fire` and `weapon.reload`/`spec.rocket` (the player's gun spin), `control.aim` (turrets), `car.controller` (wheels), `car.handling`/`chassis`, `team`/`name`/`id`/`seed`/`vehicle` | `cars` rows; `me`; `welcome`; `ro` |
| `Hud.tsx` | per machine `alive`, `health`, `maxHealth`, `position`, `team`, `name`, `id`, `stats`; the player's `speed`, `stuck`, `recovery`, `weapon {spec, ammo, reload}`; the rules (§3) | `cars`, `me`, `st` |
| `Results.tsx` | `stats`, `name`, `team`, `id`; the rules | `st`, `welcome`, `ro` |
| `feed.ts` | names and teams; `rules.now` | `welcome`, `ro`, `s.now` |
| `pilot.ts` | the player's weapon range and body; rivals' `position`, `alive`, `team`; the world | local world, `cars` |

---

## 5. The browser: one Match, two sources

The HUD, `Results.tsx` and `GameCanvas.tsx` keep reading one `Match` shape.
`match.ts` is split into two parts:

- **The player's view**, shared by practice and online: the view, pilot and feed; the phase (`playing`/`paused`/`destroyed`/`victory`/`defeat`, plus `lost` for a dropped connection); the frame skeleton (`pilot.read` → advance → `view.place` → chase → `layAim` → `look` → `animate` → `mode.show`); `respawnIn`; `debug`; `dispose`.
- **Where the steps come from:**
  - Practice: the world, the roster, `createSimulation`, and `sim.step` + `mode.report(feed)` per fixed step. This is today's code, in the same order.
  - Online (`online.ts`): the world, combatants enlisted from `welcome` (remote bodies kinematic), a local adapter from `MODES` (never ticked; its rules mirrored), and the net client core (`src/net/client.ts`), which applies snapshots, state and events and sends one input per local step.

Online, the `Match` also has:

- `online: true`;
- `nextIn()`: seconds to the next match;
- `lost`: why the connection dropped.

`restart()` and a real pause exist only in practice. Online, Esc opens the menu
while the match runs on, and the pilot sends neutral controls.

### Placing the machines: no per-machine alpha needed

`view.place(alpha)` lerps `last → position` for every machine.

- Remote machines: each frame the client writes the displayed pose into both `last` and `position` (and `rotation`, `velocity`). The lerp returns it whatever the alpha.
- The local car: `last`/`position` come from its local fixed steps, so `alpha = accumulator / step` is right for it.

So `view.ts` doesn't change. `c.position` for a remote machine is where it is
drawn, which is also what the HUD markers, the minimap, the lock-on and the
whiz sounds should use.

### One client world

F5: ray casts only see a body after a `world.step()`. So one local world, stepped
once per local fixed step:

- Before the step, each remote body (kinematic) is moved to its displayed pose with `setNextKinematicTranslation`/`Rotation`, which also gives it a velocity for contacts.
- The local car is dynamic and predicted (§9). While it's a wreck it turns kinematic and is drawn like the others, from the newest snapshot.

`pilot.layAim()` and `look()` then cast against what is drawn. Lag compensation
needs exactly that: the aim point must be where the target was displayed.

### Remote wheels

The remote cars' vehicle controllers are updated on their kinematic bodies each
local step, with the drawn steer (`updateVehicle` works on a kinematic chassis:
suspension and spin, no push). `poseWheels` then reads them as in practice, with
no view change.

### Hidden tab

Messages keep arriving while animation frames don't run; the link queues them
with their arrival times. When the tab comes back (more than 1 s since the last
frame took messages), the client takes them all in order and:

- keeps every snapshot (the buffer's clock jumps straight to the newest) and every state;
- plays every rules event and `go` (the feed keeps its last five lines);
- drops the effects (`sh`, `ln`, `rk`, `bu`, `hu`, `cr`, `rl`, `rc`) and anything still waiting to be drawn;
- shows each machine whole or wrecked as the newest snapshot has it;
- corrects the predicted car to the server's pose as those snapshots are read (nothing to replay: no local steps ran while hidden), eased on screen like any correction.

---

## 6. Server

| Module | Job |
|---|---|
| `server/main.ts` | Reads the environment (`PORT` 7360, `NAKAMA_ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, `MAX_ROOMS`, `TRUST_PROXY`, `NET_LAG_MS`) and starts the server |
| `server/server.ts` | `node:http` (`GET /health`: rooms, humans, uptime, protocol), `ws` in `noServer` mode upgrading `/match` only, connection limits (§7), the fixed-step loop, structured JSON logs (never a token) |
| `server/auth.ts` | `verifyToken(token, key, now)`; `mintToken()` for the checks only |
| `server/lobby.ts` | Rooms by (mode, map), join rules, `MAX_ROOMS`, one seat per uid, disposal of empty rooms |
| `server/room.ts` | One match: world, seats (shared roster), mode, simulation with recording `SimEvents`, input queues, snapshot and state building, join/leave/takeover, results → restart, dispose |
| `server/recorder.ts` | The simulation's `SimEvents` and the rules' events as wire events (§4); a rocket's segments joined per snapshot |
| `server/rewind.ts` | Lag compensation (§9) |
| `server/arenas.ts`, `server/headless.ts` | D5 |
| `server/browser.ts` | A headless page (the browser's `net/` modules against a real server) for the checks |
| `server/load.ts` | The capacity tool: rooms of bots and headless players, CPU, memory, bytes |

`NET_LAG_MS` and `NET_JITTER_MS` (development) hold every message back that
many ms each way, give or take the jitter. The `stall` option (checks only) also stops
both ways for a while every so often, then delivers what it held, like a Wi-Fi
hiccup. Each direction is one FIFO link
with one timer: a message is handed over no sooner than the one before it, as
TCP would. (Per-message timers of different lengths fire out of order in Node;
the first version did that, and the reordering showed up as corrections.)

---

## 7. Anti-cheat

The authority is the anti-cheat.

- A client sends controls, an aim point, the tick it sees, and a seq. Every other field is ignored.
- Fire rate, ammo, reload, hits, damage, wrecks, kills, respawns, protection, pickups, scores and recovery cooldowns are all the simulation's, on the server.

| Rule | Where | Checked by |
|---|---|---|
| Finite numbers; throttle/steer clamped; booleans coerced; unknown fields ignored; unknown loadout ids → defaults | `parseClient` | `protocol.check.ts` |
| Aim clamped to the weapon's range + 5 m from the machine, and no lower than 1 m below ground | `clampAim` (pure, `protocol.ts`), applied by the room | `protocol.check.ts`, `server.check.ts` |
| `w` clamped to [now − 12 steps, now] | `clampView` (pure), room | both |
| `seq` strictly increasing; older and duplicates dropped | `acceptSeq` (pure), room | both |
| Only `/match` upgrades; Origin must be in `ALLOWED_ORIGINS` (default: `http(s)://localhost:*` and `127.0.0.1:*`); a missing Origin is refused | `server.ts` | `server.check.ts` |
| Per-IP cap on sockets (8). `X-Forwarded-For` (its last entry, the one Caddy wrote) is trusted only with `TRUST_PROXY=1`, which the deploy sets because the game port is published nowhere but to Caddy. | `server.ts` | `server.check.ts` |
| Hello within 5 s, once; protocol version and build id (§4); token verified | `server.ts` | `server.check.ts` |
| `maxPayload` 4 KB (hello); `in` over 1 KB is a strike | `ws`, `server.ts` | `server.check.ts` |
| Token bucket: 120 msg/s, burst 240; over it, the message is dropped and counts as a strike | `server.ts` | `server.check.ts` |
| 10 strikes (a bad, unknown or rate-limited message) close the socket, logging the uid, never the token | `server.ts` | `server.check.ts` |
| 250 ms without input: neutral. 60 s: the player is removed (`idle`) and a bot takes the seat | room | `server.check.ts` |
| More than 512 KB waiting to go out to one socket (a page that stopped reading): logged `slow` and terminated; a bot takes the seat | `server.ts` | `server.check.ts` |

Known limits, not solved in this phase:

- **Aim help** (aimbots, triggerbots). The game has a legitimate lock-on, and the server can't tell perfect aim from a script.
- **Wallhacks.** Every client receives every position; interest management comes later.
- **Token revocation.** A logout isn't seen for the rest of the token's 2-hour life.
- **The refresh key must differ from the session key.** Nakama's refresh tokens carry the same claims as its session tokens, HS256, only the key differs (read in Nakama 3.30.0's `server/api_authenticate.go`, `generateTokenWithExpiry`). With the two keys equal, a 30-day refresh token would pass for a session. `deploy.sh` refuses to roll with equal keys, or with Nakama's default session key; the game server won't start with the default key when `TRUST_PROXY` is set.
- **Floods** beyond the per-IP limits are infrastructure's job.
- **Seat stats.** A human who takes a bot's seat mid-match inherits its stats (D7).

---

## 8. The shared roster (`src/game/roster.ts`)

The practice roster moves out of `match.ts` into a function both sides call:

```
recruits(kind, arena, seed, skill, player?) → Recruit[]
```

- The seats come from `MODES[kind].lineUp(arena)`.
- The arsenal stream is `createRng(seed ^ 0x2545f491)`, drawn in seat order.
- Seat 0 is `player` when given (practice: `'You'`, the garage loadout, seed 1, no draw). Otherwise it's a bot.
- Bots are `BOT_VEHICLE`, seed `id + 1`, `armBot(skill, arsenal)`, named `BOT_NAMES[(id + n − 1) % n]`.
- `BOT_NAMES` gains an eighth name at the end. Seats 1–7 keep today's names; seat 0 gets the new one in a room.

Practice passes its player, so seats 1–7 draw exactly as today. A room passes
none, so seat 0 draws first, deterministically from the room seed.

---

## 9. Prediction, interpolation, lag compensation

### Prediction (`src/net/prediction.ts`, node-checkable)

Each local step (`client.ts` `step`, `prediction.ts`):

1. Send the controls with `seq` and `w` (the drawn tick, rounded).
2. Drive the local car with the controls rounded to the wire's hundredths, as the server reads them: `driveCar(car, held ? WRECKED : input, dt, mode.speedFactor(me))`, then `rightIfUpended`.
3. `world.step()`, read the pose back, and store it in a 256-step ring at `seq`.

When a snapshot arrives:

- Compare the server's pose for the local car with the ring at `ack`. Until the first `ack` the machine isn't the player's yet (the bot drives it while the page loads), so the server's word is taken whole, eased nowhere, and the inputs sent so far are replayed on top.
- Tolerance: 0.25 m, 3°, 1 m/s (the starting values held; the netplay check measured no reason to move them). Over it: set the body's translation, rotation, linear and angular velocity (`me` carries the spin), `car.steer` and `car.upended`, then drive the inputs after `ack` again, one world step each.
- On screen the car stays where it was drawn and eases over: a decaying offset on the pose the view reads (a third left after 35 ms, gone in about 100 ms), never on the body.
- It takes the server's word whole, with no easing, on the first snapshot, `sp`, `rc` and `go`.

While the local car is wrecked it turns kinematic and is drawn from the newest
snapshot: the wreck's tumble is the server's random impulse. It turns dynamic
again, and takes the server's word, when it comes back whole.

The client sends raw controls through the pre-match hold. The server enforces
the hold, so a player starts at GO like a bot, not one round trip later. The
prediction holds the car on the steps the server will hold it: the step on
which the server uses input `seq` is worked out from the snapshot's clock, the
`ack` and the steps queued; GO's step is added up the way the rules add up their
clock. After the results (`next` ≥ 0) it's held too.

### Interpolation (`src/net/snapshots.ts`)

- A second of snapshots (30). Remote machines are drawn at the estimated server tick minus `DELAY` = 4 ticks, two snapshot intervals (67 ms): positions, velocities, aims, speed, steer and throttle lerped, rotations slerped, flags from the later snapshot.
- Between two snapshots more than 10 m apart (a respawn, a recovery) there is no lerp: the earlier until the later's tick.
- On a gap, carry on at the last velocity for at most 15 ticks (250 ms), then hold. `drawing.extrapolated` counts it (0.0–0.1 % of draws in the netplay check).
- The server-tick estimate: tick − arrival × 60/s per snapshot; the largest of the last second (the least-delayed arrival) is the target, eased onto at 10 % a snapshot, taken at once after a gap over a second. The drawn tick never goes backward.
- Events wait until the drawn tick reaches theirs, so a tracer leaves the gun where the shooter is drawn. The player's own (rounds they fire, hits they take or land, their launches, crashes, reloads, respawn, recovery), the rules' events and `go` play on arrival. The player's own rounds leave the gun where the predicted car is drawn.

Why 67 ms and not the prompt's 100: every tick of interpolation delay is a tick
of the 200 ms rewind budget spent before latency. With three intervals (DELAY
6), the rewind a 150 ms round trip needs is ~270 ms; capped at 200 ms, the round
lands ~1.8 m behind the car's centre against a hull half-length of 2.2 m, a coin
flip. With two it's ~0.8 m, a clean hit, and extrapolation stays at 0.0–0.1 % of
draws at ±10 ms jitter.

### Lag compensation (server)

- The room records every machine's pose after each step, 60 ticks deep (`server/rewind.ts`).
- `createSimulation` takes an optional `castRound` hook (absent in practice, so practice and the bit-exact checks don't change). The room's hook casts a human's round when compensation is on and the human's `w` is older than the previous tick:
  - scatter as `castRound` does (the same draws from the same stream, so the match's randomness doesn't shift);
  - a ray against the static world (`EXCLUDE_DYNAMIC`);
  - a ray against every other machine's chassis shells (`VEHICLES[..].chassis.shells`) at tick `w` (ray–oriented box, plain maths);
  - the nearest hit wins; a machine struck is named by its first collider, so damage goes through the simulation's own path.
  - a machine's life is recorded with its pose (its deaths so far, or a wreck). A machine that was a wreck at `w`, or has died since, still stops the round, but the round names only something static: that life is over, and the machine lives on elsewhere.
- `w` is clamped to 12 ticks back (`clampView`); a pose the ring no longer holds falls back to the present-time cast.
- Friendlies still stop rounds, as they do today. Bots, and rockets, stay in the present.
- The check: at 150 ms round trip the drawn target is 141 ms behind the server and the compensated round hits (without compensation it misses); at 300 ms it's 216 ms behind, past the cap, and misses both ways; a forged `w` 830 ms old is clamped and hits nothing.

---

## 10. Risks

| Risk | How it's handled |
|---|---|
| A browser's float maths differs from Node's and moves a wall | The digest check at `welcome` refuses the match with a message, and the runbook has the owner compare digests. The builders' randomness is integer mulberry32, so only float-driven branches could differ. [medium confidence all current browsers agree: V8 and SpiderMonkey use fdlibm ports; this needs verification in Safari] |
| The JSON budget is tight (8 cars × ~18 numbers at 30 Hz is ~30 KB/s before events and state) | Measured: about half the budget (§4); state is sent on change only; binary only if the budget breaks |
| Rapier's vehicle controller keeps per-wheel state the snapshot doesn't carry | Reconciliation tolerances absorb it; the netplay check drives 20 s at each latency: no corrections unless the server had to repeat an input |
| One process runs every room, so a slow room delays the rest | Catch-up cap; p99 step time measured per arena; `MAX_ROOMS` |
| The e2-medium's vCPUs are shared | The capacity estimate (`load.ts`: 12 rooms × 8 players at ~14 % of one core) is taken on this container; the real VM needs verification |
| A tab hidden mid-match: the car keeps being a target | 250 ms stale-input rule makes it neutral; 60 s idle frees the seat |

---

## 11. Deviations from the prompt

1. **Remote bodies go to their displayed poses before each local step**, not their latest server poses. F5: queries only refresh on a step, and the aim must hit what is drawn for lag compensation to agree. Prediction collisions with remote cars are rare, and reconciliation absorbs them.
2. **`view.place` gets no per-machine alpha.** Remote machines have `last = position = displayed pose`. The same single-alpha call works unchanged.
3. **`err` gains `idle`** (60 s without input).
4. **A missing Origin is refused.** The dev default allows localhost and 127.0.0.1 on any port; the smoke test sends the site's Origin (F7).
5. **The aim, `w` and seq rules are pure helpers in `protocol.ts`** (checked there), applied by the room, which knows the machine and the tick. `mode`/`map` are checked by the lobby: `protocol.ts` must load under plain node, and `modes.ts`/`maps.ts` need the bundler.
6. **Rounds are rewound against every other machine**, not only hostiles, because friendlies stop rounds today.
7. **FFA exposes the scoring's feud table as data** (§3) so a mirror can answer `nemesisOf`.
8. **An eighth bot name** (§8).
9. **Interpolation is 67 ms, not about 100** (§9): the rewind budget. `w` is the drawn tick rounded, not floored: floor lost up to a tick of it.
10. **The latency simulator holds messages in one FIFO per direction** (§6), with `NET_JITTER_MS` beside `NET_LAG_MS`.
11. **No refill rule on the server's input queue.** Tried (after running dry, wait for 2 or 3 queued inputs) and dropped: once the latency simulator was right it measured no better, it cost latency, and each starvation cost up to three repeated steps.
12. **The online menu is "Match menu"** with Back to the match, Settings and Leave match; practice's failed loading gets Retry too.
13. **The netplay drive is 20 s at each latency**, and the grid hold may take one settle correction: the car settling onto its springs as it joins a room just made, under 0.15 m.
14. **`arenaFor`, a test seam in the lobby and server options**: the netplay check plays on a flat test yard, the rest on the real arenas.
15. **A seat's bot drives until the newcomer's first input** (review C), not until the welcome, the prompt's takeover moment.
16. **The input queue drains standing delay** (review E), beyond the prompt's "repeat when empty, drop the oldest past 6".

---

## 12. Not done

- **Rejoining your old seat after a drop** (the prompt's stretch goal). A dropped player joins again as a newcomer.
- **The vehicle from the garage.** A hello's `loadout.vehicle` is parsed and checked against `VEHICLES` but not used: `room.join` fits the person's gun on the roster's machine (`BOT_VEHICLE`). `VEHICLES` has one entry today, so that is the vehicle they chose. `server.check` fails the day it has two, until `room.join` seats a person in the vehicle they picked, which means the welcome's line-up and the page's `seatOnline` carry it too.
