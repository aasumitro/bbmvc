# Multiplayer (the game server)

The online half of the game's architecture; [ARCHITECTURE.md](../arch/ARCHITECTURE.md)
is the rest, and links here from its "Online play".

Online matches run on an authoritative game server, `game/server/`. It is a
Node process that runs **the same `simulation.ts`, modes and bots as a
practice match**, one implementation for both. Nakama is the control plane,
never the gameplay: accounts, guests, sessions, the online count, the match
chat (why gameplay stays out of Nakama, measured: `.claude/work/nakama-mm/PLAN.md`).
The rule: **the server decides; the client asks and shows.**

```
browser                                              game server (Node, :7360)
 React (menus, HUD reads the Match)                   GET /health · ws /match
 net/matchmaking (Find Match, the ready check) ──┐     lobby: sessions, rooms, who goes where
 runtime ─ playMatch(parts, source)              │       matchmaker: tickets → proposals → rooms
            ├ practice: createMatch → simulation │       room: world + seats + mode
            └ online:   online.ts → net/client   │          + createSimulation (as practice)
                          ├ prediction (own car) │          + recorder (SimEvents → wire)
                          ├ snapshots (the others)          + rewind (lag compensation)
                          └ connection ── WebSocket ────────┘  + fairplay, match records, the replay journal
                  hello (Nakama token, build id) → mm … → welcome → in / s (binary), st, ro
 net/chat ── Nakama's realtime socket ──► Nakama: sign-in, sessions, the online count, the match chat
The game server checks the session token's HS256 signature with Nakama's key
itself; it never calls Nakama, and Nakama never carries a snapshot or an input.
```

## Matchmaking (Classic)

Find Match opens one socket: a hello with no map is a matchmaking session.
The player searches a mode on an arena; the matcher (`server/matchmaker.ts`, every
number in `MATCHMAKING`) offers bots' seats in running matches first
(backfill), then groups tickets of one mode, arena and build, oldest first: eight
at once, four or more after 10 s, two or more after 30 s. Everyone in a
proposal gets a ready check (10 s); two or more accepts start it — bots take
the rest — and accepters of one that didn't start go back with their place
kept. The lobby opens a room and seats them on the sockets they searched on
(the welcome); its first match waits for their pages to load (20 s at
most). A search survives a dropped socket or a reload for 15 s, and moves
with the player to another tab. A hello with a mode and an arena still gets
a seat at once (the tests, the load tool, the deploy's smoke test). Plan,
decisions and log: `.claude/work/mm/`.

## Who owns what

| State | Owner | The other side |
|---|---|---|
| Poses, hulls, wrecks, respawns, recovery | the room's simulation | snapshots (`s`, a binary frame of the same integers the JSON had), 30 Hz |
| Weapons: fire rate, ammo, reload, hits, damage | the room's simulation | events (`ev`) and the player's `me` row |
| Match rules: clock, phase, score, pickups, zones, protection, standings | the room's mode | `st` when it changes: `mode.share()` → `mode.mirror()` |
| Statistics | the room's scoring | `st` |
| Seats: who is a person (and their user id), names, guns, vehicles; the room's chat channels | the room | `welcome`, then `ro` |
| Chat messages | Nakama (`chat.lua`'s rules) | Nakama's realtime socket; never stored |
| Match records, fair-play counts, replays | the room | `MATCH_DIR` on the server's disk |
| Controls, aim, the tick the player sees | the page | `in`, one a step, clamped and rate-limited on arrival |
| The player's car between snapshots | the page (predicted) | put right against `s` |
| The others between snapshots | the page (drawn 67 ms back) | from `s` |

A client never sends an outcome. The browser's mode is a mirror: it's never
ticked, and never asked to damage, kill or respawn.

## One Match, two sources

`match.ts` holds the player's side of any match: the pilot, the view, the
feed, the fixed 60 Hz steps, the phase, results, debug. It asks a *source*
for the steps:

- **Practice** (`createMatch`): the local simulation, stepped and reported as always. Bit-identical to before online play (the tests replay a match from its seed).
- **Online** (`online.ts`): `net/client.ts`. Each frame it takes the server's messages (`receive`), places every machine where it's drawn (`place`), and each step sends one input, predicts the player's car and steps the local world (`step`).

The HUD, `Results.tsx` and `GameCanvas.tsx` read one `Match` shape. Online adds
`online`, `lost` (why the connection dropped) and `nextIn()` (the next match).
The view and the feed are reused unchanged: the client plays the server's
events into the same `SimEvents` and the same `Feed`.

## The mode seam

Each mode adapter (`MatchMode`) has `share()` (server: the plain data its rules
show the player) and `mirror(state)` (browser: writes it back into the local
rules, data only). The rules' own events travel as `ru` events and go through
the adapter's `report()`, so the feed announces them in the player's words.

## The loop, per step

Server, per room, 60 Hz: next input per person (repeat when dry, drop the oldest
past 6, neutral after 250 ms, standing delay drained; a new seat's bot drives
until the person's first input) → `sim.step` → record poses and lives → rules
events → report → outcome, results, next match → every 2nd step a snapshot,
and the rules' state when it changed.

Browser, per local step: send the input with the drawn tick → predict the
player's car → move the others' kinematic bodies to where they're drawn →
`world.step()`. The world matches what's drawn, so the crosshair and sight
lines hit what the player sees.

## Prediction, interpolation, lag compensation

- **The player's car** is driven locally from the same controls (rounded as the server reads them) through the same `drive.ts` on the same Rapier. Each snapshot's `ack` names the input the server last used; beyond 0.25 m, 3° or 1 m/s from what the page had then, the page takes the server's state and replays the later inputs. The correction is eased out on screen in about 100 ms, never on the body. Until the server has used one of its inputs (its bot still drives the seat), the page takes the server's word whole.
- **The others** are drawn two snapshot intervals (67 ms) behind the server's tick as the page reckons it, between the snapshots either side. Events wait until the drawing reaches their tick; the player's own play at once.
- **Hitscan** is rewound on the server to the tick the shooter saw (60 ticks of poses kept, 12 at most, 200 ms), against the chassis boxes, onto the life each machine lives now: a wreck then, or a machine that has died since, stops the round and takes nothing. Rockets fly in the present.

## Adding content, online

- **A vehicle or a weapon**: nothing extra. The wire names them by registry id: each seat's gun and vehicle in the welcome, `ro` and the journal's `join`. A person takes a bot's seat in the vehicle they chose (`changeVehicle` replaces the body where it stands, on the server and on every page) and the bot gets its own back when they leave. A new hitscan gun is rewound automatically, since the rewind reads each machine's `chassis.shells`.
- **A map**: its builder must run headless (Node, no `window`: `server/headless.ts` fakes the canvas, the material bake is skipped) and give the same `arenaDigest` there as in the browser. Its digest goes in `game/server/digests.json`: `server/arenas.test.ts` checks every map in `MAPS` against it, the deploy's smoke test holds the server to it, and `scripts/arena-parity.mjs` holds Chromium to it.
- **A mode**: its adapter's `share()` and `mirror()`, covering everything its HUD and results read from the rules.
- **A new `SimEvents` callback**: a wire event in `server/recorder.ts` and its playback in `net/client.ts`.
- **Any change to a message's shape**: bump `PROTOCOL` in `net/protocol.ts`. An older page is told to reload. Anything else is covered by the build id (`game/build-id.ts`, a hash of `src/`, `server/` and the lockfile in both bundles): a page of another build is told to reload too.

## Anti-cheat

The authority is the anti-cheat. The door (`server/server.ts`) adds:

- Origins and signed sessions, from the same build.
- Message size and rate limits, with strikes.
- A cap on what may wait to go out to a page that stopped reading.
- A per-address socket cap.
- Idle timeouts.

`protocol.ts` adds the input rules: finite numbers, the aim within range, the
view within the rewind, and sequence numbers that only go forward.

What the authority can't stop, aim help, `server/fairplay.ts` counts per
person. Lock-on legitimately puts a fair page's aim on a hostile in sight, so
the counters are only what a fair page can't produce:
- firing with the aim inside a hostile that can't be seen from the car's roof or the chase camera, where the shooter's page drew it;
- snaps of over 40° onto a hostile that is then hit;
- triggers pulled the step the aim arrives.

Past a threshold a person is flagged in the match record and a `fairplay` log
line, for a person to review with the replay. Nothing acts on a flag
automatically.

Known limits:

- aim help (flagged for review, never blocked);
- wallhacks (every page gets every position; the minimap shows every enemy within 78 m by design). Not sending hostiles beyond the minimap and out of sight would leave out about 60 % of the rows in free for all, and 7–15 % in team deathmatch (measured: `.claude/work/nakama-mm/LOG.md`). It's the next step, once the page can hide a machine it stops hearing about.
- token revocation (and Nakama's refresh key must differ from its session key: `deploy.sh` checks);
- floods beyond the per-address cap;
- a person taking over a bot's seat mid-match inherits its stats;
- hits past 200 ms of latency need a lead.

## What a room keeps

With `MATCH_DIR` set, the server keeps:
- **A record per match** that ends: `matches-YYYY-MM.jsonl`, one JSON line with the room, mode, arena, build, seed, times, result, and for every seat its person (uid, name) or bot, team, gun, statistics and fair-play counts.
- **A replay per room:** `replays/YYYY-MM-DD/<room>-<ms>.ndjson.gz`, the room's journal. It holds the seats taken and left after each step, what each person's machine was given on each step (written only when it changes), and each next match's seed.

`node dist-server/replay.js <file> [matches…]` runs the room again from the
journal: the simulation is deterministic, so every machine ends where it did
and every match record comes out the same. `server.test.ts` holds a replay to
that, and so does the tool, given the kept records. Replays are pruned after
`REPLAY_DAYS` (3); the records stay, and `scripts/backup.sh` archives them
each night with Nakama's database. A replay viewer in the game comes later.

## The match chat

The chat runs on Nakama's realtime chat, over the page's own Nakama socket
(`net/chat.ts`), not through the game server.
- **Room and team channels:** the welcome names the room's channel, and the team's in team deathmatch. The names are random (`sy-` and 24 hex digits) and told only to that room's, or that team's, seats: a Nakama room channel lets in whoever knows its name.
- **Whispers:** direct messages to the user id the welcome, or an `ro`, gives for a seat.
- **Rules:** `nakama/data/modules/chat.lua` holds every page to the game's room names, `{"text"}` of 1–200 characters, 8 messages in 10 s, and nothing stored.

## Tests

`npm test` ends with its integration project: the arenas headless, a real
server over real sockets, a room's replay run again to the same end, headless pages
through `net/`, and netplay at 50–150 ms each way. The chat's rules need a
Nakama: `scripts/chat-smoke.mjs`. Design, numbers and the owner's runbook:
`.claude/work/net/`, and `.claude/work/nakama-mm/` for what came after.
