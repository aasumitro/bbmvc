# Changelog

Changes to the repository: the game server, accounts, the site, deploy and tooling. What
players see in each game version is in the game's own patch notes,
`game/src/screens/PatchNotesPanel.tsx` (shown on the main menu); a version here names the game
version it shipped with.

## Unreleased

## 0.11.0 — 2026-09-30

Nakama stays the control plane (accounts, sessions, the online count, now the match chat); the
game server stays the authority for every outcome. Plan, measurements and log:
`.claude/work/nakama-mm/`.

### Game (`game/`)

- Classic plays on the arena you pick: matchmaking groups tickets by mode, arena and build,
  and offers seats in running matches on that arena only. `PROTOCOL` 5.
- Chat in online matches (`net/chat.ts`, `hud/Chat.tsx`): everyone, team (Team Deathmatch)
  and whispers (`/w`, `/r`, `/mute`), over the page's Nakama socket; typing never drives.
- The garage's loadout is kept in the browser (`scrapyard.loadout`): a reload no longer resets
  the gun to the Minigun.
- Arena screen: Custom (coming soon, disabled) between Free for All and Back; with Back
  chosen, the right side is empty. Menu entries can be disabled.
- New checks: `net/chat.check.ts`, `server/fairplay.check.ts`.

### Online play (`game/server/`)

- Snapshots travel as binary frames of the same integers: about a third less data down
  (24.6 → 16.4 KB/s a player on the Scrapyard). Every other message stays JSON.
- Match records: one JSON line per match in `MATCH_DIR` (result, each seat's person or bot,
  statistics, fair-play counts).
- Fair-play signals (`fairplay.ts`): aim on hidden hostiles, snaps onto targets, instant
  triggers; flagged in the record and a log line for review, never acted on.
- Replays: a gzipped journal per room; `node dist-server/replay.js` runs the room again to
  the bit and compares with the kept records. Pruned after `REPLAY_DAYS` (3).
- Each room names its chat channels (random, told only to its seats) in the welcome, with
  each seat's user id for whispers.

### Accounts (`nakama/`)

- Nakama 3.30.0 → 3.41.0 (four migrations at start; they don't go back down).
- `chat.lua`: the match chat's rules — only the game's room names, direct messages, no groups
  or edits, nothing stored, 1–200 characters, 8 messages in 10 s a user.
- `guests.lua`: `prune_guests` (runtime HTTP key only) deletes guests made more than 3 days
  ago — accounts a device is the only way into — except those online at the time.
- `scripts/chat-smoke.mjs` (also in the deploy's smoke test) and `scripts/guests-smoke.mjs`
  (local only).

### Site (`www/`)

- Guide: chat controls; the FAQ says what is kept (records, replays for 3 days, no chat) and
  that guests last 3 days; the account page tells guests too.

### Deploy

- The game server keeps records and replays on a named volume (`MATCH_DIR`).
- `scripts/backup.sh` also archives the match records (not the replays), then runs the guest
  cleanup from inside Caddy's container.

## 0.10.0 — 2026-09-29

First public commit. Earlier history (0.1.0–0.9.0) was developed in a private repository and
is summarized here.

### Game (`game/`)

- React + Three.js + Rapier client: two arenas (the Scrapyard, the City), Team Deathmatch and
  Free for All, the garage loadout (Minigun or Rocket Pod), bots at three difficulties with
  cover, ambushes and stuck recovery, HUD, scoreboard, results, settings, patch notes.
- One simulation for practice and online: deterministic from the match seed, runs headless.
- Self-checks under plain node (`npm run check`): bots, both modes' rules, the simulation,
  loading, the wire protocol, matchmaking.

### Online play (`game/server/`)

- Authoritative game server (Node + `ws`): runs every online match with the client's own
  simulation, modes and bots; validates every input and owns every outcome.
- Client prediction and reconciliation for the local car, interpolation for the others,
  hitscan rewound on the server up to 200 ms.
- Classic matchmaking: tickets per mode, groups as the oldest waits (8, then 4+, then 2+), a
  ready check, a room per match, backfill into bots' seats; searches survive a reload or a
  dropped connection.
- The door: allowed origins, Nakama-signed sessions checked by the server, size and rate
  limits, a build id in the hello (pages of another build are refused), pages that stop
  reading are dropped.
- Bundled checks (`npm run server:check`): the arenas' digests, a real server over real
  sockets, headless pages through `net/`, netplay at 50–150 ms each way and over a rough link.

### Accounts (`nakama/`)

- Nakama 3.30.0 on Postgres 16, run with Podman: email accounts and device guests, sessions
  of 2 h with 30-day refresh tokens.
- `stats.lua`: the online count (`join_online` over the game's socket) and `get_stats` for the
  site.
- `scripts/nakama-smoke.mjs`: sign-in, account, refresh, socket, match, logout against a
  running Nakama.

### Site (`www/`)

- Astro 7, static: home page with live player counts and a gameplay video, the guide (MDX),
  log in / register / account (React islands on Nakama); serves the game at `/play`.
- SEO: per-page title, description and canonical link; sitemap, robots, social cards.

### Deploy and CI

- `deploy/`: Caddy (TLS, security headers, the site, `/match` to the game server,
  `/api/stats` to Nakama), the game server, Nakama and Postgres in one compose file; secrets
  in the server's `deploy/.env`.
- `scripts/deploy.sh`: switches the site's release, and the game server's with it; rolls back
  both; refuses Nakama's default keys. `scripts/backup.sh` dumps Nakama's database nightly
  (cron), keeping the newest 14.
- CI on every pull request and push to `main`: lint, build and checks for `game/` and `www/`.
- Deploy after CI passes on `main`, with no stored credentials: GitHub OIDC → GCP Workload
  Identity Federation → OS Login over IAP, a pinned host key; smoke tests of the site, Nakama
  and an online match afterwards. Deploy identifiers are secrets, so public logs mask them.

### Repository

- MIT license, security policy, README.
- Agent instructions in `AGENTS.md` files (each `CLAUDE.md` imports its own), design notes and
  logs in `.claude/work/`, a SQL guide for Nakama's database in `.claude/codes/sql/`.
