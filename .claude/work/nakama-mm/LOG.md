# Online play with Nakama — log

The plan and the reasons: `PLAN.md` (same folder). Paths under `game/` unless
noted. Nothing here is committed yet.

## 2026-09-29 — feasibility (Phase 1 of the brief)

- The brief was to run Classic fully on Nakama: matchmaking and gameplay.
- The feasibility work is in `PLAN.md` §5: Nakama 3.30.0 and 3.41.0 source, and Nakama 3.41's own JS engine driven directly.
- Its finding: gameplay can't run in Nakama's scripting runtimes (no WebAssembly, 56–88× slower, different maths), and moving it into a Go plugin gains nothing against cheats while adding a hop and bytes.
- The owner's goals were fast, many players on a small server, and cheat-free. Given those, they chose Nakama as the control plane and the game server as the authority, plus in-match chat on Nakama. On match history they chose option B: records and replays on the game server now, Nakama storage in the next phase.

## 2026-09-29/30 — what was built

### Nakama 3.41.0

- `nakama/compose.yml` and `deploy/compose.yml` go from `3.30.0` to `3.41.0`.
- A throwaway 3.41 stack (its own project, Postgres on tmpfs) started clean: four new migrations applied, both Lua modules loaded, `chat.lua`'s four before-hooks registered.
- `scripts/nakama-smoke.mjs` passes against it unchanged: guest and email sign-in, refresh, socket, `join_online`, logout.
- Session tokens are signed as in 3.30 (V13), so the game server needed no change.

### Binary snapshots (`src/net/protocol.ts`, `server/room.ts`, `server/server.ts`, `src/net/connection.ts`)

- The snapshot is now a binary frame. `packCars` packs the machines once a snapshot; `packSnapshot` wraps them with each player's own ack and row; the events travel as JSON at the end.
- Pages read every server message through one reader (`readServer`) and open sockets with `binaryType = 'arraybuffer'`.
- The integers are those of the JSON rows, so nothing the page computes changes. The 16- and 8-bit fields are clamped (velocity ±327 m/s, never met).
- `PROTOCOL` 5 (with the chat fields below).
- Measured by `server.check`'s budget, 2 players and 6 bots fighting for 30 s:

| | Before (JSON) | Binary |
|---|---|---|
| Scrapyard, down a player | 24.6 KB/s (worst second 32.3) | 16.4 KB/s (24.2) |
| The City, down a player | 26.7 KB/s | 18.2 KB/s (23.5) |
| Snapshot, average / largest | 757 / 1021 B | 476 / 746 B (Scrapyard); 486 / 825 B (City) |
| Up | 4.9 KB/s | 4.9 KB/s (unchanged) |
| Room step | 0.22–0.25 ms (Xeon) | 0.107–0.112 ms (M1 Pro) |

- The protocol check covers the frame: its round trip to the same integers, the events whole, a view into a larger buffer (Node) and an ArrayBuffer (browser), clamping, refusal of a non-snapshot frame, and that it's smaller than the JSON.

**Relevance culling: measured, not built.** See "Culling, measured" below.

### Match records, fair play, replays (`server/fairplay.ts`, `records.ts`, `replay.ts`, `replay-main.ts`, `room.ts`, `lobby.ts`, `server.ts`, `main.ts`)

**Fair play** (`fairplay.ts`, pure, with `fairplay.check.ts`):
- The room feeds it each person's driving step: the aim as given, the trigger, their machine's roof and the chase camera's place, and the hostiles where that person's page drew them (the rewind's poses at their view tick). Hits come from the simulation's `hurt` events.
- It counts three signals:
  - firing with the aim inside (0.9 m of where lock-on aims) a hostile that neither eye can see;
  - swings of over 40° in two steps onto a hostile, hit within 12 steps;
  - triggers pulled within a step of the aim arriving on a hostile.
- A seat past its threshold is flagged (30 steps; 8; 10 and 60 % of pulls).
- `fairplay.check`: a fair player is never flagged, not even aiming at the face of a wall with a hostile behind it; each cheat pattern is counted and flagged; a new person in the seat starts clean.

**Records:**
- When a match ends, the room builds its record and logs `match ended`, plus `fairplay` for each flagged person (and for a flagged person who leaves early).
- With `MATCH_DIR` set, the record is appended as one JSON line to `matches-YYYY-MM.jsonl`.
- Times run on the room's clock (made at + steps), so a replay says exactly the same record.

**Replays:**
- Each room's journal goes into `replays/<day>/<room>-<ms>.ndjson.gz` (gzip streamed while the room runs) and is closed with the room. The server waits for the files on SIGTERM.
- The journal's `in` lines hold only changes, and carry the view as its lag behind the step, so a steady page writes nothing new. A machine standing down or coasting writes only `[seat, kind]`, since its input isn't used.
- `replay.ts` runs a room again from a journal, streaming, through the room's own code: `drive` takes a replay's given in place of the queue.
- `node dist-server/replay.js <file> [matches…]` prints each match and says whether it matches the kept record.
- Replays older than `REPLAY_DAYS` (3; it was 14 until the owner asked for 3 on 2026-09-30) are pruned at start and daily.

**`server.check`, the new section:**
- A team deathmatch room with its journal on disk; people join, go quiet, leave, and join again; the match plays to its natural end and into the next.
- Run again from the gzipped file: the same number of steps, every machine at the same place, speed, health and statistics, and the same match record, fair-play counts included.
- Also the record's line on disk, and the pruning of a replay folder from 2000.
- The journal's size for 10.1 minutes of a room with 1–2 people aiming every step, gzipped:
  - 724 KB with the view written as a tick;
  - 566 KB with it written as its lag behind the step (a steady page writes nothing new);
  - 564 KB once a standing or coasting machine writes only `[seat, kind]`. That last change doesn't show here: these players never stand or coast.
- That's ≈ 56 KB a room-minute when people aim all the time.

### The match chat (`src/net/chat.ts`, `hud/Chat.tsx`, `screens/GameCanvas.tsx`, `game/input.ts`, `src/net/session.ts`, `nakama/data/modules/chat.lua`)

**The room's side:**
- Each room makes its chat channels: `sy-` and 24 hex digits for everyone, plus one per team in team deathmatch.
- The welcome gives each seat `chat: {all, team}`, and every seat's `uid` ('' for a bot); `ro` carries the uid too.
- `server.check`: the names' form, the same room channel for everyone, a different team channel per side told to each side only, none in free for all, another room's differs, and the uids.

**The page:**
- `session.ts` shares its Nakama socket (`onSocket`).
- `chat.ts` joins the room's channel and the team's, and joins again after a reconnect. It whispers by direct message to a seat's uid: it joins, waits up to 5 s for the other side, and says so if they don't come. A "wants to chat" notification from someone in the match makes it join back; the notification is then deleted.
- Commands: `/w name`, `/r`, `/mute`, `/unmute`. Names come from the match's seats.
- Lines show once Nakama has sent them back.

**The chat box** (`hud/Chat.tsx`):
- The last 6 lines at the left edge above the speedometer, fading after 10 s; 12 while open.
- Enter opens a line to everyone, T to the team (Tab switches while typing), Enter sends, Esc closes. A click on the arena closes it too.
- `GameCanvas` shows it only while an online match is played (not under a menu or the results). While it's open, a lost pointer lock doesn't pause, and sending takes the mouse back.
- Typing never drives: the input's keys stop there, and `input.ts` ignores text boxes.

**`chat.lua`:**
- Room channels only under the game's names; direct messages as Nakama keeps them; groups, edits and removals refused; nothing stored.
- A message is `{"text"}` of 1–200 characters, and a user may send 8 in 10 s (the local cache is shared by every Lua VM).
- Refusals raise errors, so the socket stays open.

**`scripts/chat-smoke.mjs`, against the 3.41 stack — all passed:**
- a room message reaches both guests, with no history kept;
- refused: other room names, a group, 201 characters, empty and non-`{"text"}` messages, all with the socket still open;
- 200 characters of `é` pass (characters, not bytes);
- a 17-message burst is cut at 8 in 10 s, and the limit is per user;
- a whisper is requested, joined back and delivered;
- an edit is refused;
- the guests are deleted.

### Copy and docs

- **Game:** the patch notes (0.11.0: chat, lighter data, records kept for fair play), and Settings → Controls (a Chat group).
- **Site:** the guide's Controls (a chat section) and FAQ (chat in online matches). The FAQ's privacy answer said "Nothing from the match itself is stored after it ends"; that is no longer true, so it now says what is kept (records; replays for 3 days; chat not stored).
- **AGENTS.md:** the root (scope: the chat; records on the game server and Nakama storage next phase; layout; the chat contract between game server, page and `chat.lua`), `game/`, and `nakama/`.
- **Also:** `nakama/README.md`, `NET_ARCHITECTURE.md` (control plane, binary snapshots, fair play, what a room keeps, the chat), and a pointer from `NET_RUNBOOK.md` to this log.

### Deploy

- `deploy/compose.yml`: the game server gets `MATCH_DIR=/home/node/matches` on a named volume `game_matches`. Tested locally: Podman gives a new named volume to the container's `node` user on first mount, with or without `:U`.
- `podman compose config` renders it.
- `.github/workflows/deploy.yml`: the smoke step runs `scripts/chat-smoke.mjs` after the Nakama smoke test.
- The deploy uploads `dist-server/` without the checks and `load.js`, so `replay.js` goes to the server with the rest.

## In a browser (Chrome, a production build, the local game server, Nakama 3.41)

Setup:
- `VITE_GAME_SERVER=ws://127.0.0.1:7360/match npm run build`, then `vite preview` on `:4173` and `:4174`: two origins, so two guests;
- the game server's bundle from the same sources (one build id), with `MATCH_DIR` set;
- the throwaway Nakama 3.41 stack.

**Flow:**
- Both pages signed in as guests.
- Both found Team Deathmatch on Scrapyard; the second found it at once, since the first ticket had waited 30 s.
- Both accepted and were seated on opposite sides. The room held until both loaded, then played; the HUD, the snapshots and the machines behaved as before.

**Chat, page to page:**
- A message to everyone showed as "You: …" on the sender's page and "Guest 4b3b: …" on the other's, and the line closed on sending.
- T opened the team line ("TEAM"). The message showed as "[Team] You: …" on the sender's page, and never on the other team's page, not even in its history.
- `/w Guest 4b3b psst` (a name with a space) showed "[To] Guest 4b3b: psst" on one page and "[From] Guest e449: psst" on the other. `/r got it` went back the other way.
- 64 characters of `w` and `a` typed into the line left the car at 0 km/h.

**Bug found and fixed:** the first session showed "Chat is unavailable" although the room chat worked.
- The cause: nakama-js types `Channel.presences` as an array, but it is absent when nobody else is in the channel. `chat.ts` read `.map` on it after the room join had succeeded, so the team channel was never joined.
- Reproduced in Node with nakama-js against 3.41 (`presences: undefined`), fixed (`?? []`), and seen gone in the second session.
- Someone else was also in the pages during the first session (a third guest in the room, lines typed into the tabs), so what else happened in it isn't evidence either way.

**Replays:**
- The first session's room (three people, 6.1 minutes, then stopped by SIGTERM) left a 193 KB replay. `node dist-server/replay.js` ran it again in 3.2 s. No match had ended, so there was no record to compare.
- Its journal showed a line every step while a machine stood (the first match's hold) or coasted (a hidden tab): the input's view stayed put while the step moved on. Those kinds don't use the input, so they now write `[seat, kind]` only. `server.check`'s replay stays exact (133 checks).

## Checks

- `npm run check` in `game/`, the final run after every change, exit 0:

| Check | Result |
|---|---|
| bots | 21 |
| ffa | 143 |
| tdm | 163 |
| simulation | 28 |
| loading | 23 |
| protocol | 70 |
| **chat** (new) | 14 |
| matchmaker | 63 |
| **fairplay** (new) | 10 |
| arena | 64 |
| server | 133 (was 120) |
| client | 32 |
| netplay | 33 (the stall recovery at 758 ms) |

- `npx tsc -b` is clean. `npm run lint` shows only the earlier warning in `Drawer.tsx`.
- `www/`: `lint`, `check` and `build` pass, with the chat added to the guide and the FAQ's privacy answer rewritten.
- **New:** `src/net/chat.check.ts` (plain node, 14 checks): a line read as a message or a command, names with spaces, whole names over longer ones, the start of just one name, and the notes.
- `scripts/nakama-smoke.mjs` and `scripts/chat-smoke.mjs` against Nakama 3.41: both pass.
- `podman compose config` for `deploy/compose.yml` renders it.

## Culling, measured

- **Method:** bots-only rooms, 2 minutes each after the countdown, seed 42. At every snapshot, every machine was taken as a viewer and each other machine sorted into four buckets:
  - hostile or not;
  - beyond 88 m (the minimap's 78 m plus a margin);
  - out of sight of both the roof (1.6 m) and a raised eye (4.9 m), by rays against the static arena;
  - all three together: a row a server could leave out.
- **Tool:** a scratch script bundled with the game's rolldown; not committed.

| | Rows | Hostile | Hostile beyond 88 m | Also out of sight (could be left out) |
|---|---|---|---|---|
| Team deathmatch, The City | 193,256 | 57.1 % | 20.9 % | **14.6 %** |
| Free for all, The City | 193,256 | 100 % | 70.2 % | **61.6 %** |
| Team deathmatch, Scrapyard | 193,256 | 57.1 % | 19.0 % | **7.3 %** |
| Free for all, Scrapyard | 193,256 | 100 % | 73.7 % | **58.8 %** |

- **What it means:** in free for all, about 4 of the 7 other machines could go unsent on a typical snapshot. That is about 40 % of the snapshot's bytes (≈ 16 → 10 KB/s down), and those players are off a wallhack.
- **Why TDM saves little:** teammates are always sent, and fights bunch up.
- **Not built in this round:** the page would have to hide what it stops hearing about (its model, markers, the minimap's ring, engine sound, its local physics body, lock-on), and guard against pop-in. `PLAN.md` §3.2.
- **Caveat:** the numbers are bots'; people may spread out more or less.

## Netplay's timing check is flaky, before and after

`netplay.check`'s "after a stall's burst the queue is back to 1 within about
a second" (≤ 1250 ms) failed once in the first full run with these changes
(2786 ms, other work loading the machine).

Measured against the committed code, three runs each, alternating, on the
same idle-ish machine:

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Committed code (`HEAD`) | 2082 ms (fail) | 1208 ms | 1113 ms |
| With these changes | 682 ms | 1727 ms (fail) | 1058 ms |

Both fail about one run in three. MM_LOG saw the same check at 1676 ms
under load and 1054 ms alone. It was flaky before this work, and the binary
snapshot doesn't touch the input queue it measures. The threshold is left
alone: raising it would be a decision of its own.

## 2026-09-30 — guests kept 3 days, backups, the Arena screen

**Asked:**
- the editor's TS2339 on `server.ts:226`;
- guests deleted after 3 days, registered players kept;
- replays pruned after 3 days, not 14;
- a disabled Custom entry between Free for all and Back;
- the right side of the Arena screen cleared while Back is chosen;
- the match records in the nightly backup.

**TS2339** (`strike(parsed.error)`):
- The editor's TypeScript isn't strict by default, and `!parsed.ok` narrows the union only under `strictNullChecks`. `parsed.ok === false` narrows under either.
- `tsc --strict false` reproduced it; clean now both ways.

**Replays:** `REPLAY_DAYS` defaults to 3 (`main.ts`); the patch notes, the FAQ and the docs say 3 days.

**Guests** (`nakama/data/modules/guests.lua`, PLAN §3.6): `prune_guests`, HTTP key only. Checked on a throwaway Nakama 3.41 (Postgres on tmpfs):
- a player's session gets 403;
- deleted: a guest made 4 days ago, with its device row;
- kept: one made 2 days 23 hours ago, a 4-day-old guest online (a socket on the online stream), old guests who linked an email or a custom ID, an old device account with a provider login, an email account, the system user;
- the same device ID then signs in as a new account;
- 600 old guests in one call: 355 ms (0.59 ms a guest), three pages of 200.

`stats.lua` now returns its stream and `guests.lua` requires it. Nakama evaluates a required module once, so each RPC still registers once: the boot log lists `join_online`, `get_stats` and `prune_guests` once each. `scripts/guests-smoke.mjs` holds all of the above (local only: it backdates its own accounts with psql) and passes.

**Backup** (`scripts/backup.sh`, PLAN §3.7): the database, then `matches-<time>.tar.gz` (the records, not the replays), then `prune_guests` from inside Caddy's container. Its two container commands were run in `node:24-alpine`, the game's image (Caddy's is Alpine too, with the same BusyBox):
- `tar --exclude replays` leaves the replays out, and works on an empty folder;
- `wget --post-data ""` reaches the RPC and prints `{"deleted":…,"more":false}`;
- a wrong key exits 1 (401), which stops the script after the backups are written.

**Arena screen** (`screens/MapSelect.tsx`, `screens/Menu.tsx`):
- A menu item can be `disabled`: dimmed, its hint always shown, never chosen by the pointer, Tab or ↑↓. Custom is one, "coming soon", between Free for all and Back.
- The right side renders only while a mode is highlighted. That dropped the state that kept the card on the last mode while Back was chosen.
- In Chrome, on a production build (`vite preview`; the dev server wasn't running):
  - ↓ from Free for all lands on Back, ↑ from Back on Free for all, and the ends wrap;
  - pointing at or clicking Custom changes nothing;
  - Back leaves the right side empty, and a mode fades it back in;
  - Enter opens a mode as before.

**Copy:** patch notes 0.11.0 (guests kept 3 days; the Arena screen), the main menu's tooltip on a guest's name, the site's account notice for guests, and the FAQ (twice).

**Docs:** `AGENTS.md` (root, `nakama/`), `nakama/README.md`, the SQL guide (3.41; `user_device.provider`), `NET_ARCHITECTURE.md`, the comment in `deploy/compose.yml`, and PLAN §3.6–3.7.

**Checks:**
- `npm run check` in `game/`: every count as in the table above, except netplay once. "A crossing shot fired away from a stall hits" missed at 1290 ms into a stall's cycle during the full run (after the builds, the machine loaded). Alone, six runs: four passed, the shot hitting 1257–1323 ms into the cycle each time; two failed before it, at the stall recovery (1615 ms, 2366 ms), the flake measured above. Nothing in this round touches netplay: the missed shot is the same kind of timing flake.
- `npx tsc -b` is clean; `npm run lint` shows only the old `Drawer.tsx` warning.
- `www/`: `lint`, `check` and `build` pass.

## Owner's steps

Every command is one line.

**1. Nakama 3.41 locally.** Your dev stack still has 3.30's database; the new image upgrades it at start, and that doesn't go back. Dump it first:
```sh
cd nakama && podman compose up -d postgres && podman compose exec -T postgres pg_dump -U postgres nakama > ~/scrapyard-nakama-before-3.41.sql
```
Then:
```sh
cd nakama && podman compose up -d
```
Then, from the repo root:
```sh
node scripts/nakama-smoke.mjs
node scripts/chat-smoke.mjs
```

**2. Chat in two browsers.** Use a normal and a private window (two guests), Classic on the same mode and arena, then:
- Enter to chat to everyone, T to the team (team deathmatch);
- `/w <name> hi` and `/r hi` for whispers;
- `/mute <name>`.

**3. Records and replays locally.**
```sh
cd game && MATCH_DIR=/tmp/scrapyard-matches npm run server
```
After a match ends there, `matches-YYYY-MM.jsonl` and `replays/<day>/…` hold it. Run it again and compare with the record:
```sh
node dist-server/replay.js /tmp/scrapyard-matches/replays/<day>/<file>.ndjson.gz /tmp/scrapyard-matches/matches-*.jsonl
```

**4. Deploy:**
- Run `scripts/backup.sh` on the server first: the compose file's new Nakama image migrates the database.
- The deploy then recreates everything, because `compose.yml` changed.
- The smoke step now includes `chat-smoke.mjs`.
- Match records land on the `game_matches` volume (`podman volume inspect deploy_game_matches` shows where).
- Size `REPLAY_DAYS` to the disk: a room with people writes up to ~60 KB a minute of replay.
- Nakama restarts with the deploy (its modules changed), which loads `guests.lua`.

**5. The nightly backup on the server.** `scripts/backup.sh` runs only if cron runs it; the deploy runbook (`.claude/work/deploy/config.md`, local) has the lines to check and add it. Its first run deletes every guest made more than 3 days before, existing ones included; the dump it makes first still holds them.

**6. The guest cleanup locally** (optional): `node scripts/guests-smoke.mjs` from the repo root, with your dev stack up. It deletes that stack's guests older than 3 days too.
