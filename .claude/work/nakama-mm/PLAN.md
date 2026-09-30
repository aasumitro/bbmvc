# Online play with Nakama — plan

What Nakama does for Scrapyard's online play, what the game server keeps,
and what is built now. Decided with the owner on 2026-09-29, after a
feasibility study of running Classic entirely on Nakama (evidence in §5).
Progress, results and numbers: `LOG.md` (same folder).

---

## 1. The decision

**Nakama is the control plane; the game server stays the authority.**

| | Nakama | Game server (`game/server`, Node) | Browser (`game/src`) |
|---|---|---|---|
| Now | Accounts, guests, sessions (the token the game server checks itself), the online count, the site's stats. **In-match chat** (§3.4). | Matchmaking, rooms, and every gameplay outcome: the same simulation, modes, bots and Rapier as practice (60 Hz), input rules, lag compensation. **Binary snapshots, match records, fair-play signals, replays** (§3). | Sign-in, UI, rendering, its own car predicted, the others interpolated. **Chat box.** |
| Stage 2, when there is more than one game server | Matchmaking (our `matchmaker.ts` in a queue match: it runs unchanged in Nakama's JS runtime) and the list of game servers; seat tokens signed RS256 (`nk.jwtGenerate`) that servers verify with the public key. | Registers and reports its capacity; seats players who bring a seat token. | Find Match on Nakama's socket, then straight to the game server it was given. |
| Later, many servers or regions | Nakama 3.41's Go `FleetManager` (Get/List/Create/Join) picks a server, by latency. | As stage 2. | As stage 2. |
| After this phase | Match results into Nakama `storage` / leaderboards (option B: the records come first, as files). | Reports each match to a Nakama RPC (server to server, the runtime HTTP key). | Match history. |

Gameplay never goes through Nakama: no extra hop, and no base64 envelope
(§5, V11). Players always connect straight to the game server.

## 2. Scope

- The root `AGENTS.md` said no backend features in this phase. The owner
  chose **B**: match records and replays stay on the game server (they're for
  fair-play review), and Nakama storage waits for the next phase.
- **Chat in Classic matches** is added to the scope: all players, team
  (team deathmatch), and whispers.
- Nakama goes from 3.30.0 to **3.41.0**.
- Added on 2026-09-30: **guests are kept 3 days**, then deleted (§3.6), and the nightly backup takes the match records too (§3.7).

## 3. What is built now

### 3.1 Nakama 3.41.0

- Both compose files (`nakama/`, `deploy/`).
- 3.31–3.41 add four migrations, which `nakama migrate up` runs at start. Back up first: migrations don't go down.
- Session tokens are signed exactly as in 3.30, so the game server needs no change (V13).

### 3.2 Binary snapshots

- The snapshot (`s`, 30 a second) becomes a binary WebSocket frame: fixed-size integer fields in the same units as today's JSON. The page decodes the same numbers, so prediction and interpolation see no change.
- Events stay JSON, at the end of the frame. Every other message (`welcome`, `st`, `ro`, `pong`, `err`, `mm`) stays JSON.
- `PROTOCOL` 5.
- Target: well under today's 24.6 KB/s down per player. `server.check` measures it.

**Relevance culling (not sending hostiles a player can't see): measured, not built in this round — the next step, for free for all.**

Share of a snapshot's machine rows that are a hostile beyond the minimap's reach (78 m plus 10 m of margin) and out of sight of the roof and a raised eye (bots-only rooms, 2 min each; `LOG.md`):

| | Team deathmatch | Free for all |
|---|---|---|
| The City | 14.6 % | 61.6 % |
| Scrapyard | 7.3 % | 58.8 % |

- In free for all that would cut about 40 % of a snapshot's bytes, and keep most hostiles off a wallhack.
- It isn't in this round because it changes what the page draws and hears. A machine the page stops hearing about has to be hidden, not left frozen:
  - its model, its markers and the minimap's ring;
  - its engine sound: hostiles behind walls would fall silent, a gameplay call;
  - its local physics body, so there are no phantom collisions or ray hits;
  - lock-on.
- It also needs hysteresis against pop-in at corners.
- A change of its own, with its checks and a look in a browser.

### 3.3 Match records, fair-play signals, replays (game server)

**Match records**
- Written when a match ends (`mode.outcome()`): room, mode, arena, build, seed, start and end, the result, and for every seat its person (uid, name) or bot, team, gun, statistics and fair-play counters.
- `MATCH_DIR` set: one JSON line per match in `matches-YYYY-MM.jsonl`. A `match ended` log line either way.

**Fair-play signals** (`server/fairplay.ts`, pure). Lock-on legitimately puts the aim on a visible hostile, so "aim on target" means nothing by itself. The signals are what a fair page can't produce:

| Signal | What it counts |
|---|---|
| Aim on a hidden hostile | Firing with the aim point on a hostile that is out of sight from the shooter, where the shooter's page drew it (the rewound poses). A fair page's aim point lies on the first surface its ray hits, or on a visible hostile. |
| Snap onto target | The aim swings far more than any lock-on window within a step or two and lands on a hostile that is then hit. |
| Instant trigger | Firing starts within a step of the aim reaching a hostile, over and over. |

- Counters go into the match record. A `fairplay` log line flags a seat past the thresholds.
- Nothing is automatic: a person reviews, starting from the replay.

**Replays**
- Each room writes one gzipped NDJSON file while it runs (`MATCH_DIR/replays/<date>/<room>.ndjson.gz`). The room's lifetime is the unit: the room's matches follow one another in one simulation.
- Contents: a header, then the events (seats taken, the wheel handed over, seats left, the first match released, the next match's seed), and each person's inputs as the room applied them, written only when they change.
- `node dist-server/replay.js <file>` runs the room again headless from its first seed with those inputs: the same outcomes bit for bit (the simulation is deterministic). It prints each match's record and fair-play counters.
- A visual replay viewer in the game is a later step.
- `REPLAY_DAYS` (default 3) prunes old replays at start and daily.

### 3.4 Chat in Classic matches (Nakama realtime chat)

| Chat | Nakama | How it's kept private |
|---|---|---|
| All (the room) | Room channel | The name is `sy-` plus 24 random hex digits, made by the game server per room and sent in `welcome`. Room channels have no membership check, so an unguessable name is the check. |
| Team (team deathmatch) | Room channel per team | Each name is sent only to that team's seats. |
| Whisper | Direct message to a user id | `welcome` and `ro` carry each person's uid. Nakama checks that the receiver exists and hasn't blocked the sender. |

Whisper delivery: a direct message reaches only someone who has joined the
channel. The sender's page joins and waits until the receiver is present;
the receiver's page joins when Nakama's "wants to chat" notification comes
from someone in its match. A receiver who never joins gets "not reachable"
after 5 s.

`nakama/data/modules/chat.lua` hooks:
- **ChannelJoin:** rooms only by the game's names; team and room joins non-persistent; groups refused.
- **ChannelMessageSend:** `{text}` of at most 200 characters; 8 messages per 10 s per user.

Hooks refuse by raising an error, which keeps the socket open (a nil return closes it).

**On the page**
- Enter chats to all, T to the team (team deathmatch).
- `/w <name> <text>` whispers, `/r <text>` replies, `/mute <name>` and `/unmute <name>`.
- While typing the car is left alone: typed keys never drive.
- It uses the page's existing Nakama socket (`net/session.ts`) and rejoins after a reconnect.

### 3.5 Docs, copy, deploy

- **Docs:** `AGENTS.md` (root, `game/`, `nakama/`), `NET_ARCHITECTURE.md`, `NET_RUNBOOK.md`, this folder (tracked in git).
- **Copy:** the site's guide (controls, online), and the game's patch notes.
- **Deploy:** a named volume for `MATCH_DIR` in `deploy/compose.yml`, and `scripts/chat-smoke.mjs` in the deploy's smoke test.

### 3.6 Guests kept 3 days (`nakama/data/modules/guests.lua`)

Every browser that presses Play makes a guest, so guests only pile up. `prune_guests` deletes the guests made more than 3 days ago:

- **A guest** is an account whose only way in is a device: no email (registered, or linked since), no other login, and no auth provider's login (3.41 keeps those in `user_device` with `provider` set).
- **Spared:** a guest whose game is open (on `stats.lua`'s online stream) waits for a night it isn't. Deleting it would close its Nakama socket mid-match; the page would come back as a new guest only when its token ran out, up to 2 h later.
- **How:** a read-only walk by id, 200 at a time; each account goes through `nk.account_delete_id` (its devices, friends, groups and sessions with it). 5 s a call at most, inside Nakama's 10 s HTTP write timeout (0.6 ms a guest measured: about 8,000 a night); `more: true` says some wait for the next night.
- **Who calls it:** only the runtime HTTP key; a player's session gets 403. `scripts/backup.sh` calls it nightly after the dump, from inside Caddy's container (which holds the key and reaches Nakama on the compose network).
- **After:** the same browser signs in as a new guest (the game's device ID makes a new account). Match records keep the old uid and name.

### 3.7 Nightly backup (`scripts/backup.sh`)

In order: Nakama's database (`backups/nakama-<time>.sql.gz`), the match records (`backups/matches-<time>.tar.gz`: `MATCH_DIR` without the replays, which live 3 days anyway), then the guest cleanup. The newest 14 of each are kept.

## 4. Checks

| Check | What it covers |
|---|---|
| `protocol.check` | The binary snapshot's round trip and ranges, `welcome.chat`, uids |
| `fairplay.check` (plain node) | A fair stream stays clean; the cheating patterns are counted |
| `server.check` | Bytes, `welcome.chat`, the record written, a replay run again to the same outcome |
| `client.check`, `netplay.check` | Unchanged assertions, through the binary snapshot |
| `scripts/chat-smoke.mjs` (needs Nakama) | Two guests: room message, team privacy by name, the length and rate limits, nothing persisted, a whisper delivered |
| `scripts/guests-smoke.mjs` (local Nakama only: psql backdates its accounts) | Who the cleanup deletes (an old guest, 250 more in one call) and who stays (young, online, linked, email); a player's session refused |

## 5. Why gameplay stays out of Nakama (evidence, 2026-09-29)

Nakama 3.30.0 and 3.41.0 source, and Nakama 3.41's own JS engine (goja
`v0.0.0-20260906210903-70ad66ec7ce4`) driven directly, on an Apple M1 Pro:

| # | Finding |
|---|---|
| V1 | goja has no `WebAssembly`; Rapier 0.20 ships only as WebAssembly. |
| V3 | goja ran our arena builders 56–88× slower than Node, and a pure-JS physics engine (cannon-es, 8 cars, 800 boxes) at 240 ms a step against a 16.7 ms budget. |
| V4 | goja's `sin`/`cos` differ from V8's in the last bit for about a quarter of inputs. Built in goja, Scrapyard's spawn order changes (digest `89bbbca1`, not `b0ce6b61`). |
| V7 | Nakama's match loop drops ticks when a tick runs long (no catch-up), and stops a match whose call queue fills. |
| V8 | Nakama's matchmaker removes a ticket when its socket closes; custom matching (override, processor) is Go only; a newcomer doesn't inherit a waiting ticket's age. |
| V11 | Nakama's socket base64-encodes match data inside JSON: an input grows from 88 to 254 B, a snapshot from 757 to 1127 B. |
| V17 | One Node process ran 96 rooms × 8 players at 52 % of a core (p99 step 14.6 ms, 604 MB); Rapier is 60 % of a room's CPU. Bandwidth (22.8 KB/s a player) runs out before CPU. |

**Rejected:**
- **Running gameplay in Nakama's JS or Lua runtime.** Impossible or too slow (V1, V3, V4).
- **A Go plugin that ports the game with Rapier over cgo.** Two implementations of the game forever, and a crash in the plugin takes Nakama down. The gain (native Rapier on 60 % of the step) lands on the resource that isn't short.
- **A Go plugin that drives the Node simulation, or embeds V8.** An extra hop, and nothing gained against cheats.
- **Client-authoritative relayed matches** (the Pirate Panic tutorials' model). No anti-cheat.
