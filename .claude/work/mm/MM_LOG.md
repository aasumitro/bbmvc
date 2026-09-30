# Classic matchmaking — log

The plan and the Phase 0 map: `MM_PLAN.md`. Paths under `game/` unless noted.

## Phase 1 — the matcher

- `server/matchmaker.ts`: `MATCHMAKING` (every value in the brief, camelCase
  as the codebase's configs are, the brief's names in the comments) and
  `createMatchmaker(hooks, config, compatible)`. Pure; the clock, the rooms,
  the room count and the messages come through `hooks`. Tickets by uid (one
  each), proposals in their ready check, arena rotation per mode, backfill
  offers before new groups, the size windows by the oldest ticket's wait.
- `server/matchmaker.check.ts`, plain node, in `npm run check`: 62 checks —
  the queue (start, repeat, cancel, grace, restore, out of groups while away),
  groups (8 at once; 7 at 10 s; 3 not at 10 s, 4 with a newcomer; 2 at 30 s,
  not before; 1 never; builds and modes apart; 16 in two disjoint groups;
  rotation; the room cap), the ready check (all, 7 + a decline, partial at
  the deadline, too few -> requeue with the original `createdAt` and first
  in the next group, nobody, a late accept, an accept on the deadline's own
  tick in both orders, stale and foreign answers, cancel = decline, a drop
  after accepting, no room -> requeue), backfill (offered at once, not past
  half, not another mode/build/full room, only listed rooms, one seat two
  searchers, a decline passes it on, before new groups and fullest first,
  off).
- Verified: `tsc -b`, lint, `npm run build`, `npm run check`. netplay's
  real-time "queue back to 1 within about a second" failed once (1676 ms)
  while other work loaded the machine; alone it passed (1054 ms). No code
  netplay runs had changed.

## Phase 2 — protocol, sessions, the Classic page

- `src/net/protocol.ts`: `PROTOCOL` 3. The hello's `mode`/`map` are
  optional: both = a seat at once (as before, but in a room of that mode *on
  that arena* again: the busiest-room pooling of 9bc0134 is gone); neither =
  a matchmaking session. Client `mm` (`search` mode, `cancel`, `accept` /
  `decline` id, `state`); server `mm` (`Queue`: idle + note, searching +
  waited, found/accepted + proposal); `busy` error. `parseClient` + 8 new
  protocol checks.
- `server/lobby.ts`: sessions (`enter` / `queue` / `exit`), one per uid (a
  new one takes over the ticket; refused while seated), idle sessions let go
  after a minute; the matcher ticked every step. `server/server.ts`: a hello
  without a map opens a session; `mm` messages go to the lobby (a bad one is
  a strike); `/health` counts `searching`.
- `src/net/connection.ts` split: `sayHello`, `join` (the checks' seat at
  once), `link(socket, welcome)`. `src/net/matchmaking.ts`: the store (owns
  the socket from Find Match to the seat; mirrors the server's `mm`; notes
  said for 5 s; reconnects within the grace). `screens/search.ts` (hooks,
  a clock on `useSyncExternalStore`), `screens/Matchmaking.tsx` (ready check
  overlay with keys Enter/Y and N, the searching line away from the arena
  screen, the note), `screens/MapSelect.tsx` (Classic = Find Match / Cancel
  search with the time waited; Practice says "while you wait"), `App.tsx`,
  `game/audio.ts` (`found` cue on the menu bus: heard paused or in menus).
- server.check: sessions over real sockets (no word until asked, search,
  second tab takes the ticket, repeat search, cancel, busy, junk, found for
  two, accept heard by both, decline -> the other requeued with its wait,
  drop and restore unasked, gone after the grace).
- Browser (scratch harness: dev build, a stand-in Nakama signing guests with
  the server's key, the real server bundle; two origins = two guests):
  Find Match -> "Finding players · 0:0x", the overlay (dots, bar, seconds,
  Accept/Decline), a missed check back to idle. A third guest was active in
  the same harness during the run (not from this session's clicks); the
  server handled its accepts as designed.

## Phase 3 — rooms from proposals, the hand-over, backfill

- `server/room.ts`: `build`, `hold` (steps the first match waits for every
  seated page's first input; nothing steps meanwhile, inputs are read and
  acked; `load timeout` logged with who was late), `free()`, `progress()`;
  `st` carries `hold`.
- `server/lobby.ts`: `openings` and `start` — a new room (hold =
  `loadTimeoutMs`) with everyone who accepted, oldest first, or the
  backfill's bot seat; seated on the socket they searched on.
- Page: `net/client.ts` mirrors `hold` (`holdIn`; the rules' clock stands
  still meanwhile); `match.ts` `holdIn` (no countdown beeps while held);
  HUD banner "Waiting for players · n s"; `runtime.ts` plays a handed
  seat (no sign-in / connect / join steps; the arena the welcome names);
  `GameCanvas.tsx` takes `link` (no Retry online; "Joining the match ·
  arena · n players"); `App.tsx` takes the seat from the store and goes
  into the match from any screen, a fresh gameplay screen per match; the
  seat's link is closed on exit (a start React runs twice in development
  must not close it under the second).
- server.check: accept -> one room opened once, both welcomed on their
  sockets, opposite sides, tickets done, a fresh match; the match stands
  still until both pages play, starts at the load timeout without the late
  one (its bot drives until its first input), the late page takes over; a
  seated player's other tab is `busy`; a third searcher is offered and
  seated in the running match (no second hold); both pages in -> the
  countdown at once. client.check: two headless pages matchmade over the
  real modules, the wait mirrored, then the countdown on both.

## Phase 4 — searching while practising

- Nothing new was needed beyond Phases 2–3: the store and the overlay live
  above the screens (`App.tsx`), so Practice starts during a search, the
  searching line sits at the right edge of the HUD, the ready check shows
  over the practice match with its keys taken before the game's, and the
  seat swaps the practice gameplay screen for a fresh online one (its own
  `key`), which disposes the practice match. `match.ts` beeps no countdown
  while an online room holds.
- Browser (harness): FFA search -> Practice -> a scripted second player
  searched; the overlay came up 26.5 s into the practice match (still
  running), Y accepted, the page went into the online room (2 people). A
  third scripted searcher was then offered and seated in that match: "Online
  · 3 players", "Guest pt-d joined".

## Phase 5 — reconnect and tabs

- Server (Phase 2): a session replaces an older one of the uid without
  counting as a drop; a new session gets the ticket kept for it; a seated
  uid's session is `busy`. server.check asserts the replaced socket's close
  leaves the ticket connected.
- Page: the first try to come back is at once (then 1, 2, 4, 7 s: inside the
  15 s grace); a per-tab sessionStorage mark (`scrapyard.search`) while a
  ticket is out, and `resumeSearch` when the menu first shows after a reload.
- Browser (harness, the page's socket through a TCP hop that could be cut):
  a reload resumed the search with its age (0:07 before, 0:15 after); a cut
  connection was back in 3 ms, same ticket; a second tab of the same guest
  took the search over (its count at the ticket's age) and the first said
  "Searching in another tab now"; one ticket throughout (`/health`
  `searching: 1`).

## The real stack

Nakama in Podman (`nakama-smoke.mjs` ok), `npm run server`, a development
build of the page on its own port. Two Nakama guests (two origins) searched
Team Deathmatch; the proposal came 30.0 s after the older ticket, both
accepted, one room opened with them on opposite sides, the HUD said
"Waiting for players · 6 s" with the clock held at 10:00, then the match ran.
One page was later let go after a minute without input (its window stopped
drawing in the background: the existing idle rule).

## Classic on the arena picked (2026-09-29)

Classic ignored the arena card: the matcher rotated each mode's arenas from
index 0, so the first match after a restart was always Scrapyard. Now the
search carries the arena (`Queueing.map`, PROTOCOL 4), the lobby refuses a
mode/arena pair the registry doesn't host, `sameQueue` adds the arena, a
proposal plays on its tickets' arena and backfill only offers rooms on it.
The rotation and the `arenas` hook are gone. Every arena in `MAPS` is
playable online with no server change. The cost: the queue splits per
arena, so few searchers wait longer. The page keeps `{ mode, map }` in the
`scrapyard.search` mark and shows both while searching.
