# Classic matchmaking — plan

The brief: `.claude/work/BBMV_Classic_Matchmaking_Implementation_Prompt.md`.
Progress, phase by phase: `MM_LOG.md` (same folder).

## Phase 0 — the map (before any change)

Paths under `game/` unless noted.

| What | Where | Notes |
|---|---|---|
| Server entry | `server/main.ts` | env, physics, every arena built up front, `createGameServer`, SIGTERM/SIGINT close |
| Door, sockets, loop | `server/server.ts` | `/health`, ws `/match` (origin, per-address cap, 5 s hello, size, rate, strikes, backlog), one 60 Hz loop for every room (`lobby.step`) |
| Lobby / room manager | `server/lobby.ts` | rooms by mode, `join(person)` puts a hello into the busiest open room of the mode (the uncommitted-then-committed pooling, 9bc0134), else a new one on the arena asked for, up to `MAX_ROOMS`; one seat per uid (a second join replaces the first); rooms empty for 30 s close |
| Room lifecycle | `server/room.ts` | `createRoom`: world, 8 machines from `roster.ts` (bots in every seat), mode, the practice `simulation.ts`. Countdown (`preMatch`, 3 s) starts at creation; `outcome()` -> results (15 s) -> `restart()` with a fresh seed, forever |
| Bot seat takeover | `room.join` / `takeWheel` / `leave` | a person takes a bot's machine where it stands (the side with fewer people), the bot keeps the wheel until the page's first input; leaving hands it back to a bot |
| Messages, naming | `src/net/protocol.ts` | JSON, `t` = short type (`hello`, `in`, `ping`, `bye` / `welcome`, `s`, `st`, `ro`, `pong`, `err`); `parseClient` checks every client message; `PROTOCOL` bumps on any shape change |
| Socket -> room binding | `server/server.ts connect()` | `greet` verifies build + token, then `lobby.join` at once: the socket's `room`/`human` are set once; its close calls `lobby.leave` |
| Client networking | `src/net/connection.ts` (`openSocket`, `join`: hello -> welcome -> `Link`), `client.ts` (mirror), `prediction.ts`, `snapshots.ts`, `session.ts` (Nakama) | the socket is opened inside a match's loading and closed with the match |
| Arena / Classic UI | `src/screens/MapSelect.tsx` | mode list, arena, practice bots, Practice / Classic buttons; Classic = `onStart({ online: true })` |
| Loading flow | `src/game/runtime.ts startGame` | online steps: Signing in -> Connecting -> Joining a match -> Building the arena (the welcome's) -> Setting up -> Compiling shaders; `screens/GameCanvas.tsx` shows them |
| Client state store | none global | `App.tsx` `useState` (screen, loadout, pick); `settings.ts` is the one module store with listeners — the pattern the matchmaking store follows |
| Auth, build check | `server/auth.ts` (HS256 JWT with Nakama's key, no call to Nakama), `server.ts greet` (`PROTOCOL`, `BUILD` from `build-id.ts`; 'dev' allowed unless strict) | |
| Uncommitted changes | none | the brief's "local uncommitted change" (pool by mode) is commit 9bc0134 |

### The four questions

1. **Nakama matchmaker? No: a custom in-process matchmaker in the game server.**
   The game server never talks to Nakama (NET_PLAN D3); it verifies session
   tokens itself. Nakama's matchmaker would hand its result to clients on
   Nakama's socket and to a Nakama runtime hook; turning that into a room on
   the game server needs a new Nakama -> game server channel (an HTTP
   endpoint and a shared secret) or a second token the game server must
   verify. And what the brief needs is beyond it anyway: the ready check,
   partial-accept start, requeue with the original `createdAt`, and backfill
   into rooms only the game server knows (bot seats, match progress, build).
   Those would be custom either way, split over two services. The matcher is
   a pure module behind a small interface (`search / cancel / respond /
   disconnect / reconnect / tick`, hooks for rooms and messages, a pluggable
   `compatible(a, b)`), so it can be swapped later.
2. **One socket: yes, with a moderate change.** Server: `connect()` binds a
   socket to a room once, at hello. It becomes: hello without a map = a
   matchmaking session; the room binding is set later by the lobby, when the
   player is seated (a new room from a proposal, or a backfill). A socket
   never switches rooms: practice runs in the browser only (no practice rooms
   on the server), so "practice -> online" is "no room -> room" on the
   server. Client: the socket must outlive screens, so it moves into a
   module store (`net/matchmaking.ts`) that owns it from Find Match until the
   seat's `welcome`, then hands it to the runtime as the match's `Link`
   (`connection.ts` split: `link(socket, welcome)`). Chosen: one socket.
3. **One process.** `deploy/compose.yml` runs one `game` service (`node
   /srv/server/main.js`), no replicas, no cluster; `main.ts` makes one
   server. In-memory matchmaking works. A restart (a deploy with a new server
   bundle) drops tickets, proposals and rooms; everyone is told `closing`.
4. **Guest identity.** `session.ts` makes a device ID once per browser
   (`crypto.randomUUID()`, localStorage `scrapyard.device`) and signs in with
   Nakama's `authenticateDevice`. The game server never sees the device ID:
   it trusts only the uid in a Nakama-signed token. Nothing but the ID's
   secrecy stops someone who has another browser's device ID from signing in
   as that guest (Nakama device auth is a bearer secret; 122 random bits, so
   not guessable, but copyable from that browser's storage). A risk to
   report, not something this work changes. The hello's `guest` flag is
   cosmetic (the name).

## Decisions

- **Where it lives.** `server/matchmaker.ts`: the config (`MATCHMAKING`, every
  value from the brief) and the pure matcher, clock injected; checked by
  `server/matchmaker.check.ts` under plain node. `server/lobby.ts` wires it to
  rooms and sockets. `src/net/matchmaking.ts`: the page's store.
- **Protocol.** A hello with a map still seats at once, in a room of that
  mode on that arena (the checks, the load tool and the deploy's smoke test
  need a seat without a queue; the game itself never sends a map). The
  busiest-room pooling goes. A hello without a map opens a matchmaking
  session. Client `mm` messages: `search` (mode), `cancel`, `accept` /
  `decline` (proposal id), `state`. Server `mm` message: the player's whole
  queue state (`idle` with a note, `searching` with time waited, `found` with
  proposal, arena, players, time left, readiness counts, and whether the
  server has the player's accept), sent on every change, on request, and on
  a session that finds a ticket kept for it. "Match starting" is the seat's
  `welcome` on the same socket.
- **Sizes.** By the oldest ticket's wait `w` in a group of compatible tickets:
  `w < 10 s` 8 only; `10 s <= w < 30 s` 4 to 8 (`MIN_HUMANS_TO_START + 2`);
  `w >= 30 s` 2 to 8. Oldest first; a group can yield several proposals.
- **Backfill first.** Each tick, before new proposals, the oldest searching
  tickets are offered bot seats in open rooms of their mode and build with
  progress <= 0.5, the room with the most people first; a single-player
  ready check each; pending offers count against a room's free seats.
- **Ties.** A response counts only before `expiresAt`; at or after it the
  proposal is resolved as expired, wherever that is noticed first (a tick or
  the late response).
- **Loading.** A room made from a proposal holds its first match (no
  simulation steps; inputs still read and acked) until every person seated
  has sent an input, or `LOAD_TIMEOUT_MS`. Then the usual countdown. A seat
  whose page hasn't loaded is driven by its bot until the page's first input
  (the existing takeover). `st` carries the hold's last tick, and the HUD
  says "Waiting for players".
- **Identity.** One live connection per uid. A session replaces an older
  session of the same uid (the ticket carries over); a session is refused
  while the uid holds a seat (`busy`). A direct seat replaces anything.
- **Arena.** The one the player picked: a search carries `map`, tickets group only with the same mode and arena, backfill only into rooms on it (was: rotation per mode over `mapsFor(mode)`, dropped 2026-09-29; see MM_LOG).
