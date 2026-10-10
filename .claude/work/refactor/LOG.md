# Game refactor — log

The plan: `PLAN.md` and the stage files (same folder). Paths are under `game/`
unless noted. Every step ends with an entry here: what ran and what it printed.
A new chat resumes at the first step without one.

Machine for every entry unless said: macOS 27.0 arm64 (M1 Pro, 10 cores),
Node 26.7.0, TypeScript 6.0.3, oxlint 1.85.0, Vite 8.3.0. The dev server on
`:3000` and Chrome stay up throughout, so the machine is never idle.

## Stage 0 — Safety net

### 0.1 Baseline (2026-10-08)

At `28bc205`: `3b0943d` plus the plan, no code changed.

**Gate commands**

| Command | Printed |
|---|---|
| `npm run lint` | nothing, exit 0; `npx oxlint --format=default`: `Found 0 warnings and 0 errors.` on 135 files with 116 rules |
| `npx tsc -b` | clean; 3.54 s, 3.45 s with the build info deleted, 3.43 s warm (real) |
| `npm run build` | clean; 3.95 s real (chunks below) |
| `npm run check` | run 1: every check but `netplay`'s rough link (below), 290.42 s real; run 2: all pass, 291.65 s real |

`npm run check`, check by check:

| Check | Printed |
|---|---|
| ai | `router ok` |
| bots | `bots ok (21 checks; kills a minute: easy 7.8, normal 13.8, hard 17.8)` |
| ffa | `ffa ok (152 checks)` |
| tdm | `tdm ok (182 checks)` |
| simulation | `simulation ok (58 checks)` |
| loading | `loading ok (23 checks)` |
| protocol | `protocol ok (90 checks)` |
| chat | `chat ok (14 checks)` |
| matchmaker | `matchmaker ok (63 checks)` |
| custom | `custom ok (71 checks)` |
| fairplay | `fairplay ok (10 checks)` |
| arena | `arena ok (72 checks)`; `scrapyard ... digest 227c4ce7`, `city ... digest 8913ad26` |
| server | `server ok (166 checks)`; `slow page: cut off 9.4 s after it stopped reading`, `journal: 572 KB gzipped for 10.1 min`, `handover: ... the bot drove it 23 m and fired`, rooms' steps 0.110 / 0.101 ms average |
| client | `client ok (47 checks)` |
| netplay | `netplay ok (33 checks)` in run 2 (rough link back to 1 within 1021 ms) |

**The six pins and the digests**

| Pin | Hash | Where |
|---|---|---|
| yard, tdm | `3ec7416629c569b3` | `src/game/simulation.check.ts` (asserted, not printed: `simulation ok` means it matched) |
| yard, ffa | `d457463001e9f922` | same |
| scrapyard, tdm | `d9ee9ad8fa7017af` | `server/server.check.ts`, printed: `classic, a whole match of bots: ...` (17.2 s) |
| city, tdm | `467400f8225aeea3` | same |
| scrapyard, ffa | `3c2735848552d2b4` | same |
| city, ffa | `6c4c3343a80b5f99` | same |

Arena digests `227c4ce7` / `8913ad26`, as in `server/digests.json`.
`PROTOCOL` 6.

**The flaky timing check**

First `npm run check`: `Error: netplay: rough link: after a stall's burst the
queue is back to 1 within about a second (2879 ms)`; that run's line: `queue
depth p50 2, p95 5, max 5; back to 1 within 2879 ms of a burst`. Then
`node dist-server/netplay.check.js` three times in a row, each `netplay ok (33
checks)`: back to 1 within 1029, 1217 and 1224 ms (the bound is 1250); and
1021 ms in run 2 of `npm run check`. One netplay run takes 177 s of the
check's 290.

**Sizes**

- Production code (`.ts`/`.tsx` in `src/` and `server/`, not `*.check.ts`):
  117 files, 22,000 lines. Checks: 15 files, 4,867 lines.
- Production files over 400 lines: `src/game/arena/city.ts` 836,
  `src/hud/Hud.tsx` 728, `src/game/materials/recipes.ts` 690,
  `src/game/arena/scrapyard.ts` 640, `server/room.ts` 613,
  `src/net/protocol.ts` 604, `src/game/ai.ts` 581, `src/game/ffa/rules.ts`
  536, `server/custom.ts` 499, `src/game/arena/props.ts` 477,
  `src/net/client.ts` 432, `src/game/simulation.ts` 431,
  `src/screens/Lobby.tsx` 415.
- `npm run build`, client (raw / gzip): `index.html` 1.04 / 0.56 kB,
  `index-*.css` 66.63 / 11.46 kB, `index-*.js` 222.59 / 69.81 kB, `App-*.js`
  3,989.97 / 1,399.72 kB (132 modules).
- `npm run server:build`: the shared main chunk `chunks/CLobJLYC.js` 4,435.22
  / 1,420.94 kB (93 modules); `main.js` 2.05 kB.

**Mode literals** (analysis Appendix B's grep): 39 lines in 11 files. The 34
in 7 shared files: `src/screens/LobbyForm.tsx` 8, `src/screens/Lobby.tsx` 7,
`src/game/matchSettings.ts` 6, `server/custom.ts` 6, `src/hud/Hud.tsx` 4,
`src/screens/Results.tsx` 2, `server/room.ts` 1. Besides them:
`src/game/maps.ts` 2 (the data lists), `src/App.tsx` 1 (the default pick),
`server/load.ts` 1, `server/browser.ts` 1.

**Type cycles** (oxlint `import/no-cycle`, throwaway config with plugins
`import` and `typescript`): `ignoreTypes: false` 43 reports in 14 files
(`tdm/mode.ts` 8, `modes.ts` 7, `ffa/mode.ts` 7, `tdm/rules.ts` 5,
`ffa/rules.ts` 4, `tdm/types.ts` 3, `items/supply.ts` 2, and one each in
`tdm/tactics.ts`, `simulation.ts`, `mode.ts`, `matchSettings.ts`,
`items/pickups.ts`, `items/items.ts`, `ffa/zone.ts`, all under
`src/game/`); `ignoreTypes: true` 0.

**Duplicates**

- `wrap`, 5: `src/game/camera.ts:26`, `src/game/view.ts:56`,
  `src/game/ai.ts:187`, `src/game/pilot.ts:28`, `src/hud/Hud.tsx:360`.
- `Point {x, z}`, 3: `src/game/mode.ts:28`, `src/game/items/items.ts:35`,
  `src/game/tdm/types.ts:8`; plus `server/fairplay.ts:26`, 3-D.

**`scripts/browser-match.mjs`** (Playwright's Chromium 153, SwiftShader)

- `custom`: every check ok, `browser match ok` at 90.5 s.
- Classic, as committed: `!!  locator.waitFor: Error: strict mode violation:
  getByText('Match found', { exact: true }) resolved to 2 elements` at 39.0 s.
  Known since `custom/LOG.md` (phase 0): the arena screen's Classic button
  and the ready check both say it.
- Classic with the wait scoped to the ready check
  (`getByRole('alertdialog')`, one line):
  - run 1: in one room, then `!!  a held W for 12 s: on b's screen a's car
    drove 0.2 m (0.0 m in 5 s with no key ...). a drew 4 frames a second and
    its match clock ran at 18 % of real time`. Both pages were in the match
    57 s after opening (Find Match's 30 s wait included), past the room's
    20 s load timeout, so its first match had started without them: a's page
    took over a damaged car (72/100, 5 rounds) that its bot had left nose to
    a container stack (screenshot). W against the stack moves nothing.
  - run 2: `browser match ok` at 105.5 s; a's car, taken over in the open,
    drove 40.7 m on b's screen.
  - So the Classic run is flaky at baseline when the pages load past the
    first match's start. Gate B reruns it once before looking further.

**Departure:** the one-line fix to `scripts/browser-match.mjs` above. It is
check tooling, not the game, and gate B can't run without it.

### 0.2 Steady timing check (2026-10-08)

`server/browser.ts` read first: `play` calls `each` once before every page
step, so one sample there is one page step.

**The plan's fix, measured, and why it didn't hold.** Every asserted
wall-clock bound in `netplay.check.ts` counted page steps instead
(`inSteps(ms)`, 60 Hz): the rough link's recovery `m - n <= 75`, the rocket
shove's and the wall hit's settle spans `<= 12` (corrections noted with the
page's step, its input's seq), and the crossing's 9 s and 600 ms by the
page's steps. Run with `npm run check` looping beside it, the rough link
failed in 2 of the first 3 runs: `76 steps, 1274 ms` and `127 steps, 2128
ms`. Steps and milliseconds agree (60 a second), so the page wasn't losing
steps and the wall clock wasn't the cause. Stopped there.

**What was measured instead** (a rough-link-only bundle in a scratch
worktree, 16 runs under the same load, the room's `step` and `input` wrapped
from the check):

- Recovery read after each of the room's steps, where the drain acts: 32–65
  steps in all 16 runs. Read from the page's frames, as the check did, it
  failed 13 of 16 (81–157 steps): a frame lands anywhere between two room
  steps, after deliveries the next step hasn't taken yet, and on a loaded
  machine it reads one or two more than the step leaves.
- The crossing shot fired away from a stall missed in 3 of 19 loaded runs.
  Its input arrives 13–14 steps behind the tick it saw (75 ms each way and
  the 67 ms drawing delay) and is used 15–17 steps after it; the rewind
  reaches 12. At 15–16 it hits (the hull's length absorbs the error), at 17
  it misses, and load adds that step: the 200 ms cap, not the drain. The
  shot in a stall's wake waited behind 4–5 inputs; the clear one, 1–2.

**The owner's decisions** (asked; choices outside the plan):

1. Recovery at the room's steps; the clear shot judged by what the drain
   controls, its input waiting behind 2 inputs at most. Hits stay printed,
   and the 150 ms round trip keeps judging hits with and without
   compensation.
2. With that in place, one loaded run of 20 recovered in 80 steps, past
   75: under load inputs arrive in clumps, the queue swings ±2, and the
   drain (it trims `lowest − 1` at the end of each 30-step window) needs part
   of a third window. The bound became 90 steps, three drain windows. The
   runs at 75 had recovered in 57, 80, 60, 40 and 59 steps.
3. Then run 4 of 10 at 90 failed on the clear shot: 3 inputs ahead of it
   (bound 2), and it hit. One shot's place in the queue is a single noisy
   sample (0–3 with the drain over 19 shots, 5 without). The crossing shots
   are now printed only, with their inputs ahead: the drain is held by the
   depth (`p50 <= 2`, 4 without it) and the recovery (`<= 90`, 294 without),
   and hits by the 150 ms round trip. The runs at 90 had recovered in 35,
   51, 59 and 33 steps (and 59, 51, 35 in the `npm run check` beside them).

**What changed** (checks only):

- `netplay.check.ts`, the rough link: `room.step` wrapped during the drive
  (the queue's depth after every room step) and `room.input` during the
  crossings (the inputs ahead of the one that fires, printed; `crossing`
  returns its seq). Recovery: room steps from 4 or more waiting to 1 or
  fewer, `<= 90`, the ms printed beside. The clear shot's check is gone
  (33 checks → 32). Elsewhere in it, the settle spans (`<= 12` page steps)
  and the crossing's loop count page steps, as above.
- `server.check.ts`, every asserted wall-clock bound:
  - neutral after the input stops: room steps since the stop `<= 24` (was
    `< 400 ms`);
  - a trigger toggled every message: rounds `<= fireRate × seconds × 1.1 +
    1`, seconds of the room's own steps (was `fireRate × 2.2 + 1` for
    "~2 s" of wall time);
  - driving after GO: the snapshot's tick 90 past GO (was `wait(1500)`);
  - the held room: 20 room steps (was `wait(400)`, then `tick > 20`); one
    page in: until its first input is taken (was `wait(300)`);
  - both pages in: released before the timeout's step, with no `load
    timeout` line for the room (was `< loadTimeoutMs / 2` ms);
  - the search's grace: until the ticket is gone (was `wait(grace + 200)`);
  - a page that stops reading: the room plays 10 steps on, waited for (was
    `wait(300)`, then `tick > tick + 10`).
  - Stays: the flood's `during < baseline × 3 + 0.5` ms. It measures what a
    room step costs, which has no step-count form: two back-to-back averages
    under the same load, with 3× and 0.5 ms of slack.
- Mutation review: `DRAIN = 1e9` in `room.ts` (scratch worktree) fails the
  rough link: `depth p50 4`; recovery 294 steps; the clear shot 5 ahead.

**10 runs in a row under load** (`server.check`, then `netplay.check`, from a
copy of `dist-server/`, while `npm run check` loops in `game/`):

| Run | `server.check` | `netplay.check` | Rough link: p50, recovery | Crossing shots: wake / clear |
|---|---|---|---|---|
| 1 | ok (166) | ok (32) | 1, 59 steps (984 ms) | miss, 5 ahead / hit, 0 ahead |
| 2 | ok (166) | ok (32) | 2, 39 steps (651 ms) | miss, 4 / hit, 2 |
| 3 | ok (166) | ok (32) | 2, 33 steps (548 ms) | miss, 4 / hit, 2 |
| 4 | ok (166) | ok (32) | 2, 59 steps (983 ms) | miss, 5 / hit, 3 |
| 5 | ok (166) | ok (32) | 1, 57 steps (950 ms) | miss, 4 / hit, 1 |
| 6 | ok (166) | ok (32) | 2, 59 steps (985 ms) | miss, 4 / hit, 1 |
| 7 | ok (166) | ok (32) | 2, 32 steps (533 ms) | miss, 5 / hit, 1 |
| 8 | ok (166) | ok (32) | 2, 33 steps (550 ms) | miss, 5 / hit, 2 |
| 9 | ok (166) | ok (32) | 2, 33 steps (551 ms) | miss, 4 / hit, 2 |
| 10 | ok (166) | ok (32) | 2, 39 steps (650 ms) | miss, 4 / hit, 1 |

The 9 `npm run check` runs beside them all passed, 288.7–291.3 s each,
recovery 34–62 steps. They ran this exact tree, so the last one is gate A's
`npm run check`.

Gate A: `npx oxlint` `Found 0 warnings and 0 errors.`; `npx tsc -b` clean
(3.33 s); `npm run build` clean, the same chunk hashes as at baseline
(`index-CN0V8sqO.js`, `App-B1lnH9eQ.js`); `npm run check` as above.
`npm test`: not yet (step 7).

Build id unchanged: `1bf0a82f70aa` (checks are outside it).

**Departures** (the owner's decisions above): recovery counted in the room's
steps, not the page's; its bound 75 → 90; the clear shot no longer judged.

### 0.3 Pins for custom settings (2026-10-08)

`server/server.check.ts`: `bare()` takes a `MatchSettings` (Classic's by
default, so the existing calls are as they were) and an optional `away`
schedule. At step `from` it calls `sim.vacate(seat)`; at step `to` it arms the
seat's own gun at its full rating (`armWeapon(WEAPONS[gun])`), then
`sim.occupy(seat)`: room.ts's calls for a custom room's person leaving and
coming back, in its order, between two steps. The seat's bot drives it again
once it's back. It returns the fingerprint, the steps run and the kills.

| Pin | Hash | The match |
|---|---|---|
| tdm, scrapyard, 12 seats: friendly fire, every pickup group, kill limit 25, fast respawn, 5 min; seat 11 empty from step 3600 to 7200 | `c6f185549c8774b2` | 45 kills; the kill limit ends it at step 7344 (122.4 s), 144 steps after seat 11 is back |
| ffa, city, 2 seats: no pickups, normal respawn, 5 min | `5e53e03454103914` | 1 kill; 18538 steps (309.0 s) |

Seed 1234 and the 700 s cap, as `GOLDEN`. Each pin also checks that its match
ended by itself, after the empty seat was back.

- The same twice in one process (a scratch bundle running both pins twice):
  `c6f185549c8774b2`, `5e53e03454103914` both rounds; 2.4 s each round.
- The same on Linux, Node 24.21.0 (`node:24-alpine` in Podman):
  arm64 (3.0 s), and x86_64 emulated (52.7 s). CI's own runner wasn't
  reached: that takes a push, which waits for the owner. **Departure:** the
  Podman x86_64 run stands in for CI.
- Printed by `server.check`: `custom, a whole match of bots: tdm scrapyard
  12 seats c6f185549c8774b2 (45 kills, 122.4 s), ffa city 2 seats
  5e53e03454103914 (1 kills, 309.0 s) (2.2 s)`.

Gate A: `npx oxlint` 0 warnings, 0 errors; `npx tsc -b` clean; `npm run
build` clean (`App-B1lnH9eQ.js` as at baseline); `npm run check` all pass in
291.44 s: `server ok (170 checks)` (+4: each pin, and that its match ended by
itself), the Classic pins as printed at baseline, `netplay ok (32 checks)`,
the rest as at 0.1. Build id `1bf0a82f70aa`.

### 0.4 Wire fixtures (2026-10-08)

Literals inline in the checks:

- `src/net/protocol.check.ts` (+5 checks):
  - a snapshot frame as hex: `packSnapshot` over `carRow` of two machines set
    by hand (one in play, flung past ±327 m/s on x so `packCars` clamps it;
    one an empty seat's), `meRow` of the first, one `bu` event. Read back
    field by field against the layout before pinning: kind 1, tick 98765, ack
    4321, clock 123456, 2 rows of 44 bytes (the clamped x velocity
    `ff7f` = 32767, flags 5 and 8), the 40-byte own row, then
    `[["bu",98764,120,50,-340]]`.
  - `JSON.stringify` of a welcome to a custom lobby's match (settings from
    `checkSettings`, a lobby id, an empty seat in the line-up), a `ro`, and
    `inputMessage(77, …, 4321)`.
- `server/server.check.ts` (+2): one event of each code (`sh` twice, a hit
  and a miss; `ln rk bu hu wr cr rl sp rc ru go`), as `createRecorder` writes
  them, a rocket's two steps joined into one `rk`, drained last. Read against
  `recorder.ts` before pinning.
- `server/custom.check.ts` (+2): a fixed lobby (free for all on The City, 6
  seats, 15 min, a password, join in progress, two people, a hard bot in slot
  3) as the list shows it (`LobbyRow`) and as a member sees it
  (`LobbyView`), its random id and invite code put aside as `ID` and `CODE`.
- Review: `i16(vx)` → `vx` in `packCars` (flipped locally). The existing
  clamp check fails first (`out-of-range fields are clamped to their size, not
  wrapped`); with that line set aside, the frame fixture fails too (the x
  velocity's bytes `ff7f` became `729c`). Reverted: `protocol ok (95 checks)`.

Gate A: `npx oxlint` 0 warnings, 0 errors; `npx tsc -b` clean; `npm run
build` clean (`App-B1lnH9eQ.js` as at baseline).

- `npm run check`, run 1: every check before `server.check` passed, then
  `server.check` died about 20 s in: `Error: refused` (a probe's socket got
  no 101 answer, or a network error). Nothing printed before it, so the
  section is unknown; it's socket code the fixtures don't touch (they run
  first, and passed). Not reproduced: `server.check` alone passed 6 times
  after (2 plain, 4 with the refusal's details logged). No cause found; if it
  comes back, the details patch from the scratch worktree goes in.
- One of those 6 took 524 s for the Classic pins instead of ~17 s, with the
  same hashes: the Mac slept (lid closed, on battery, 20:15–20:34,
  `pmset -g log`). It's on AC again, Low Power Mode off.
- `npm run check`, run 2: all pass in 289.49 s: `protocol ok (95 checks)`,
  `custom ok (73 checks)`, `server ok (172 checks)`, the 6 pins as before,
  `netplay ok (32 checks)`. Build id `1bf0a82f70aa`.

### 0.5 Every map with every mode at its largest size (2026-10-08)

`server/arena.check.ts` (+8 checks): for each map, each mode it hosts, lined up
at `max(CUSTOM.sizes[mode])` (12 for both): every seat its own start (by
position), and `MODES[mode].create` on recruits enlisted in a fresh world, as a
room builds it, with its match running. Printed: `every mode each arena hosts,
at its biggest: scrapyard tdm 12, scrapyard ffa 12, city tdm 12, city ffa 12`.

Gate A: `npx oxlint` 0 warnings, 0 errors; `npx tsc -b` clean; `npm run
build` clean (`App-B1lnH9eQ.js` as at baseline); `npm run check` all pass in
289.99 s: `arena ok (80 checks)`, digests `227c4ce7` / `8913ad26`, the 6 pins
as before, `server ok (172 checks)`, `netplay ok (32 checks)`. Build id
`1bf0a82f70aa`.

### 0.6 Screens baseline (2026-10-08)

14 screenshots in `shots/baseline/` (gitignored), 1280×720, quality low:
`menu`, `garage-minigun`, `garage-rocketpod`, `hud-tdm`, `board-tdm` (Tab
held), `death-board`, `results-tdm-win` (MVP), `hud-ffa`, `board-ffa`,
`results-ffa-loss`, `results-ffa-crown`, `lobby-form-advanced`,
`waiting-room` (6 v 6, a Normal bot in every other slot), `lobby-list`.
Each one looked at: the turret changes with the gun; the death board names
who wrecked the player; the results show the MVP, the place and the crown.

How: `shots/capture.mjs` (gitignored beside them), headless Chromium 153
through the global Playwright with SwiftShader, as `scripts/browser-match.mjs`,
against the dev server on `:3000`, the local Nakama (guests) and `npm run
server` for the lobby screens. The match states come from the dev build's
`window.match`: an enemy put 18 m in front of a player down to 1 hull; scores
and kills set, then the clock moved to the buzzer. A UI step reruns it into a
folder of its own for its after-shots: `node capture.mjs <folder> [names]`.
210 s, no page error and no console error.

**Departures:**
- Headless Chromium, not Chrome: the Claude in Chrome extension isn't
  connected. A script also makes the after-shots the same as the baseline.
- The dev server on `:3000` was down (its process ended, probably while the
  Mac slept, 20:15–20:34); the owner restarted it.

### 0.7 Vitest (2026-10-08)

**First, a race in `server.check`** (its own commit). The step's first `npm
run check` failed: `Error: server: the others hear of it`. The check waits
until the room has let a leaving player go, then reads another player's
inbox at once, while that player's word of it (`ro`) can still be on its
socket. Two other checks have the same shape (a newcomer's welcome on one
socket, everyone else's `ro` on theirs): `the state follows the welcome; the
others hear of a new player` and `the others hear of the newcomer`. Each now
waits up to a second for the message first, then checks as before (count
unchanged). Gate A on the fix alone (the Vitest files set aside): `npx
oxlint` 0 warnings, 0 errors; `npx tsc -b` clean; `npm run build` clean
(`App-B1lnH9eQ.js`); `npm run check` all pass in 291.28 s (`server ok (172
checks)`, the 6 pins as before, `netplay ok (32 checks)`).

**Then Vitest** (D4; `vitest` 5.0.2 was installed already, nothing new):

- `game/vitest.config.ts`: environment `node`; tests `src/**/*.test.{ts,tsx}`,
  `server/**/*.test.ts`, `*.test.ts` at the root; `__BUILD__` defined as
  `'dev'`. `tsconfig.node.json` includes it.
- `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`. CI's game
  job runs `npm test` after `npm run check`; the root README's check line
  too.
- `build-id.ts` skips `*.test.ts` and `*.test.tsx`, as it skips `*.check.ts`:
  the id is `1bf0a82f70aa` with `rng.test.ts` in `src/`, as before it.
- First test, `src/game/rng.test.ts`: the first ten draws of `createRng(1234)`
  as literals (k / 2³², exact in a double).
- Game `AGENTS.md`: the commands, the Checks intro, and "Where this project
  departs": new tests are Vitest; the `.check.ts` scripts stay until stage 9.

Gate A: `npx oxlint` `Found 0 warnings and 0 errors.` (137 files); `npx tsc -b`
clean (3.30 s); `npm run build` clean (`App-B1lnH9eQ.js`); `npm test` `Test
Files 1 passed (1)`, `Tests 1 passed (1)`, 105 ms; `npm run check` all pass in
289.95 s, as above.

## Stage 0 — done (2026-10-08)

Gates A and D green at every step; C not needed (no arena, physics, `sim/` or
mode code changed); B not needed (no screen, HUD, view, runtime or store
touched).

| | Baseline (0.1) | End of stage 0 |
|---|---|---|
| `npm run check` | 290–292 s; netplay's rough link flaky | 290 s; 10/10 under load (0.2) |
| check counts | protocol 90, custom 71, arena 72, server 166, netplay 33 | protocol 95, custom 73, arena 80, server 172, netplay 32; the rest unchanged |
| pins | 6 | 8: the 6 unchanged, 2 on custom settings |
| wire fixtures | none | a snapshot frame, a welcome, a `ro`, an input, every event code, a lobby row and view |
| `npm test` | none | Vitest, 1 test |
| build id | `1bf0a82f70aa` | `1bf0a82f70aa` |

Departures, each in its step's entry: the Classic `browser-match.mjs` selector
fix (0.1); the rough link measured at the room's steps, bounded at 90, its
crossing shots printed only (0.2, the owner's decisions); the custom pins on
Linux in Podman instead of CI (0.3); one unexplained `Error: refused` in
`server.check`, not seen again in 8 runs (0.4); screenshots by a script in
headless Chromium, the Chrome extension not connected (0.6); the race fix in
`server.check` (0.7).

## Stage 1 — Structure

### 1.1 The formatter (2026-10-08)

**Commit 1, the config.** `prettier` 3.9.9 and `prettier-plugin-tailwindcss`
0.8.1 as dev dependencies (`npm ls` shows nothing else new; the
`@scarf/scarf` install-script warning is `@heroiclabs/nakama-js`'s, as
before). `.prettierrc`: `semi: false`, `singleQuote: true`, `trailingComma:
'all'`, `arrowParens: 'always'`, `printWidth: 160`, the Tailwind plugin with
`tailwindStylesheet: './src/index.css'` (Tailwind 4 reads the theme from the
stylesheet). `.prettierignore`: `dist`, `dist-server`, `public`. Scripts
`format` and `format:check` (`src server "*.ts"`); CI's game job runs
`format:check` after lint. Game `AGENTS.md`: the commands; the "no formatter
is configured" line goes.

printWidth, tried on scratch copies of `src/`, `server/` and the root `.ts`
files (606 lines over 160 before):

| printWidth | Files changed | Lines added / removed | Lines over 160 after |
|---|---|---|---|
| 120 | 119 | 8,359 / 1,510 | 126 |
| 140 | 109 | 5,565 / 1,010 | 132 |
| 160 | 96 | 3,895 / 716 | 137 |

Every width breaks the long lines it can; what stays over 160 is string
literals Prettier doesn't split (class names, patch notes, check labels).
160 changes the fewest lines. `src/index.css` and `server/digests.json` come
out unchanged.

Gate A (format:check counts from the formatting commit: here it reports the
96 files): `npx oxlint` 0 warnings, 0 errors; `npx tsc -b` clean; `npm run
build` clean (`App-ByD8W0lu.js`, 3,989.97 kB as before: the chunk's name
moves with the build id); `npm test` 1 passed; `npm run check` all pass in
290.98 s, the 8 pins as before. Build id `039956f2d35a` (the lockfile is in
it).

**Commit 2, one formatting pass** (`4a2a349`): `npm run format`, 96 files,
3,895 lines added and 716 removed, as on the scratch copy; `npm run
format:check` `All matched files use Prettier code style!`. Gate A: `npx
oxlint` 0 warnings, 0 errors; `npx tsc -b` clean; `npm run build` clean
(`App-ClaJBG7Y.js` 3,989.97 kB, `index-DOZloYBB.js` 222.59 kB: the same
sizes); `npm test` 1 passed; `npm run check` all pass in 293.37 s with every
pin, both digests and every fixture as before. Build id `d59ea36d1ee2`.

**Then** `.git-blame-ignore-revs` at the repo root names `4a2a349`; `git blame
--ignore-revs-file .git-blame-ignore-revs` on a reformatted line shows the
commit before the pass. (GitHub reads the file by itself; locally, `git config
blame.ignoreRevsFile .git-blame-ignore-revs`.)

### 1.2 One import convention (2026-10-08)

The move tool (scratchpad, not committed: it resolves each relative
specifier against the tree, then writes the path with the file's extension;
an empty move map) over `src/` and `server/`: `440 specifiers rewritten in
75 files` (433 at `3b0943d`, plus stage 0's new imports in `arena.check.ts`),
0 left without one. `npm run format` changed nothing more: 75 files, 440 lines
in place. `vite.server.config.ts`'s comment keeps `import.meta.env` and
`__BUILD__` as the reasons for Vite; game `AGENTS.md`: "Every relative import
names its file".

Gate A: `npx oxlint` 0 warnings, 0 errors; `npm run format:check` clean; `npx
tsc -b` clean; `npm run build` clean (`App-fIDQM2po.js` 3,989.97 kB); `npm
test` 1 passed; `npm run check` all pass in 292.56 s, every pin as before.
Build id `a6397a0465d1`.

### 1.3 Unused code (2026-10-08)

**The legacy generators.** `git grep` for `VehicleGenerator`,
`ArenaGenerator` and `proceduralTexture` outside the plans and history:
only `VehicleGenerator.ts` importing `proceduralTexture.ts`, and game
`AGENTS.md`'s sentence keeping them. All three deleted (317 lines after the
formatting pass; 325 before it), and the sentence. The rule to keep today's
procedural Razor and arenas when a glTF asset replaces them stays. Gate A:
oxlint 0/0; format clean; tsc clean; build clean; test 1 passed; check all
pass in 296.07 s, every pin as before. Build id `05b197cdda5b`.

**`public/icons.svg`.** `git grep -F icons.svg` in `game/`, `www/` and
`scripts/`: nothing; its log: only `a4d7927`, the first commit. Deleted. The
other public files are each named somewhere (`favicon.png` 1, `menu.jpg` 1,
`loading.jpg` 2, `city.jpg` 2, `scrapyard.jpg` 2). Gate A: oxlint 0/0; format
clean; tsc clean; build clean (`App-RsUDT60T.js`, the same: public files
aren't in the build id); test 1 passed; check all pass in 290.30 s, every pin
as before.

**Exported types nobody reads.** A scratch sweep (it resolves every relative
import in `src/`, `server/` and the root `.ts` files, then lists each export
no other file imports and its own file never names again) found nine
`export type X = ReturnType<typeof createX>` aliases: the plan's seven
(`Tactics`, `NetClient`, `Prediction`, `SnapshotBuffer`, `FairPlay`,
`Matchmaker`, `Rewind`) and two more, `server/custom.ts`'s `Lobbies` and
`server/lobby.ts`'s `Lobby` (so step 10's rename has no `Lobby` type left to
rename in `lobby.ts`). `git grep -w` agrees: each name appears only on its own
line (`Lobbies` and `Lobby` elsewhere are the screens' components, other
modules). All nine deleted. Gate A: oxlint 0/0; format clean; tsc clean;
build clean; test 1 passed; check all pass in 289.64 s, every pin as before.
Build id `e7967f72c9da`.

**The sweep, once more, after those three commits:**

- Files no other file imports (entries, checks and tests aside): none.
- Exports no file reads, their own included: none. Another 87 exports are
  read only inside their own file (option types, `NOTES`, `DRIVING`,
  `originAllowed`...). They aren't dead: stage 11 un-exports them once names
  have settled.
- Dependencies: every one is read. `@dimforge/rapier3d-compat` 19 files,
  `@heroiclabs/nakama-js` 2, `react` 21, `react-dom` 3, `three` 52, `ws` 2,
  `@tailwindcss/vite` and `@vitejs/plugin-react` in `vite.config.ts`,
  `tailwindcss` in `src/index.css`, `prettier-plugin-tailwindcss` in
  `.prettierrc`, `vitest` in `rng.test.ts` and `vitest.config.ts`, `oxlint`,
  `prettier`, `typescript` and `vite` by the scripts, the `@types/*` for
  `node`, `react`, `react-dom`, `three` and `ws`.
- `public/`: every file named (above).

Nothing more to remove. No code changed after the last gate A.

### 1.4 `shared/`, `render/` (2026-10-08)

The move tool with the map: `rng.ts` (and `rng.test.ts`) → `src/shared/`;
`renderer.ts`, `environment.ts`, `postprocessing.ts`, `geometry.ts` →
`src/render/`; the 7 files of `materials/` → `src/render/materials/`. `13
files to move`, `51 specifiers rewritten in 28 files`; `npm run format`
changed nothing more; git sees each as a rename. Nothing else names these
paths but the living docs, which step 11 rewrites once for every move
(`arch/GAME_LOOP.md`); `FFA_IMPLEMENTATION_PLAN.md` is history. Gate A:
oxlint 0/0; format clean; tsc clean; build clean; test 1 passed (now
`src/shared/rng.test.ts`); check all pass in 289.76 s, every pin as before.
Build id `674e3879c287`.

### 1.5 `content/` (2026-10-08)

`vehicle/vehicles.ts` → `src/content/vehicles/vehicles.ts`;
`vehicle/vehicle.ts` → `src/content/vehicles/models.ts` (it holds `MODELS`);
`vehicle/parts.ts` → `src/content/parts.ts`; `arena/{arena,digest,scrapyard,
city}.ts` → `src/content/arenas/`; `arena/{props,ground,buildings,street}.ts`
→ `src/content/arenas/kit/`; `maps.ts` → `src/content/arenas/maps.ts`. `12
files to move`, `95 specifiers rewritten in 53 files`; format changed
nothing more. `scripts/arena-parity.mjs` imports `maps.ts` and `digest.ts` by
path: both fixed in this commit. Gate A: oxlint 0/0; format clean; tsc clean;
build clean; test 1 passed; check all pass in 289.97 s, every pin and both
digests as before. Build id `8b1dae8eed6e`.

### 1.6 `sim/` (2026-10-08)

`simulation.ts`, `combat.ts`, `physics.ts`, `scoring.ts`, `loadout.ts`,
`ai.ts` and the checks `simulation`, `ai`, `bots` → `src/sim/`;
`vehicle/drive.ts` → `src/sim/drive.ts`; `mode.ts` → `src/sim/matchMode.ts`
(the contract; `modes.ts` stays the registry). `11 files to move`, `120
specifiers rewritten in 58 files`; format changed nothing more. Fixed in the
same commit: the `check` script's three paths, `arena-parity.mjs`'s
`physics.ts`, and both balance probes' `ai.ts` and `combat.ts` imports
(`/src/sim/...`). Gate A: oxlint 0/0; format clean; tsc clean; build clean;
test 1 passed; check all pass in 289.70 s (`router ok` among them), every pin
as before. Build id `91a6f2b7b0c5`.

### 1.7 `modes/` (2026-10-08)

`modes.ts`, `matchSettings.ts`, `roster.ts` → `src/modes/`; `items/*`,
`ffa/*`, `tdm/*` → `src/modes/items/`, `src/modes/ffa/`, `src/modes/tdm/`.
`18 files to move`, `53 specifiers rewritten in 27 files`; format changed
nothing more. Fixed in the same commit: the `check` script's `ffa.check` and
`tdm.check` paths, and the probes' `config.ts` imports (`/src/modes/...`).
Gate A: oxlint 0/0; format clean; tsc clean; build clean; test 1 passed;
check all pass in 289.49 s, every pin as before. Build id `0df22dcfc519`.

### 1.8 `view/` (2026-10-08)

`view.ts`, `feed.ts`, `pilot.ts`, `input.ts`, `camera.ts`, `effects.ts`,
`audio.ts`, `sounds.ts`, `settings.ts`, `turntable.ts` → `src/view/`. `10
files to move`, `17 specifiers rewritten in 11 files`; format changed nothing
more; no script or probe names them. Gate A: oxlint 0/0; format clean; tsc
clean; build clean; test 1 passed; check all pass in 289.96 s, every pin as
before. Build id `bf3131d7e6d1`.

### 1.9 `runtime/` (2026-10-08)

`runtime.ts`, `match.ts`, `online.ts`, `loading.ts`, `loading.check.ts` →
`src/runtime/`. `5 files to move`, `9 specifiers rewritten in 7 files`;
format changed nothing more; the `check` script's `loading.check` path fixed.
`src/game/` held nothing tracked any more (`git ls-files src/game`: 0; a stray
`.DS_Store`), so the folder is gone. Gate A: oxlint 0/0; format clean; tsc
clean; build clean; test 1 passed; check all pass in 289.76 s, every pin as
before. Build id `19e4a6c31a03`.

### 1.10 Names that mislead (2026-10-08)

Moves (the tool, `46 specifiers rewritten in 15 files`, 9 files):
`server/lobby.ts` → `server/seating.ts`; `server/custom.ts` →
`server/lobbies.ts`; `server/custom.check.ts` → `server/lobbies.check.ts`;
`src/net/custom.ts` → `src/net/lobbies.ts`; `src/screens/search.ts` →
`src/screens/hooks.ts`; `src/screens/{Custom,Lobbies,Lobby,LobbyForm}.tsx` →
`src/screens/lobbies/`. Identifiers: `createLobby` → `createSeating`,
`LobbyOptions` → `SeatingOptions`; the game server's `lobby` property →
`seating` (13 uses in `server.ts`; 17 in `server.check`, 4 in `netplay.check`,
3 in `client.check`). `seating.ts`'s `Lobby` type went in 1.3, so
`server/lobbies.ts`'s `Lobby` is the only one left. Unchanged on purpose: the
custom lobby's id (`r.lobby`), the `lobby` field of the `joined` log line, the
strike reason `bad lobby message`, `/health`'s `lobbies`, the check's own
`custom ok` label. The `check` script follows `lobbies.check.ts`. The code's
comments that name the old files wait for step 11, with the docs.

Gate A: oxlint 0/0; format clean; tsc clean; build clean; test 1 passed;
check all pass in 290.13 s, every pin as before. Build id `2f49def4271c`.

### 1.11 Docs (2026-10-08)

- Game `AGENTS.md`: the code map rewritten for the new tree, a block of one
  entry per folder (`shared/` to `hud/`, then `server/`) and eight bullets
  for the rules a newcomer needs; 13,757 characters before, 6,917 after
  (1,983 words → 908). The Checks list, the procedural-generation line, the
  networking model and the file-name example name the new paths.
- Root `AGENTS.md`: the repo layout gains `game/src`'s layer folders.
- `.claude/work/arch/`: `ARCHITECTURE.md` (its diagram redrawn),
  `GAME_LOOP.md`, `LOADING_ARCHITECTURE.md` (its diagram too),
  `MODULE_BOUNDARIES.md` (its layer diagram redrawn; the import-extension
  rule now says every relative import names its file) and
  `STATE_OWNERSHIP.md` name the new paths (147 lines changed). A bare
  `mode.ts` stays where it means each mode's adapter. `REFACTOR_AUDIT.md`
  and `REFACTOR_REPORT.md` are history, as are the logs and finished plans;
  `LOADING_ARCHITECTURE.md`'s old verification record keeps its paths.
  `.claude/work/net/NET_ARCHITECTURE.md` names files only by bare names that
  didn't change (`simulation.ts`, `match.ts`, `online.ts`, `drive.ts`);
  `NET_RUNBOOK.md` names none.
- **Departure:** 39 code comments in 33 files that named an old path or a
  renamed file (each check's `Run: node src/game/...` line, `(server/custom.ts)`,
  `(lobby.ts)`, `../mode.ts`, `vehicle.ts draws them`...) now name the new
  ones. Comments only: no code line changed (`git diff` on `src/` and
  `server/` holds nothing but comment lines), and Prettier changed nothing.

Gate A: oxlint 0/0; format clean; tsc clean; build clean; test 1 passed;
check all pass in 289.60 s, every pin as before. Build id `151d5ff8fc29`.

### Stage 1 — end gates (2026-10-09)

**B** (screens: the Chrome extension still isn't connected, so the scripted
capture stands in for the smoke list's screens):
- `shots/capture.mjs stage1` against `:3000` (it serves the moved tree: no
  restart needed), local Nakama, `npm run server`: all 14 shots, no page or
  console error, 194.5 s. Against `baseline/`, by pixels differing by more than
  40: `menu` identical; `board-ffa`, `lobby-form-advanced` and the FFA
  results 0.0 %; the rest 0.0–0.9 % (bots placed differently, the turntable's
  angle, guest names, bots' damage in the standings), except `death-board`
  3.2 % (another moment of the wreck). Layouts the same; looked at
  `death-board` and `results-tdm-win` side by side.
- `node scripts/browser-match.mjs`: `browser match ok` at 102.5 s; a's car
  drove 21.3 m on b's screen; a left, its seat a bot's again.
- `node scripts/browser-match.mjs custom`: every check ok at 86.7 s (the lobby,
  the list, the code, two matches, back to the waiting room, a reload, the
  invite link).

**C:**
- `node scripts/arena-parity.mjs`: `ok scrapyard 227c4ce7 (expected
  227c4ce7)`, `ok city 8913ad26 (expected 8913ad26)`.
- Balance probe, team deathmatch "even" on The City, 10 matches
  (`.claude/work/tdm/tdm-metrics.js` through a temporary copy in
  `game/public`, headless): 124.7 kills a match (winner 67.2, loser 57.5),
  no overtime, blue 1 win and red 9, the player 12.4 kills / 16.7 deaths;
  respawn `waitMismatches 0`, `alternationErrors 0`; kills a minute by phase
  15.6, 13.1, 11.1, 9.2. This is the reference for later stages' probe runs
  (the balance reports' numbers predate `3b0943d`'s six-a-side bases).
- **Departures:** both probes had gone stale with `3b0943d`, before the
  refactor. `tdm-metrics.js`'s `analyze` read the respawn table's old `before`
  field: fixed to read the phases as shares of the clock (one line, in this
  commit). `ffa-metrics.js` reads `ffa.items` and `contender.effects`, which
  now live in the pickup supply (`rules.supply`): its run threw `ffa.items is
  not iterable` on every frame. It needs a port to the supply, left for the
  first stage that needs an FFA probe run.

**D:** this entry, and one per step above.

## Stage 1 — done (2026-10-09)

`src/game/` is gone; no relative import lacks its extension (440 fixed);
one `Lobby` type (`server/lobbies.ts`); the code map describes the new tree
(half its length); the dev server serves it. `git log --follow
src/sim/simulation.ts` reaches the first commit. Every pin, digest and
fixture as at baseline; `PROTOCOL` 6. Build id `151d5ff8fc29` (it moves with
every source change, as expected).

## Stage 2 — Boundaries

### 2.1 Import bans by folder (2026-10-09)

oxlint 1.85, tried on scratch files first: `no-restricted-imports` with
`patterns` (gitignore globs on the specifier, negation with `!` works,
`allowTypeImports` per pattern works), `no-restricted-properties`,
`no-restricted-globals`, `import/extensions`, `import/no-cycle`; the
messages print as `help:`. A file matched by two overrides takes the later
one's options whole (they don't merge), so each file gets one complete list.

**Lint with every ban and no allowance** (step 4's first run), 12 findings:

| Finding | What |
|---|---|
| `content/vehicles/vehicles.ts` → `sim/drive.ts` | allowance (types `Handling`, `Chassis`), stage 4 |
| `content/vehicles/models.ts` → `sim/combat.ts` | allowance (weapon type), stage 4 |
| `content/arenas/maps.ts` → `modes/modes.ts` | allowance (type `Mode`), stage 3 |
| `sim/matchMode.ts` → `modes/items/supply.ts` | allowance (type `Supply`), stage 3 |
| `sim/loadout.ts` reads `localStorage` (2) | allowance, stage 4 |
| `modes/modes.ts` → `items/pickups.ts`, `ffa/zone.ts` (2) | allowance (scenery), stage 7 |
| `modes/ffa/mode.ts` → `items/pickups.ts`, `zone.ts` (types `Pickups`, `HotZone`) | not in the plan's table: the adapters' side of the same scenery hand-in; allowance, stage 7 (which takes scenery out of the contract) |
| `modes/tdm/mode.ts` → `items/pickups.ts` (type `Pickups`) | same, stage 7 |
| `render/postprocessing.ts` → `view/settings.ts` (type `Quality`) | a real leak: fixed first, below |

No cycle (values), no relative import without its extension.

**The leak, fixed in its own commit:** `QUALITIES` and `Quality` move from
`view/settings.ts` to `render/postprocessing.ts`, beside `QUALITY`, the
presets they name; `view/settings.ts` and `screens/SettingsPanel.tsx` import
them from there. No re-export. Gate A: oxlint 0/0; format clean; tsc clean;
build clean; test 1 passed; check all pass in 290.53 s, every pin as before.
Build id `17cf9fc55ff9`. (It touches a screen's imports only; gate B runs at
the stage's end.)

**Then the bans** (`.oxlintrc.json`, JSONC: a comment over each override):
one override per row of the levels table, each banning the levels above it
by specifier glob, a folder ban covering the files under it (`**/net/**` for
the levels below net/, the level-4 net files by name above it, by basename
inside net/ itself); `sim/`, the modes' domain and `shared/` also ban
`react`, `react-dom`, `three/examples/**` and `**/render/**`; the screens and
the HUD ban Rapier and `sim/physics.ts`, and `sim/simulation.ts` for values
(`allowTypeImports`); `server/**` (not `browser.ts`) bans levels 4-6, React
and nakama-js. Checks and tests are excluded everywhere: they play across
the layers on purpose. The allowances follow as their own overrides (each
the file's list with a `!` for the one import), each comment naming the
stage that removes it: stage 3 (`maps.ts`, `matchMode.ts`), stage 4
(`vehicles.ts`, `models.ts`), stage 7 (`modes.ts`, `ffa/mode.ts`,
`tdm/mode.ts`). 588 lines. Gate A: `npx oxlint` `Found 0 warnings and 0
errors.` (119 rules); format clean; tsc clean; build clean; test 1 passed;
check all pass in 290.12 s, every pin as before. Build id `17cf9fc55ff9`
(the config isn't in it).

### 2.2 Purity (2026-10-09)

On `src/sim/**`, `src/shared/**` and the modes' domain (not their `.tsx`,
`views.ts`, `scenery.ts`, `pickups.ts`, `zone.ts`; not checks or tests):
`no-restricted-properties` for `Math.random`, `Date.now`, `performance.now`;
`no-restricted-globals` for `window`, `document`, `localStorage`,
`sessionStorage`. With no allowance, lint found only `sim/loadout.ts`'s two
`localStorage` uses: the plan's allowance (until stage 4), now an override
that keeps every other ban. Gate A: oxlint 0/0 (121 rules); format clean; tsc
clean; build clean; test 1 passed; check all pass in 289.72 s, every pin as
before.

### 2.3 Conventions (2026-10-09)

`import/no-cycle` with `ignoreTypes: true` (stage 3 turns types on) and
`import/extensions` `always` for relative imports (`ignorePackages`): 0
findings on the code. Confirmed it does what's needed: `./rng` without
`.ts` in a scratch edit fails with `import(extensions): Missing file
extension in import declaration.` (reverted). Gate A: oxlint 0/0 (123 rules);
format clean; tsc clean; build clean; test 1 passed; check all pass in
291.02 s, every pin as before.

### 2.4 Allowances (2026-10-09)

Folded into 2.1 and 2.2: lint has to be green at every commit, so each
override landed with the allowances its own rules needed, after the run
with none (2.1's table). Each is an override of its own whose comment names
the stage that removes it.

### 2.5 Every check runs (2026-10-09)

`game/repo.test.ts` (Vitest; `tsconfig.node.json` includes it): every
`*.check.ts` under `src/`, `server/` and the game's root must be a `node
<path>` step of the `check` script, or in `vite.server.config.ts`'s ENTRIES
and run as `dist-server/<name>.js` by `server:check`. One test per check
(15) plus one that it found any. oxlint's `vitest` plugin is on for
`*.test.ts`/`*.test.tsx` (an `it.only` in a scratch edit: `vitest(no-focused-
tests): Unexpected focused test.`, reverted). Negative test: `server/fairplay.
check.ts` dropped from the `check` script fails with `server/fairplay.check.ts:
not in the check script, nor bundled (vite.server.config.ts ENTRIES) and run
by server:check` (reverted). Gate A: oxlint 0/0; format clean; tsc clean;
build clean; `npm test` 17 passed (2 files); check all pass in 289.92 s,
every pin as before.

### 2.6 Invariant (2026-10-09)

`src/net/protocol.check.ts` asserts `RATE.step * PHYSICS_STEP === 1` (a tick
on the wire is one fixed step): `protocol ok (96 checks)`. Gate A: oxlint 0/0;
format clean; tsc clean; build clean; test 17 passed; check all pass, every
pin as before.

### 2.7 Docs (2026-10-09)

`.claude/work/arch/MODULE_BOUNDARIES.md` rewritten: `.oxlintrc.json` is the
source of truth; the levels table (today's files), what purity, the UI and the
server may not do, the exemptions, allowances and `repo.test.ts`, in prose
with no pattern restated; the rules of thumb kept. The old modules table,
which restated the bans, goes (ownership is in game `AGENTS.md`'s code map).
Game `AGENTS.md`'s engineering principles gain a fifth: lint holds the
layers. No code changed after 2.6's gate A.

### Stage 2 — verify and end gates (2026-10-09)

Each of these made lint (or `repo.test.ts`) fail with a clear message, then
was reverted:

| Break | Output |
|---|---|
| `view/audio.ts` imported into `sim/simulation.ts` | `no-restricted-imports: '../view/audio.ts' import is restricted ... help: sim/ is level 2 and pure: no modes, view, net, runtime, React or rendering` |
| `Math.random()` in `modes/tdm/rules.ts` | `no-restricted-properties: 'Math.random' is restricted ... help: gameplay randomness comes from the match seed (shared/rng.ts)` |
| `window` in `sim/` | `no-restricted-globals: Unexpected use of 'window'. gameplay code runs headless: no DOM, no storage` |
| `react` in `sim/` | `no-restricted-imports: 'react' import is restricted ... help: sim/ is level 2 and pure ...` |
| an extensionless import | `import(extensions): Missing file extension in import declaration.` (2.3) |
| a check dropped from `package.json` | `repo.test.ts`: `server/fairplay.check.ts: not in the check script, nor bundled ...` (2.5) |

**B** (2.1's leak fix touched `view/settings.ts` and a screen's imports): the
settings drawer, headless against `:3000`, lists `low, medium, high` on its
Graphics tab and saves `medium` when picked, no page or console error;
`browser-match.mjs` ok at 104.0 s (a's car 19.4 m on b's screen), `custom` ok
at 86.9 s. **C** not needed: no arena, physics, `sim/` or mode code changed.
**D:** these entries.

## Stage 2 — done (2026-10-09)

`npm run lint` holds the levels with nine named allowances (stages 3, 4, 7),
purity, no value cycle and named files; `repo.test.ts` runs in `npm test` (17
tests); CI runs lint, so a layer break fails CI. One real leak fixed
(`Quality` into `render/`). Every pin, digest and fixture as before;
`PROTOCOL` 6.

## Stage 3 — Leaf types and duplicates

### 3.1 Mode ids (2026-10-09)

`src/modes/ids.ts` imports nothing: `MODE_IDS = ['tdm', 'ffa'] as const`,
`type Mode`. `modes/modes.ts` declares `MODES … satisfies Record<Mode,
ModeEntry>` (label, tags, blurb, lineUp, create → `MatchMode`), key order
kept. 18 files' `type Mode` imports moved to `ids.ts`. The arena screen
(`MapSelect.tsx`) used a local `MODE_IDS = Object.keys(MODES)` and the lobby
list `Object.keys(MODES)`: both import `MODE_IDS` now, one name for one thing.
Lint: `!**/modes/ids.ts` in every ban that covers `**/modes/**`; the
allowance `content/arenas/maps.ts` → `modes/modes.ts` is gone (7 left). Test
`src/modes/ids.test.ts`: `Object.keys(MODES)` equals `MODE_IDS`, in order.
Gate A: oxlint 0/0; format clean; tsc clean; build clean; `npm test` 18
passed; check all pass in 290.00 s, every pin as before. Build id
`af727ffb8ebe`.

### 3.2 Difficulty (2026-10-09)

`Skill`, `DIFFICULTIES` and `Difficulty` moved out of `sim/ai.ts` into
`src/sim/difficulty.ts`, which imports nothing: the same text, values and key
order (`easy`, `normal`, `hard`). 14 importers re-pointed (`sim/ai.ts`,
`sim/simulation.ts`, `modes/matchSettings.ts`, `modes/roster.ts`,
`net/protocol.ts`, `runtime/match.ts`, `runtime/runtime.ts`, three screens,
`server/room.ts`, `server/lobbies.ts`, and the checks `bots.check.ts`,
`arena.check.ts`, `server.check.ts`). The wire's imports no longer name
`sim/ai.ts` (it still reaches `simulation.ts` for the `Combatant` type, and
Rapier through `combat.ts` until stage 4). `game/AGENTS.md`'s code map and
one comment in `simulation.ts` name `difficulty.ts`.
Gate A: oxlint 0/0; format clean; tsc clean; build clean; `npm test` 18
passed; check all pass in 289.64 s (bots 7.8/13.8/17.8; Classic's four and
the two custom pins as before; digests `227c4ce7`/`8913ad26`). Build id
`e95d398d093c`.

### 3.3 `shared/math.ts` (2026-10-09)

`src/shared/math.ts`: `wrap` (an angle into -π..π), `Point {x, z}` and
`distance` (on the ground, height aside), each the text of the copies it
replaces, so the float operations are the same.

- `wrap`: 5 copies to 1 (`hud/Hud.tsx`, `sim/ai.ts`, `view/camera.ts`,
  `view/pilot.ts`, `view/view.ts` import it).
- `Point {x, z}`: 3 to 1 (`sim/matchMode.ts`, `modes/items/items.ts`,
  `modes/tdm/types.ts`); its importers (`simulation.ts`, `supply.ts`,
  `ffa/rules.ts`, `tdm/rules.ts`, `tactics.ts`, two checks) import it from
  `shared/math.ts`.
- `server/fairplay.ts`'s 3-D `Point {x, y, z}` is now `Vector` (with
  `fairplay.check.ts` and `room.ts`): it holds the aim's directions as well as
  places, so `Spot` read wrong for the headings, and `Vec3` is already
  `render/geometry.ts`'s tuple.
- Departure: `distance(a, b) = Math.hypot(a.x - b.x, a.z - b.z)` had 4 copies
  (`items/items.ts` exported, `tdm/rules.ts` exported and used only there,
  `tdm/tactics.ts`, and `sim/ai.ts`'s `flat` on two `Vector3`s), not counted at
  stage 0. Now 1: `ai.ts` imports it as `flat`, since `distance` is a local
  name five times there.

Counted after: `Math.atan2(Math.sin(angle), Math.cos(angle))` 1,
`interface Point` 1, `Math.hypot(a.x - b.x, a.z - b.z)` 1 (all in
`shared/math.ts`). `game/AGENTS.md`'s code map lists `math.ts`.
Gate A: oxlint 0/0; format clean; tsc clean; build clean; `npm test` 18
passed; check all pass in 289.57 s (bots 7.8/13.8/17.8; Classic's four and
the two custom pins as before; digests `227c4ce7`/`8913ad26`). Build id
`164eae941a90`.

### 3.4 `shared/time.ts` (2026-10-09)

`clock` (125 s → `'02:05'`) and `ms` (match-clock times on the wire, whole
milliseconds) moved, text and comments as they were, from the end of
`sim/matchMode.ts` to `src/shared/time.ts`. Importers: `hud/Hud.tsx`,
`modes/ffa/mode.ts`, `modes/tdm/mode.ts`, `modes/items/supply.ts`; each now
imports only types from `matchMode.ts`, so `supply.ts` → `matchMode.ts` is no
longer a value edge. `game/AGENTS.md`'s code map lists `time.ts`.
(`screens/hooks.ts`'s `waited`, `m:ss` from milliseconds for the search
timer, is another format, not a copy: left.)
Gate A: oxlint 0/0; format clean; tsc clean; build clean; `npm test` 18
passed; check all pass in 291.54 s (bots 7.8/13.8/17.8; Classic's four and
the two custom pins as before; digests `227c4ce7`/`8913ad26`). Build id
`b086f815b095`.

### 3.5 `SupplyView` (2026-10-09)

Read the three: the HUD reads a mode's `supply.items` (handed to the
minimap, which reads each item's `x`, `z` and `type`) and
`supply.effects[machine][kind]`; the view reads nothing of it (the pickups'
own 3-D view gets `rules.supply` from its adapter). So `sim/matchMode.ts`
declares

    export interface SupplyView {
      readonly items: ReadonlyArray<Point & { readonly type: string }>
      readonly effects: ReadonlyArray<Readonly<Record<string, number>>>
    }

and `MatchMode.supply?: SupplyView`, importing nothing from `modes/`. The
HUD keeps the exact types: its `match.mode` is the adapters' union
(`ReturnType<(typeof MODES)[Mode]['create']>`), not `MatchMode`. `Supply`
satisfies the view structurally: `tsc -b` proves it through `MODES …
satisfies` and the adapters' `satisfies MatchMode` (tried: with `type:
number` in the view, `tsc` fails in `ffa/mode.ts` and `modes.ts`). The
allowance `sim/matchMode.ts` → `modes/items/supply.ts` is gone (6 left, none
for stage 3), and an import of `supply.ts` there now fails lint
(`no-restricted-imports`, tried). The generator (scratch `lintconfig.py`)
reproduces `.oxlintrc.json` byte for byte. The contract's header no longer
says it holds the clock formats (moved in 3.4). `game/AGENTS.md`'s code map
names `SupplyView`.
Gate A: oxlint 0/0; format clean; tsc clean; build clean; `npm test` 18
passed; check all pass in 289.21 s (bots 7.8/13.8/17.8; Classic's four and
the two custom pins as before; digests `227c4ce7`/`8913ad26`). Build id
`373620880bd1`.

### 3.6 One `Seat` (2026-10-09)

`net/protocol.ts`'s `Seat` (a welcome's line-up entry: name, team, vehicle,
weapon, human, uid, present) is `SeatInfo`; it was named only in that file
(the interface and `Welcome.lineUp`). `sim/matchMode.ts` keeps `Seat` (team
and start). Types only: the wire's bytes can't move (the protocol check's
fixtures hold).
Gate A: oxlint 0/0; format clean; tsc clean; build clean; `npm test` 18
passed; check all pass in 290.53 s (protocol 96 checks; bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `7b031e7f1741`.

### 3.7 The arena cache (2026-10-09)

`loadArena` and its `built` map, the session cache, moved from
`content/arenas/maps.ts` to `runtime/runtime.ts`, its only caller (twice:
practice and online loading), text unchanged and no longer exported.
`maps.ts` keeps `MAPS`, `MapId`, `MapInfo` and `mapsFor`. Docs:
`game/AGENTS.md`'s code map (maps.ts, runtime.ts) and two rows of
`LOADING_ARCHITECTURE.md` (lazy resources, ownership) name `runtime/runtime.ts`.
(`arch/REFACTOR_REPORT.md` is the old refactor's record: left.)
Gate A: oxlint 0/0; format clean; tsc clean; build clean; `npm test` 18
passed; check all pass in 290.33 s (arena 80 checks; bots 7.8/13.8/17.8;
Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `21a3eed58e37`.

### 3.8 Cycles counted with types (2026-10-09)

`import/no-cycle` is `ignoreTypes: false` in `.oxlintrc.json` (and in the
scratch generator, which still reproduces the file byte for byte). It
reports 0. Counted with the stage-0 method (a throwaway config, plugins
`import` and `typescript`, only `no-cycle`, `ignoreTypes: false`) on each
commit, through a scratch worktree:

| Commit | Reports |
|---|---|
| `3b0943d` (main, the baseline) | 43 |
| `a86a722` (stage 2 done) | 43 |
| `1e78060` (3.1 mode ids) | 2 |
| `2cf87e5` (3.2), `29c4b7b` (3.3), `33321a9` (3.4) | 2 |
| `8d27448` (3.5 `SupplyView`) | 0 |

No edge needed cutting in its own commit. A type-only cycle now fails lint
(tried: `import type { Brain } from './ai.ts'` in `sim/difficulty.ts`, two
`import(no-cycle)` errors). `MODULE_BOUNDARIES.md`: "No import cycle, types
included".
Gate A: oxlint 0/0; format clean; tsc clean; build clean (the bundle as in
3.7: a config change); `npm test` 18 passed; check all pass in 289.88 s
(bots 7.8/13.8/17.8; Classic's four and the two custom pins as before;
digests `227c4ce7`/`8913ad26`). Build id `21a3eed58e37` (as 3.7: no source
change).

### 3.9 Tests (2026-10-09)

Vitest, beside their subjects, 17 tests in 3 files:
- `src/shared/math.test.ts`: `wrap` keeps 0 and brings ±π and 3π into
  -π..π; one angle as each of the five old copies' callers hands it over
  (the turret, the chase camera, the bot's steering error, the lock-on
  window, the hit marker), the short way round; `distance` on the ground,
  height aside (3-4-5 between two points at different heights).
- `src/shared/time.test.ts`: `clock` at 0, 59.9, 60 and 600 s (`00:00`,
  `00:59`, `01:00`, `10:00`); `ms` at the same and 1/3 s (0.333).
- `src/sim/difficulty.test.ts`: `Object.keys(DIFFICULTIES)` is `easy`,
  `normal`, `hard`, in that order.
Gate A: oxlint 0/0; format clean; tsc clean; build clean; `npm test` 35
passed (6 files); check all pass in 289.86 s (bots 7.8/13.8/17.8; Classic's
four and the two custom pins as before; digests `227c4ce7`/`8913ad26`).
Build id `21a3eed58e37` (tests aside, as the build id does).

### Stage 3 — end gates (2026-10-09)

**B**, smoke items 1–4 (the Chrome extension still isn't connected, so the
scripted capture stands in; `shots/capture.mjs` gained four shots for the
items the stage touches: `hit-lockon`, `effects-ffa`, `tdm-again`,
`pause-settings`):
- `shots/capture.mjs stage3` with the 11 practice and menu shots plus the 4
  new ones, against `:3000` and the local Nakama: all 15, no page or console
  error, 248.6 s.
  - Against `stage1/`, pixels differing by more than 40: `menu`, both
    garages, `board-tdm`, `hud-ffa`, `results-ffa-crown` 0.0 %; `hud-tdm`,
    `results-tdm-win` 0.2 %; `results-ffa-loss` 0.6 %; `death-board` 3.0 %
    (another moment of the wreck, 3.2 % at stage 1); `board-ffa` 19.6 %: the
    new shots run before it (a rival put in front shot the player to 51,
    effects on, the clock at 09:56): looked at both, the same layout.
  - `hit-lockon` (the `wrap` callers: camera, pilot, HUD): lock-on on a
    rival 24 m ahead, its hit's red arc at the top (hit from the front).
  - `effects-ffa` and `board-ffa`: the four effect chips (Repair, Speed
    Boost, Armor, Damage Boost) count down, read through the supply.
  - `pause-settings`: Paused with the Settings drawer, Medium picked and
    saved (`quality medium` in `scrapyard.settings`); Esc closes the drawer,
    Resume, and the match clock runs on.
  - `tdm-again`: Play again after the victory, a new match at 10:00, 0 : 0.

**C:**
- `node scripts/arena-parity.mjs`: `ok scrapyard 227c4ce7 (expected
  227c4ce7)`, `ok city 8913ad26 (expected 8913ad26)` (the arena cache moved).
- Balance probe, team deathmatch "even" on The City, 10 matches (as at
  stage 1): 129.5 kills a match (winner 69.8, loser 59.7), no overtime, blue
  0 wins and red 10, the player 12.6 kills / 17.7 deaths; respawn
  `waitMismatches 0`, `alternationErrors 0`. Stage 1: 124.7 (67.2/57.5),
  blue 1 and red 9, the player 12.4 / 16.7. Each practice match draws a new
  seed (`runtime/match.ts` `freshSeed`), so two runs differ by their
  matches; the seeded pins are what hold the game the same, and they did.

**D:** this entry, and one per step above.

## Stage 3 — done (2026-10-09)

No import cycle, types included (43 at baseline). One `wrap`, one
`Point {x, z}`, one ground `distance` (`shared/math.ts`), one `Seat`
(the wire's is `SeatInfo`); `clock`/`ms` in `shared/time.ts`; the
difficulties in `sim/difficulty.ts`; the contract names a `SupplyView` and
imports nothing from `modes/`; the arena cache in the runtime. No stage-3
allowance is left (6, for stages 4 and 7). `npm test` 35. Every pin, digest
and fixture as at baseline; `PROTOCOL` 6. Build id `21a3eed58e37`.
Departures: `distance` folded in with `wrap` and `Point` (3.3); fairplay's
3-D type named `Vector`, not `Spot` (3.3).

## Stage 4 — Content as data

### 4.1 Weapon identity (2026-10-09)

`WeaponSpec.id: WeaponId`, its key in `WEAPONS`. `WeaponId` is declared
(`'minigun' | 'rocketPod'`, as `MapId` is): `keyof typeof ROSTER` with an
`id: WeaponId` in the spec is circular (tsc: TS2502, TS7022, TS2456, tried).
The roster `satisfies { [K in WeaponId]: WeaponSpec & { id: K } }`, so a row
whose `id` isn't its key fails to compile (tried: `id: 'rocketPod'` under
`minigun`, TS2322), and so does a missing or an extra row. `weaponId(spec)`
returns `spec.id` (it matched the turret model before, falling back to
`minigun`); its callers (`server/room.ts` 6, `net/client.ts` 1, three
checks) are unchanged. `botGun`'s scaled copy spreads the spec, so it keeps
the id (the protocol check's "a scaled bot gun is named by its registry id"
holds).
Gate A: oxlint 0/0; format clean; tsc clean; build clean; `npm test` 35
passed; check all pass in 291.66 s (protocol 96 checks: the fixtures hold;
bots 7.8/13.8/17.8; Classic's four and the two custom pins as before;
digests `227c4ce7`/`8913ad26`). Build id `9bf94c26a663`.

### 4.2 Weapon data out of the mechanics (2026-10-09)

`src/content/weapons/weapons.ts` (new, imports nothing): `WeaponId`,
`WeaponSpec`, the roster and `WEAPONS`, and `sustainedDps` (the garage's
firepower line, a number of the table's), text moved as it was.
`sim/combat.ts` keeps `WeaponState`, `armWeapon`, `pullTrigger`, `Shot`,
`scatterAim`, `castRound`, with a two-line header in place of the one that
moved. 17 importers split their imports by name (data from `weapons.ts`,
mechanics from `combat.ts`); `content/vehicles/models.ts` now names
`WeaponSpec` from `../weapons/weapons.ts` (its allowance goes in 4.6, as
planned). The probes (`tdm-metrics.js`, `ffa-metrics.js`) take `WEAPONS`
from the new path; `ARCHITECTURE.md`'s "A weapon" and `game/AGENTS.md`'s code
map say where the table is.

The wire's runtime import closure (scratch `closure.mjs`: follows value
imports, skips `import type` and all-type lists), `src/net/protocol.ts`:
- before: 8 files, `src/sim/combat.ts` among them; packages
  `@dimforge/rapier3d-compat`, `three`;
- after: 8 files (`protocol.ts`, `content/weapons/weapons.ts`,
  `modes/matchSettings.ts`, `sim/difficulty.ts`, `modes/ffa/config.ts`,
  `modes/tdm/config.ts`, `sim/scoring.ts`, `content/vehicles/vehicles.ts`);
  no package.

Gate A: oxlint 0/0; format clean; tsc clean; build clean (client 3,990.01 kB,
gzip 1,401.09 kB: +0.36 / +1.78 kB from one module more); `npm test` 35
passed; check all pass in 289.29 s (bots 7.8/13.8/17.8; Classic's four and
the two custom pins as before; digests `227c4ce7`/`8913ad26`). Build id
`a771c19f035f`.

### 4.3 Firing `kind` (2026-10-09)

`WeaponSpec` is `GunSpec | RocketSpec` on `kind: 'gun' | 'rocket'`; only the
rocket kind carries `rocket: { speed, blast }`; `WeaponKind` is
`WeaponSpec['kind']`. `WEAPONS` is exported with its rows' own types (no
widening to `Record<WeaponId, WeaponSpec>`), so `WEAPONS.rocketPod.rocket` is
there without `!`. Removing the optional field made `tsc` list every reader
(25 errors): more than the plan's five places. Each now handles every kind:
- `sim/simulation.ts` `fire`: a switch (`rocket`: `launch(c, spec)`; `gun`:
  hitscan), `default: return spec satisfies never`; `Rocket.spec` is a
  `RocketSpec` (no more `!`).
- `sim/ai.ts`: `TACTICS satisfies Record<WeaponKind, …>`, picked by
  `spec.kind`; the alignment rule is `TACTICS[kind].onLead` (true for the
  rocket); `blastRadius(spec): number` and `flightTime(spec, distance):
  number` are switches whose declared return type makes a missing kind a
  compile error (TS2366).
- `view/view.ts`: `FIRE_CUE: Record<WeaponKind, SoundCue>` and `SPINS:
  Record<WeaponKind, boolean>` (the gun loop: the plan's list missed it).
- `server/recorder.ts` `fired`: a switch (`rocket` journals `ln`; `gun` is
  written when it lands), `satisfies never` (missed by the plan's list).
- `screens/Garage.tsx`: `ROUND: Record<WeaponKind, [one, many]>` and
  `kindSpecs(w): Spec[]` (the rocket rows): the sheet's strings as before
  (missed by the plan's list).
- Checks: four reads of `.rocket` became `.kind === 'rocket'` (bots,
  simulation, server, client checks).

Same calls in the same order: the hitscan path is the old one, guns' lead
time is `1 / aimRate + 0` as before (`distanceTo` now runs for a gun too: a
pure computation), and bots' scaled copies spread the spec, kind and all.

The first gate A failed: `tdm: a teammate inside the blast at the aim: the
rocket holds, the gun fires`. Cause: the check's hand-built agents
(`as unknown as Agent`, so `tsc` couldn't see them) had
`spec: { rocket: { blast: 8 } | undefined }` and no `kind`, so the new
switch gave no blast. Fix in the check only: `{ kind: 'rocket', rocket: {
blast: 8 } }` and `{ kind: 'gun' }`; its assertion unchanged. No pin moved.
`ARCHITECTURE.md`'s "A weapon": a new behaviour is a new `kind`, and where
the compiler will ask for it.
Gate A (rerun): oxlint 0/0; format clean; tsc clean; build clean (3,990.34
kB, gzip 1,401.22 kB); `npm test` 35 passed; check all pass in 290.25 s
(tdm 182, bots 7.8/13.8/17.8; Classic's four and the two custom pins as
before; digests `227c4ce7`/`8913ad26`). Build id `762f34f5bb0e`.

### 4.4 Turret registry, a file per turret (2026-10-09)

`WeaponSpec.model` is `turret: TurretKey` (`'minigun' | 'rocketPod'`,
declared in `weapons.ts`). `buildMinigun` and `buildRocketPod` moved, text
unchanged, from `content/parts.ts` to `content/weapons/turrets/minigun.ts`
and `turrets/rocketPod.ts`; the yoke both sit on (`buildTurret`) stays in
`parts.ts`, now exported, beside the other shared parts (a registry that
also held it would make a cycle with its own builders). New
`content/weapons/turrets.ts`: `TURRETS satisfies Record<TurretKey, () =>
THREE.Group>`. `content/vehicles/models.ts` builds `TURRETS[key]()` where it
had `weapon === 'rocketPod' ? buildRocketPod() : buildMinigun()`;
`VehicleOptions.turret`, the garage's turntable, the view and the HUD's
`data-kind` read `spec.turret` (same strings). The weapon data imports no
builder. `parts.ts` lost its two now-unused imports (`bentTube`, `tube`).
Docs: the code map (`parts.ts`, `weapons/`), `ARCHITECTURE.md`'s "A
weapon" step 2.
Screens (`shots/capture.mjs stage4a`, against `stage3/`): `garage-minigun`
0.0 %, `garage-rocketpod` 0.2 % (the turntable's angle): the pod on the
roof, the sheet's lines as before (38 per rocket, 6 rockets, rocket speed,
blast radius). `menu` 0.0 %.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.35 kB, gzip
1,401.22 kB); `npm test` 35 passed; check all pass in 289.72 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `44d9cec2f118`.

### 4.5 The HUD's weapon icon from data (2026-10-09)

`WeaponSpec.icon`: SVG path data in a 64 × 28 box. Each of `Hud.tsx`'s two
inline SVGs (rects and paths, shown or hidden by `data-kind`) became one
path string: each rect written as a path (the rounded ones with arcs, all
drawn clockwise, so overlaps stay filled under the nonzero rule), the
paths as they were. The panel has one `<path data-hud="weaponIcon">`, its
`d` written from `weapon.spec.icon` when it changes; `data-kind` and its
two `group-data-[kind=rocketPod]` classes are gone. `Hud.tsx` names no
weapon.

Screens, the panel alone over a hidden scene (`shots/capture.mjs`, new shots
`weapon-minigun`, `weapon-rocketpod`: practice with that loadout, the
canvases hidden, the panel's element captured; 129 × 98 px): `stage4a/` at
4.4, `stage4b/` after. Pixels differing by more than 40: 0.1 % each. All
that differ (156 and 130, max 70 and 59 of 255) lie where two shapes meet
(the minigun's body and barrels, body and grip; the pod's box and tubes, box
and foot): drawn apart, their anti-aliased edges left a faint seam; one path
has none. **Departure:** "screenshots must match" holds for every shape,
size and place; those seams are what a single path can't keep. Looked at
side by side at 4×.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.14 kB, gzip
1,401.30 kB); `npm test` 35 passed; check all pass in 289.46 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `871be06acf0b`.

### 4.6 Vehicles: types with vehicles, a file per model (2026-10-09)

- `content/vehicles/types.ts` (new): `Handling` and `Chassis`, moved from
  `sim/drive.ts` (comments with them; `drive.ts` keeps two lines on its
  model and imports the types); `VehicleOptions`, moved from `models.ts`;
  `ModelParts` (new: what a vehicle's builder hands `models.ts`).
- `content/vehicles/models/razor.ts` (new): the Razor's layout constants,
  profiles and its body, text moved as it was; `buildRazor(options)` returns
  `{ shell, turretAt: [0, 1.95, -0.62], wheelWidth: 0.42 }`.
- `content/vehicles/models.ts` keeps `MODELS` and what every model shares,
  `assemble(parts, chassis, turret)`: the body merged and named, the turret on
  its ring, the wheels at the chassis' hubs (the code that ended the old
  builder, in the same order). The builders import nothing from `models.ts`
  (types from `types.ts`), so no cycle, types included.
- Allowances removed: `vehicles.ts` → `sim/drive.ts` and `models.ts` →
  `sim/combat.ts` (4 left: three for stage 7, `loadout.ts`'s for 4.7); the
  generator reproduces the config byte for byte.

The model is the same: a fingerprint (scratch `modelprint.mjs`, in a page
from `:3000`: every node's name, type and world matrix, every geometry
attribute, every material's kind and colour, for both turrets, seed 7) is
`ffb6ac74aa0125b8` (76 nodes) after the change and at `aa72a4c`'s tree
(the change stashed). Docs: the code map (`vehicles/`), `ARCHITECTURE.md`'s
"A vehicle" step 2.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.28 kB, gzip
1,401.33 kB); `npm test` 35 passed; check all pass in 289.80 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `1a3f97061833`.

### 4.7 One loadout parser (2026-10-09)

The two readers, diffed per field before the change:
- `savedLoadout()` (storage): `JSON.parse` of the stored text, `{ vehicle,
  weapon }` destructured, each kept if `Object.hasOwn(REGISTRY, value)`,
  else the default's; a throw (storage blocked, bad JSON, `null`) gives
  `DEFAULT_LOADOUT`.
- `pick()` in `parseClient`'s hello (the wire): a non-object loadout reads as
  `{}`; each field kept if `typeof === 'string'` and `Object.hasOwn`, else
  `'razor'` / `'minigun'` (the default's).
- They agree for valid ids, unknown ids, missing fields, `null`, numbers,
  strings, arrays, and ids off the prototype. One case differs: a non-string
  that converts to a known key (`{"weapon":["rocketPod"]}`): storage kept the
  array itself as the weapon (outside the `Loadout` type), the wire gave the
  default. `saveLoadout` only ever writes strings, so no stored value takes
  that path. **Departure:** the plan says to keep each caller's answer where
  they differ; `parseLoadout` takes the wire's (strings only) for both, since
  storage's answer there broke the type and is unreachable from the game.

`parseLoadout(raw: unknown): Loadout` in `sim/loadout.ts` (the wire's `pick`,
moved there, with `DEFAULT_LOADOUT`'s fields as fallbacks). `parseClient`'s
hello calls it (the wire no longer imports `WEAPONS` or `VEHICLES` values).
`runtime/stored.ts` (new): `savedLoadout()` (`parseLoadout` of the parsed
text, `DEFAULT_LOADOUT` on a throw) and `saveLoadout()`, key
`scrapyard.loadout` unchanged; `App.tsx` imports them from there. The
`sim/loadout.ts` purity allowance is gone (3 left, all stage 7): a
`localStorage` there now fails lint (tried). The wire's runtime closure: 9
files (`sim/loadout.ts` joins), no package. Docs: the code map (`loadout.ts`,
`stored.ts`), `ARCHITECTURE.md`'s "A loadout slot".
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.37 kB, gzip
1,401.35 kB); `npm test` 35 passed; check all pass in 289.83 s (protocol 96;
bots 7.8/13.8/17.8; Classic's four and the two custom pins as before;
digests `227c4ce7`/`8913ad26`). Build id `4c158a5697cd`.

### 4.8 Tests (2026-10-09)

Vitest, beside their subjects, 17 tests in 2 files:
- `src/content/weapons/weapons.test.ts`, per weapon: its `id` is its key in
  `WEAPONS`; its `turret` is a key `TURRETS` builds; a bot's scaled copy
  (`botGun` at Easy) keeps its `id` and `kind`, its damage scaled.
- `src/sim/loadout.test.ts`: `parseLoadout` over an `it.each` table: valid;
  an unknown vehicle; an unknown weapon; `null`; a number; a string; missing
  fields; a weapon alone; ids off the prototype (`toString`,
  `constructor`); ids that aren't strings (arrays); what `saveLoadout`
  keeps today (`JSON.parse` of its text).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.37 kB, gzip
1,401.35 kB); `npm test` 52 passed (8 files); check all pass in 290.34 s
(bots 7.8/13.8/17.8; Classic's four and the two custom pins as before;
digests `227c4ce7`/`8913ad26`). Build id `4c158a5697cd` (tests aside).

### Stage 4 — paused here (2026-10-09, the owner's word)

Steps 4.1–4.8 are committed, each with its gate A green. Not yet done, in
this order, when work resumes:
- **Verify, scratch third gun** (a scratch worktree or branch, never
  committed): in `content/weapons/weapons.ts` alone, a `gun`-kind weapon on
  the `minigun` turret with its own numbers and icon; show it touches only
  that file, and that its own id shows on the wire (a welcome's line-up), in a
  match record (`SeatRecord.weapon`), in a replay (`replay(replayLines(…))`
  gives the same records) and under the lobby's one-gun setting
  (`checkSettings` takes it; `weaponsLabel` says "<name> only"). A bundled
  scratch check (`vite.server.config.ts` ENTRIES, in the scratch tree only)
  following `server.check.ts`'s journal-room block is the planned way.
- **Verify, scratch `kind: 'mine'`**: add it to the `WeaponSpec` union in a
  scratch tree, run `npx tsc -b`, and list every error's place here.
- **Gate B** items 2–4 and 6: `shots/capture.mjs stage4` (garage pair and
  `weapon-minigun`/`weapon-rocketpod` against `stage3/`, `stage4a/`); item 6
  the one-gun setting in the lobby form (needs `npm run server`); a stored
  loadout from before still loads (the `weapon-rocketpod` shot sets one).
- **Gate C:** arena parity (cheap; arenas untouched), one TDM probe run
  (`shots/tools/probe.mjs tdm 10`; the FFA probe still needs its port).
- **Gate D:** the stage-end entry, then stage 5.

The scratch tools this log names (`gateA.sh`, `lintconfig.py`,
`closure.mjs`, `pixdiff.py`, `modelprint.mjs`, `probe.mjs`, `move.mjs`,
`sweep.mjs`, `settings-check.mjs`) are kept, gitignored, in
`.claude/work/refactor/shots/tools/`. `gateA.sh <label>` writes its files
beside itself unless `GATE_OUT` names a folder.

### Stage 4 — verify and end gates (2026-10-09, resumed)

**Scratch third gun** (a detached worktree of `b1b2769` in the session's
scratch folder, `node_modules` linked; removed after, nothing committed):
- `autocannon`, `kind: 'gun'`, on the `minigun` turret, its own numbers
  (11 damage, 4 rounds/s, 20 a magazine, 2.8 s reload, 180 m, 0.006 rad)
  and icon. `git diff --stat`: `src/content/weapons/weapons.ts` alone (the
  `WeaponId` union and the row); `npx tsc -b` clean.
- A bundled scratch check (`server/thirdgun.check.ts`, in that tree's
  ENTRIES only), following `server.check.ts`'s journal room: a hello with
  `{ vehicle: 'razor', weapon: 'autocannon' }` through `parseClient`, then
  a team deathmatch room on The City (60 s, records and a replay on disk),
  run to its end. It printed `thirdgun ok (9 checks)` in 2.7 s:
  - the hello keeps `autocannon`;
  - the welcome's line-up names it at the person's seat;
  - the match record's `SeatRecord.weapon` is `autocannon`;
  - `replay(replayLines(…))` gives the same records;
  - `checkSettings('tdm', { …classic('tdm'), weapons: 'autocannon' })` takes
    it; `weaponsLabel('autocannon')` is `Autocannon only`;
  - a room on that setting: every seat carries it, on the wire and in the
    record, and its replay says the same;
  - `weaponId(WEAPONS.autocannon)` is `autocannon` though it shares the
    minigun turret.
  - Bots draw it as they draw the others (`autocannon, minigun, minigun,
    rocketPod, autocannon, autocannon, rocketPod`): as the plan says, a new
    weapon changes Classic's bots, and its content PR re-pins on purpose.

**Scratch `kind: 'mine'`** (same worktree, the gun reverted): a `MineSpec`
(`kind: 'mine'`, `mine: { arm, blast }`) added to the union. `npx tsc -b`
lists 9 places (each once per tsconfig; the line numbers are `b1b2769`'s):
- `src/sim/simulation.ts:296` `fire`'s switch: `satisfies never` (TS1360);
- `src/sim/ai.ts:36` `TACTICS satisfies Record<WeaponKind, …>` (TS1360),
  and its read at `ai.ts:392` (TS7053, the same table);
- `src/sim/ai.ts:40` `blastRadius`, `ai.ts:50` `flightTime` (TS2366);
- `src/view/view.ts:24` `FIRE_CUE`, `view.ts:25` `SPINS` (TS2741);
- `server/recorder.ts:28` `fired`'s switch: `satisfies never` (TS1360);
- `src/screens/Garage.tsx:47` `ROUND`, `Garage.tsx:48` `kindSpecs` (TS2741,
  TS2366).
Not a compile error, and the content work must still add: the projectile
(or whatever the kind leaves) in the simulation's own state and step, its
wire event and the recorder's line, the view's effects for it, and the
bots' use of it beyond the tables.

**B**, smoke items 2–4 and 6 (the Chrome extension still isn't connected:
`tabs_context_mcp` said so; the scripted capture stands in). Local Nakama
up, `npm run server` on `:7360` (`protocol 6`, build `4c158a5697cd`).
- `shots/capture.mjs stage4`, every shot: all 23, no page or console error,
  379 s. `capture.mjs` gained a block for item 6 (`lobby-onegun-form`,
  `lobby-onegun-room`): its first locator asked for a button where the form
  has a `radio` (the `Segmented` choice), fixed, then those two shots alone
  in 19.6 s.
- Against `stage3/`, pixels differing by more than 40: `menu`, `board-tdm`,
  `hud-ffa`, `results-ffa-crown` 0.0 %; `pause-settings` 0.1 %; `hud-tdm`,
  `results-ffa-loss`, `results-tdm-win` 0.2 %; `garage-minigun` 0.4 %,
  `garage-rocketpod` 0.7 % (the turntable's angle); `tdm-again` 1.0 %;
  `death-board` 9.3 %, `effects-ffa` 23.9 %, `hit-lockon` 29.4 %,
  `board-ffa` 48.7 %. The four big ones are one FFA match on The City:
  looked at side by side, the layouts and panels are the same, and the
  difference is the moment: a rival's rocket blast in front of the player
  lights the street orange in `stage4/` (the stage 3 shots caught no blast),
  and the car sits a little differently (`hit-lockon` 24 m vs 22 m).
- The HUD weapon panel: `weapon-minigun`, `weapon-rocketpod` 0.0 % against
  `stage4b/` (0.1 % against `stage4a/`, the seams 4.5 logged). The
  `weapon-rocketpod` shot stores `{"vehicle":"razor","weapon":"rocketPod"}`
  in `scrapyard.loadout` before the page loads, as a loadout kept before the
  change: the pod is armed and drawn.
- Item 6, the one-gun setting: `lobby-onegun-form`: the Weapons choice
  shows All, Minigun, Rocket Pod; Rocket Pod picked, the note says
  "Everyone, bots too, drives with this gun". `lobby-onegun-room`: the
  waiting room's settings say `Weapons: Rocket Pod only`.
  `lobby-form-advanced`, `lobby-list` 0.0 % and `waiting-room` 0.1 %
  against `baseline/`.

**C:**
- `node scripts/arena-parity.mjs`: `ok scrapyard 227c4ce7 (expected
  227c4ce7)`, `ok city 8913ad26 (expected 8913ad26)`.
- Balance probe, team deathmatch "even" on The City, 10 matches
  (`shots/tools/probe.mjs tdm 10`): 130.0 kills a match (winner 68.5, loser
  61.5), no overtime, blue 8 wins and red 2, the player 18.2 kills / 15.6
  deaths; respawn `waitMismatches 0`, `alternationErrors 0`; kills a minute
  by phase 16.9, 13.7, 11.7, 9.8.
- Blue 8 wins against stages 1 and 3's 1 and 0 looked like a change, so the
  probe ran again, 16 runs in all, on this tree and on older ones (the older
  code checked out over `src/` and `server/` for the run, then `HEAD`
  checked out again; only files were added since stage 3, so nothing
  stale): the split is noise, not the change.
  - Stage 3's code (`8cf09f0`), 5 runs: blue 2, 1, 10, 5, 8 wins; kills a
    match 126.6, 128.5, 127.8, 129.6, 127.6 (mean 128.0).
  - 4.3 (`4a0cd37`): blue 2, 2; 125.4, 122.1. 4.6 (`6f55287`): blue 10, 6;
    127.3, 126.2.
  - This tree, 7 runs: blue 8, 5, 8, 6, 5, 0, 4 wins; 130.0, 125.7, 129.3,
    125.9, 127.0, 130.5, 131.2 (mean 128.5).
  - Every run: `waitMismatches 0`, `alternationErrors 0`; overtime in 0 or
    1 of 10.
  - Why the split swings: a run's ten matches follow one another with Play
    again, and its "even" autopilot arms the player with the first rival's
    gun once, so a run's matches share much; blue wins per run are not a
    number to compare between runs. Kills a match are. `probe.mjs` now
    prints the player's gun (and takes `GUN=minigun|rocketPod`, which didn't
    always hold through a run: left as it is, scratch).

**D:** this entry, and one per step above.

## Stage 4 — done (2026-10-09)

Identity is by `spec.id` (the wire, records, replays, the one-gun setting),
behaviour by `spec.kind` (every branch a switch or a `Record<WeaponKind, …>`;
a new kind is 9 compile errors, listed above). `WEAPONS` is one table in
`content/weapons/weapons.ts` that imports nothing; turrets by key in
`TURRETS`, a file each; no ternary picks a turret and no SVG in `Hud.tsx`
names a weapon; the Razor's builder in `content/vehicles/models/razor.ts`,
`Handling`/`Chassis` in `content/vehicles/types.ts`; one loadout parser with
its tests. No stage-4 allowance is left (3, all stage 7). `npm test` 52.
Every pin, digest and fixture as at baseline; `PROTOCOL` 6. Build id
`4c158a5697cd`. Departures: `WeaponId` declared, not derived (4.1); more
places than the plan's five handle the kind (4.3); the icon's anti-aliased
seams (4.5); the wire's answer for a non-string id in storage (4.7); the
probe's blue/red split is noise between runs (above).

## Stage 5 — Mode traits and lobby rules

### 5.1 Traits (2026-10-09)

`TDM_TRAITS` (`modes/tdm/config.ts`) and `FFA_TRAITS` (`modes/ffa/config.ts`),
plain objects: `name` (the mode in a sentence: "Team deathmatch", "Free for
all"), `teams` (true / false), `sizes` (today's `CUSTOM.sizes[mode]`),
`friendlyFire` (true / false), `classic: { size, duration, pickups }` (today's
`classic(mode)` numbers: `2 * TDM.teamSize` / `FFA.grid`, `TDM.duration` /
`FFA.duration`, no pickups / pickups). New `modes/traits.ts`: `ModeTraits`,
`MODE_TRAITS = { tdm, ffa } satisfies Record<Mode, ModeTraits>`, `MAX_SEATS`
(the largest size, 12) and `sideOf(mode, size, seat)`. The configs import
nothing new; no cycle (lint's `import/no-cycle`, types included).
**Departure:** `name` is a field the plan's list doesn't have: 5.2's size
error ("Team deathmatch takes 2 to 12 machines, an even number") names the
mode word for word, and `MODES[mode].label` is title case ("Free for All")
and in `modes.ts`, which imports `matchSettings.ts`.
`modes/traits.test.ts` (Vitest, 6 tests): `MAX_SEATS` is 12 (the wire's
`SLOTS`); `BOT_NAMES` has `MAX_SEATS` names; per mode, `CUSTOM.sizes` equals
its traits' sizes; `classic(mode)` as today, field by field. Docs: the code
map (`traits.ts`), `ARCHITECTURE.md`'s "A game mode" (the traits; its stale
`game/<mode>/` path is `modes/<mode>/`).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.43 kB, gzip
1,401.38 kB); `npm test` 58 passed; check all pass in 290.43 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `df648dd02c1c`.

### 5.2 Settings from traits (2026-10-09)

`modes/matchSettings.ts` imports neither mode's config: `classic(mode)` reads
`MODE_TRAITS[mode].classic` (size, duration; `pickups` for all three item
groups); `CUSTOM.modes` is `MODE_IDS`; `checkSettings` takes the sizes from
the traits and refuses friendly fire where the traits say it means nothing.
The size error is said from the traits (`sizeRule`: name, first and last
size, ", an even number" with teams); printed for a size of 3 / 13 with
friendly fire on: `Team deathmatch takes 2 to 12 machines, an even number`;
`Free for all takes 2 to 12 machines` and `Friendly fire is for team
deathmatch`, word for word as before.
**Departure:** `CUSTOM.sizes` is gone rather than rebuilt from the traits:
`Object.fromEntries` over `MODE_IDS` loses the keys' type, so it needed a
double assertion (tried). Its four readers (`checkSettings`,
`LobbyForm.tsx` twice, `arena.check`) read `MODE_TRAITS[mode].sizes`; the
traits test pins each mode's sizes to the old lists in its place.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.65 kB, gzip
1,401.43 kB); `npm test` 58 passed; check all pass in 290.45 s (custom 73,
arena 80; bots 7.8/13.8/17.8; Classic's four and the two custom pins as
before; digests `227c4ce7`/`8913ad26`). Build id `f72fc743883c`.

### 5.3 Lobby rules (2026-10-09)

The parity table first: a scratch script with the old code's functions
(`server/lobbies.ts` `side`, `unstartable` and `over`'s key, the waiting
room's `startHint` empty side, `tdm/mode.ts`'s `lineUp` team) printed its
answers over the cases `lobbies.check` drives (alone, alone with a bot, a
newcomer not ready, ready but away, both on blue, both on red, two people
and a bot on red, 1 v 1, free for all with two people and with a bot; the
tally for blue, red, a person, a bot, an empty seat; sides at 2, 8 and 12
seats and free for all's seats). Those answers are the expected column of
`src/net/lobbyRules.test.ts` (25 tests, `it.each`), written before the old
code went.
New `src/net/lobbyRules.ts`, pure: `startable({ mode, size, slots, people,
waiting })` (`'alone' | 'waiting' | 'sides' | ''`, the server's order),
`emptySide(mode, size, slots)` (the side nobody holds, or -1: 5b's hint
names it) and `tallyKey(mode, winner, slots)`. `server/lobbies.ts` uses
them, `sideOf` for its side, and `MODE_TRAITS[mode].teams` for the free
slot, regrouping on a mode change and slot claims: no mode literal left in
it. `lobbies.check` alone: `custom ok (73 checks)`. Docs: the code map
(`lobbyRules.ts`).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.65 kB, gzip
1,401.43 kB); `npm test` 83 passed; check all pass in 289.98 s (custom 73;
bots 7.8/13.8/17.8; Classic's four and the two custom pins as before;
digests `227c4ce7`/`8913ad26`). Build id `dae87731271a`.

### 5.4 The rest of the server and domain (2026-10-09)

- `server/room.ts`: a side's chat channel only where `MODE_TRAITS[kind].teams`
  (was `kind !== 'tdm'`).
- `modes/tdm/mode.ts` `lineUp`: the team is `sideOf('tdm', size, seat)`.
- `net/protocol.ts`: `SLOTS` (12) is gone; a lobby message's slot must be
  below `MAX_SEATS` (12). The wire's runtime closure (`closure.mjs`): 11
  files (`modes/ids.ts` and `modes/traits.ts` join), no package.
No mode literal is left in `server/` but its checks, `browser.ts` and
`load.ts`, nor in `modes/matchSettings.ts`.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.70 kB, gzip
1,401.45 kB); `npm test` 83 passed; check all pass in 290.08 s (protocol 96,
server 172; bots 7.8/13.8/17.8; Classic's four and the two custom pins as
before; digests `227c4ce7`/`8913ad26`). Build id `53cd673f5d9a`.

### 5.5 Tests (2026-10-09)

Written with their subjects: `modes/traits.test.ts` in 5.1 (the sizes' test
moved to the traits in 5.2), `net/lobbyRules.test.ts` in 5.3 (the parity
table before the old code went). **Departure:** the plan's "`MAX_SEATS`
equals `SLOTS` and the HUD's pools": `SLOTS` is gone (5.4) and 5.8 makes the
pools `MAX_SEATS` itself, so the test pins `MAX_SEATS` to 12 and
`BOT_NAMES.length` to it. No commit of its own.

### 5.6 The waiting room (2026-10-09)

`screens/lobbies/Lobby.tsx`: its own `side()` is gone. `startHint` asks
`startable` (and `emptySide` for the side it names), so the hint keeps the
server's order of reasons; the texts are as before. The tally, the columns'
halves and side headers, slot claims, the Players line and the Friendly fire
line read the traits (`teams`, `friendlyFire`); the side counts use
`sideOf`. No mode literal is left in it. (`TEAMS`, the sides' names, still
comes from `modes/tdm/config.ts`.)
B, smoke item 6 (scripted, the extension still not connected):
- `capture.mjs` gained `hint-waiting`, `hint-sides`, `hint-none`: an owner
  and a member in a 4 v 4 lobby; the member not ready ("Waiting for Guest
  …"), ready and moved to blue ("Red has nobody: move there, or add a
  bot"), then a bot on red ("Everyone’s ready"). Before-shots at `4fb66ca`
  (the change stashed): `stage5-before/`; after: `stage5a/`. Pixels
  differing by more than 40: the three hints 0.2 % each (the guests'
  names); `waiting-room`, `lobby-onegun-room` 0.1 %; `lobby-form-advanced`,
  `lobby-list` 0.0 %; `lobby-onegun-form` 0.4 %. The hint block's first runs
  timed out when it ran after the other lobby blocks: its `Join` took the
  first row's (an older lobby's); now it clicks the Join in the "Hints" row.
- `node scripts/browser-match.mjs custom`: `browser match ok` at 86.5 s
  (the lobby, the list, the code, Start at 2 of 12, two matches and back,
  a reload in the waiting room, the invite link).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.93 kB, gzip
1,401.57 kB); `npm test` 83 passed; check all pass in 290.25 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `f46f0a0ef809`.

### 5.7 The lobby form (2026-10-09)

`screens/lobbies/LobbyForm.tsx`: a new lobby starts on `CUSTOM.modes[0]`
(its first arena, its Classic settings), as `'tdm'` did. Which fields show
and what they say come from the traits: the Players hint and the steppers'
"N v N" from `teams`, the Friendly fire field from `friendlyFire` (and a
mode change keeps the option only where it means something), the kill
limit's "team" / "machine" from `teams`. No mode literal is left in
`screens/lobbies/`.
B: `capture.mjs` gained `lobby-form-ffa` (Free for All picked, Advanced
open, kill limit 25: no Friendly fire field, "The first machine to 25 kills
wins at once"). Before (`4ca2380`, the change stashed) and after, pixels
differing by more than 40: `lobby-form-ffa` 0.4 %, `lobby-form-advanced`
0.6 %, `lobby-onegun-form` 0.0 % (the list behind the drawer: lobbies the
earlier blocks left, waiting out their grace, and guest names); the rest of
the lobby shots 0.0–0.2 %.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.94 kB, gzip
1,401.56 kB); `npm test` 83 passed; check all pass in 290.21 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `43cd57d4ea53`.

### 5.8 Results and the HUD's pools (2026-10-09)

- `screens/Results.tsx` `winnerKey`: the winner from the running rules (a
  side, or a seat; -1 for a draw, as `tdm.winner` is), then `tallyKey(mode,
  winner, slots)`; '' or a draw gives no highlight, as before. Its
  `mode.kind` branches (`rulesOf`, the MVP) stay for stage 7.
- `hud/Hud.tsx`: `MARKERS` and `SCORE_ROWS` are `MAX_SEATS`.
B: `capture.mjs stage5c` with the HUD, boards and results shots: no page or
console error, 218.6 s. Against `stage4/`: `board-tdm`, `hud-tdm`,
`results-ffa-crown`, `pause-settings` 0.0 %; `hud-ffa` 0.1 %;
`results-tdm-win`, `tdm-again` 0.3 %; `results-ffa-loss` 0.6 %;
`death-board` 11.0 % (another moment of the wreck); `board-ffa` 53.3 %: the
hit and effects shots weren't asked for, so the board came at 09:59, not
09:56 (eight rows, the same layout: looked at). `node
scripts/browser-match.mjs custom`: `browser match ok` at 86.0 s, results
and back to the waiting room twice.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.98 kB, gzip
1,401.61 kB); `npm test` 83 passed; check all pass in 289.70 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `a303bed29aa2`.

### 5.9 Literal guard (2026-10-09)

`repo.test.ts`, a second `describe`: every `.ts`/`.tsx` under `src/` and
`server/`, one test each, fails on a `'tdm'`/`'ffa'` string literal (any
quote) outside: `modes/ids.ts`, `traits.ts`, `modes.ts`, the mode folders;
`content/arenas/maps.ts` and `App.tsx` (the data); checks and tests;
`server/browser.ts` and `load.ts`; `hud/Hud.tsx` and `screens/Results.tsx`
until stage 7. 109 files checked (and one test that it found them), all clean. Tried: `const x = 'ffa'`
appended to `net/lobbyRules.ts` fails it (`expected [ '37: const x =
\'ffa\'' ] to deeply equal []`), reverted. Docs: `MODULE_BOUNDARIES.md`
(the rule and its exceptions).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.98 kB, gzip
1,401.61 kB); `npm test` 193 passed (83 + the guard's 110); check all pass
in 289.79 s (bots 7.8/13.8/17.8; Classic's four and the two custom pins as
before; digests `227c4ce7`/`8913ad26`). Build id `a303bed29aa2` (tests
aside).

### Stage 5 — verify and end gates (2026-10-09)

**Scratch third mode** (a detached worktree of `73e0cee`, `node_modules`
linked; removed after, nothing committed): `brawl`, `teams: false`, sizes
2–8, Classic 6 machines for 5 min with pickups, free for all's rules and
line-up (its `mode.ts` re-exports `createFfaMode` and `lineUp`). It touched
`modes/brawl/` (`config.ts`, `mode.ts`) and the registries alone:
`modes/ids.ts`, `modes/traits.ts`, `modes/modes.ts`, The City's list in
`content/arenas/maps.ts`.
- `npx tsc -b` clean; oxlint 0/0; `npx vitest run` 195 passed (the literal
  guard included: the new folder holds no `'tdm'`/`'ffa'`).
- `arena.check` (bundled in that tree): `every mode each arena hosts, at
  its biggest: …, city brawl 8`, `arena ok (82 checks)`; `lobbies.check`
  73.
- `classic('brawl')`: size 6, 300 s, every pickup; `checkSettings('brawl',
  size 9)`: `Brawl takes 2 to 8 machines`; `startable` gives `''` for two
  people (no sides), `tallyKey('brawl', 1, …)` the person's uid.
- The screens (the same patch applied to the main tree for one capture,
  then `git checkout` and the folder removed; the tree clean after):
  `stage5-brawl/modes-brawl`: Brawl on the arena screen's list;
  `lobby-form-brawl`: Brawl in the lobby list's filters and the form's Mode
  choice, its arena The City alone, Players up to 8 as plain numbers, the
  stepper's + off at 8.

**B**, smoke item 6, all of it (scripted; the extension still not
connected; local Nakama, `npm run server`):
- Hints, sides, the form for both modes, the one-gun setting: 5.6 and 5.7.
- Edit with a mode change (`capture.mjs` gained `edit-ffa`, `edit-tdm`: an
  owner, a member and a Hard bot on red; Edit to Free for All, then
  back to Team Deathmatch). Before: the screens and HUD at `4fb66ca`
  checked out for the run (`stage5-before/`); after: `stage5d/`. 0.3 % each
  (guest names, the code): free for all lists the three in its first slots
  with "No wins yet"; back in team deathmatch the sides are dealt afresh (a
  mode change keeps none): the owner and the bot blue, the member red, and
  the tally reads Blue 0 — 0 Red. The block's
  first after-run timed out: a lobby of the same name from the before-run
  was still in the list (its grace); the name now carries a number.
- `browser-match.mjs custom` twice (5.6, 5.8), both ok.
- Not shown on a screen: a tally with wins. Both browser matches end
  abandoned (everyone went back), which counts nothing; the tally's key is
  held by `lobbyRules.test.ts` (the old code's answers), `lobbies.check`
  and `client.check`'s tally cases.

**C:**
- `node scripts/arena-parity.mjs`: `ok scrapyard 227c4ce7 (expected
  227c4ce7)`, `ok city 8913ad26 (expected 8913ad26)`.
- Balance probe, team deathmatch "even" on The City, 10 matches: 129.4
  kills a match (winner 67.7, loser 61.7), overtime 1 of 10, blue 10 wins,
  the player (Rocket Pod) 16.1 kills / 16.2 deaths; `waitMismatches 0`,
  `alternationErrors 0`; kills a minute by phase 16.2, 12.7, 11.5, 10.3.
  Within stage 3's code's five runs (126.6–129.6 kills a match).

**D:** this entry, and one per step above.

## Stage 5 — done (2026-10-09)

Code outside a mode learns about it from `MODE_TRAITS` (`modes/traits.ts`;
each mode's row in its config): `classic(mode)`, the lobby's sizes and the
settings check, the server's lobbies and rooms, the wire's slots, the
waiting room, the lobby form, the HUD's pools. The lobby rules are written
once (`net/lobbyRules.ts`: `startable`, `emptySide`, `tallyKey`) for the
server, the waiting room and the results. No mode literal in `server/` (its
checks, `browser.ts` and `load.ts` aside), `modes/matchSettings.ts` or
`screens/lobbies/`, and `repo.test.ts` holds it. A third mode is its folder
and four registry lines. `npm test` 193. Every pin, digest and fixture as at
baseline; `PROTOCOL` 6. Build id `a303bed29aa2`. Departures: a `name` trait
(5.1); `CUSTOM.sizes` deleted, not rebuilt (5.2); tests with their steps,
`SLOTS` gone (5.5); no on-screen tally with wins (above).

## Stage 6 — Wire modules

### 6.1 Event codec (2026-10-09)

New `src/net/events.ts`: `FIELDS`, one row per wire code (`sh ln rk bu hu
wr cr rl sp rc ru go`), each field's name in wire order and its unit (`seat`
or `int` as it is, `flag` 1/0, `cm` / `cm3` hundredths, `q3`
ten-thousandths, `raw`). From it: `GameEvent`, a union typed from the table
(`{ code: 'sh', tick, shooter, muzzle, point, normal, struck, victim }`…);
`encode(event)` (the same `Math.round(x * 100)` / `Math.round(u * 1e4)` the
recorder wrote); `decode(row)` (the same divisions the page made; `null`
for a code the build doesn't know, which the page ignored before too);
`owners(event)`, the values of its `seat` fields; `NOW` (`ru`, `go`).
`server/recorder.ts` encodes every event through it (its `xyz` and the
`cm`/`q4` imports are gone). `src/net/events.test.ts`: `decode(encode(x))`
is `x` for one of every code (two `sh`, two `rl`); a round is written as
`protocol.check`'s fixture row (`['sh', 88, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9,
1, 7]`); an unknown code decodes to `null`; the seats `owners` names. The
page (`net/client.ts`) still decodes by position until 6.2. Docs: the code
map (`events.ts`).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,990.98 kB, gzip
1,401.61 kB); `npm test` 217 passed; check all pass in 289.70 s (server 172:
each wire event as the recorder writes it, pinned, holds; protocol 96;
Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `da4e4ebdab9b`.

### 6.2 Old against new, then the old removed (2026-10-09)

- Recorded: a bots-only free for all on The City (seed 4242, pickups on),
  70 s of a room with one silent seat whose bot drives, every snapshot's
  events as a page receives them (`readServer`): 2079 events (`rk` 827,
  `sh` 494, `hu` 460, `ln` 73, `bu` 73, `cr` 62, `ru` 33, `rl` 23, `wr` 17,
  `sp` 15, `rc` 2; `go` comes only with a next match, and is in the round
  trips).
- `server/events.test.ts` (4 tests, about 2 s): over every recorded event,
  `decode(row)` equals what `net/client.ts` read by position before
  (`positional`, kept in the test as the reference: its fields as `play()`
  took them), `owners(decode(row)).includes(me)` equals the old `mine(row)`
  for every seat 0–7, and `NOW` holds exactly `ru` and `go`. Written and
  passing before the page's code changed.
  **Departure:** it lives in `server/`, not `src/net/`: it builds a real
  room, and `src/`'s tsconfig has no Node types (`server/room.ts` imports
  `node:crypto`: TS2591, tried). `src/net/events.test.ts` keeps the round
  trips.
- Then `net/client.ts`: each snapshot's rows are decoded once; `NOW` or a
  seat of the player's in `owners` plays at once, the rest wait in `later`
  (now `GameEvent[]`, by `.tick`); `play(event, catchUp)` switches on
  `event.code` and reads named fields, in the same order (rules events,
  restart, wrecks, respawns and recoveries first, even in a catch-up; then
  the effects). `mine()` and every `f[n]` read are gone; 445 lines (was
  463). An unknown code is skipped, as `play` ignored it before.
B, items 5 and 6 online: `node scripts/browser-match.mjs`: `browser match
ok` at 115.7 s (both pages in one room; a's car drove 18.2 m on b's screen;
a left and its seat is a bot's again; b's screen shows the kill feed:
wrecks, Revenge, Shutdown). `browser-match.mjs custom`: ok at 86.2 s.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,991.77 kB, gzip
1,401.99 kB: the event table joins the page); `npm test` 221 passed; check
all pass in 289.88 s (client 47, netplay 32, server 172 with its replay
cases; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `655ba47df0a3`.

### 6.3 Lobby wire (2026-10-09)

New `src/net/lobbyProtocol.ts`, text moved as it was from `net/protocol.ts`:
`LOBBY_ACTIONS`, `INVITE`, `readCode`, `LOBBY_FORM`, `tidy`, `LobbyForm`,
`Lobbying`, `LobbyRow`, `LobbySlot`, `LobbyView`, `LobbyNote`, the `lb`
parser `lobbying()` (now exported), and `LobbyMessage` (the `lbs` / `lb`
members of `ServerMessage`, which now names it). `parseClient` hands `lb`
to it as before; `ClientMessage` names `Lobbying` from it.
New `src/net/limits.ts`: `LIMITS` and the two string checks (`text`,
`optional`), moved from `protocol.ts`: both wire modules need them, and
`lobbyProtocol.ts` importing `protocol.ts` would be a cycle (lint's
`import/no-cycle`, types included). **Departure:** a file the plan doesn't
name. The parser's `Parsed` became a local `{ ok, message: Lobbying } |
{ ok: false, error }`, which `Parsed` takes as it is. One stale comment
left by 4.7 above `clampAim` ("`id` if the registry has it…") went with the
parser.
Importers changed only their import lines: `App.tsx`, `net/lobbies.ts`,
`screens/Results.tsx`, `screens/lobbies/{Lobbies,Lobby,LobbyForm}.tsx`,
`server/{lobbies,seating,server}.ts`, `net/protocol.check.ts`,
`server/lobbies.check.ts`. `protocol.ts`: 559 lines (710 before); the
pre-lobby file (`3b0943d^1`) is 477 lines as written then, 556 under
today's Prettier. `scripts/match-smoke.mjs` still reads `PROTOCOL` from
`net/protocol.ts`. Docs: the code map.
B: `browser-match.mjs custom` ok at 86.6 s. (An accidental local run of
`scripts/match-smoke.mjs`: the local server, started on an older build,
refused it; it deleted its guest.)
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,991.77 kB, gzip
1,401.99 kB); `npm test` 223 passed; check all pass in 289.91 s (protocol
96 with its lobby cases, custom 73, server 172 with its lobby cases;
Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `ecb14e5c5e6b`.

### Stage 6 — end gates (2026-10-09)

**B**, items 3, 5 and 6 online (scripted; the extension still not
connected): `browser-match.mjs` (Classic) at 6.2: both pages in one room,
a's car seen driving on b's screen, the kill feed's wrecks, Revenge and
Shutdown on b's; a left and a bot took the seat. `browser-match.mjs
custom` at 6.2 and 6.3. When events play (the player's own at once, the
rest at the drawn tick; a catch-up keeping rules events, wrecks and
respawns and dropping effects) is held by `client.check` (47) and
`netplay.check` (32), green at every step, and the parity test of 6.2.
**C:** not due: no arena, physics, `sim/` or `modes/` file changed in this
stage (`git diff --stat a6b6c48 HEAD -- game/src/sim game/src/modes
game/src/content`: nothing).
**D:** this entry, and one per step above.

## Stage 6 — done (2026-10-09)

One definition of each wire event (`net/events.ts`), used by the recorder
to write and the page to read; no positional event read left in
`net/client.ts`. The lobby wire in `net/lobbyProtocol.ts`; `protocol.ts` at
its path, 559 lines (the pre-lobby file under today's Prettier: 556).
`npm test` 223. Every pin, digest and fixture as at baseline; `PROTOCOL` 6.
Build id `ecb14e5c5e6b`. Departures: the parity test in `server/` (6.2);
`net/limits.ts` (6.3).

## Stage 7 — UI and scenery seams

### 7.1 Scenery out of the contract (2026-10-09)

- `MatchMode.show(camera)` and `ModeContext.scene` are gone; the adapters
  draw nothing (`ffa/mode.ts` lost its `scenery` parameter and `FfaScenery`,
  `tdm/mode.ts` its `pickups`; both `restart` only reset the rules, both
  `dispose` are empty). `modes/modes.ts` imports neither `pickups.ts` nor
  `zone.ts`.
- New `modes/scenery.ts` (client-only): `createScenery(scene, kind, mode)`:
  the pickup tokens when `mode.supply` exists (free for all always, team
  deathmatch when its settings turn pickups on: the old condition,
  `itemTypes(settings.items).length`, is exactly when its rules make a
  supply), drawn from `mode.supply.items` and `mode.rules.now`; and
  `MODE_SCENERY` (`Partial<Record<Mode, (scene, mode) => Scenery>>`), free
  for all's hot zone from `'zone' in mode.rules`. `RunningMode` is named
  there.
- The runtime makes it where the mode made it before: practice right after
  the mode (after the view), online right after `seatOnline` (before the
  view), so creation order, and the objects' ids, are as before;
  `playMatch` updates it where `mode.show` ran (the end of the frame),
  clears it first thing in `restarted()` (the mode cleared it inside
  `restart`, just before), disposes it right after `mode.dispose()`.
  `seatOnline` takes no scene.
- Lint: the three stage-7 allowances (`modes.ts`, `ffa/mode.ts`,
  `tdm/mode.ts`) are gone; none is left.
- The server bundle: `BLINK = 5`, `tokenGeometry` (`pickups.ts`),
  `#ff5a1f`, `createHotZone` (`zone.ts`) were each in 1 file of
  `dist-server/` before, in none after.
B (scripted; the extension still not connected): `capture.mjs` gained
`scenery-tokens` and `scenery-zone` (free for all on The City, the clock
moved to the first wave at 2:00, the player put 12 m from the first item,
then the first zone opened by hand and the player outside it), then Exit
to garage, then a second practice match. Before (the step stashed,
`stage7-before/`) and after (`stage7a/`): tokens (glyph, pool, beam), the
zone's ring and posts drawn in both; framing differs with each run's
items. The renderer's `info.memory`: in the first match geometries 496,
textures 193 in every run, before and after; `window.match` undefined
after the exit; the next match 557 and 582 geometries before, 558 and 588
after (194–197 textures): the garage's own models vary run to run, on both
sides alike. In the garage itself after 6 s: 481/498 before, 502/499 after
(the garage still building: not a comparable number).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,991.88 kB, gzip
1,402.07 kB); `npm test` 224 passed; check all pass in 290.25 s (Classic's
four and the two custom pins as before; digests `227c4ce7`/`8913ad26`).
Build id `60a237aed2bd`.

### 7.2 Mode panels (2026-10-09)

- `modes/views.ts` (client-only): `MODE_VIEWS: Record<Mode, { HudPanel,
  ResultsPanel }>`.
- `hud/dom.ts`: the HUD's DOM writes (`setText`, `setStyle`, `fade`, moved
  from `Hud.tsx`), two class names, and `HudPanelHandle`: what the shared
  HUD asks of the running mode's panel (its own block's `update`, the
  `leader`, a map `zone`, an `objective` line, the `overtimeClock`, and the
  scoreboard's `rank`, `grouped`, `groupName`/`groupNote`, `scoreLine`,
  `teamKills`, `nemesis`, `words`).
- `modes/ffa/HudPanel.tsx`: the kills, the lead line, the top-four board
  (moved: `leadLine`, `drawBoard`), the sole leader, the hot zone and its
  line, overtime's countdown, the standings order, the nemesis.
  `modes/tdm/HudPanel.tsx`: the team score and momentum, overtime counting
  up, the scoreboard by team with headers ("1 kill"), the score line, the TK
  column with friendly fire. Each queries `data-hud` only under its own
  root; the markup is the old block's, less what was hidden for the other
  mode (`hidden` plus an inline `display` became the display itself).
- `hud/Hud.tsx` renders `MODE_VIEWS[mode].HudPanel` at the top left and
  reads everything mode-specific through its handle; it takes a `mode` prop
  (`GameCanvas`: the room's mode online). Its zone line is the generic
  `objective` (`data-hud="objective"`). The minimap is passed marks
  whenever the mode has a supply (free for all always has one, so `ffa ||
  mode.supply` was `mode.supply`); `minimap.ts` takes the zone as `{ x, z,
  radius }` and no longer imports `ffa/rules.ts`. The scoreboard's
  `data-mode="ffa"` attribute in the markup went (it is set when drawn; no
  style reads it).
- Results: `screens/ResultsFrame.tsx` (the frame, the record's tiles, the
  standings table and row, the crown; markup moved as it was) and
  `screens/resultsFormat.ts` (`Verdict`, `plural`, `number`, `rise`).
  `modes/ffa/ResultsPanel.tsx`: the placing, the full record (items,
  nemesis), placings with medals and the winner's crown.
  `modes/tdm/ResultsPanel.tsx`: the team score (overtime), the MVP card,
  the record, both rosters under their scores, the MVP crowned, the TK
  column. `screens/Results.tsx` keeps the tally, the countdown and the
  buttons, handed to the panel as `children`; the tally's winner is
  `match.mode.outcome()` (the winning team; free for all: the winner's seat,
  its team), the same key as before.
- Lint: the level-6 block now covers `src/modes/views.ts` and
  `src/modes/**/*.tsx` (the panels read the match like the screens).
  `MODULE_BOUNDARIES.md` says so; `ARCHITECTURE.md` (FFA and TDM, "A game
  mode", "A HUD feature") and the code map describe the panels.
B (scripted; the extension still not connected):
- `capture.mjs stage7b`, the practice shots: no page or console error.
  Against `stage4/`: `menu`, `board-tdm`, `hud-ffa`, `results-ffa-crown`
  0.0 %; `pause-settings` 0.1 %; `results-ffa-loss` 0.2 %; `hud-tdm`,
  `results-tdm-win` 0.3 %; `tdm-again` 1.1 %; `death-board` 9.0 %,
  `effects-ffa` 30.0 %, `board-ffa` 52.9 %, `hit-lockon` 68.3 % (the scene
  at another moment: looked at side by side, the HUD is the same: the
  kills, the lead line and board, the scoreboard, the death board's team
  headers, "Wrecked", "by", "Respawning in", the score line).
- New `custom-board-tk`, `results-custom` (a custom team deathmatch 6 v 6,
  friendly fire and every pickup on, kill limit 10; the owner, a member,
  ten Normal bots; Tab 8 s in; the results). Before (`stage7-before/`, the
  step stashed) and after (`stage7b/`), two different matches: the TK
  column on the board and in the standings, "2 players", the MVP card,
  "Winner" on a team, the lobby tally with this result counted
  (before Blue 1 — 0 Red after a win, after Blue 0 — 1 Red after a loss),
  the countdown back to the lobby. Same layout.
- Allocations (`shots/tools/alloc.mjs`: CDP heap sampling every 256 bytes,
  collected objects included, 10 s of practice with the scoreboard held;
  headless, about 2 frames a second): team deathmatch, the HUD's files
  84.8 KB before (`Hud.tsx` 69.7, `minimap.ts` 15.1), 91.1 KB after
  (`Hud.tsx` 51.5, `minimap.ts` 20.5, `dom.ts` 12.4, `tdm/HudPanel.tsx`
  6.6); free for all 49.9 KB before, 54.1 KB after. The same order, inside
  the sampling's noise at so few frames; nothing new allocates per frame
  (the panels write what `Hud.tsx` wrote, with the same strings).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,993.90 kB, gzip
1,402.72 kB); `npm test` 228 passed; check all pass in 290.13 s (Classic's
four and the two custom pins as before; digests `227c4ce7`/`8913ad26`).
Build id `8acc16417ebd`.

### 7.3 Chips and sharing from the catalogue (2026-10-09)

- `modes/items/items.ts`: each item has `timed` (repair, speed, armor,
  damage: true); `ITEMS` is `as const satisfies Record<ItemType, …>`, and
  `Effect` is derived from the flag (it was declared in `supply.ts`):
  `'repair' | 'speed' | 'armor' | 'damage'`, the same type. `EFFECTS`: the
  timed items in the catalogue's order.
- `supply.ts`: `share()` writes each machine's effects by looping over
  `EFFECTS` (`shared`), in the order the literal had, so the state's JSON is
  as before; `mirror()` already took whatever keys came. `noEffects` keeps
  its literal: a new timed item is a compile error there (`Effects` is a
  `Record<Effect, number>`).
- `hud/Hud.tsx`: the chips are `CHIPS`: Shield, then `EFFECTS` with their
  catalogue label and colour (it named four).
- `repo.test.ts`: the two stage-7 exceptions (`hud/Hud.tsx`,
  `screens/Results.tsx`) are gone, and a `mode.kind` comparison in `hud/` or
  `screens/` now fails it too (tried: `m.mode.kind === 'x'` appended to
  `hud/minimap.ts` fails it, reverted). `src/modes/items/items.test.ts`:
  `EFFECTS` is repair, speed, armor, damage in that order; every item has a
  label and a colour.
- Docs: `MODULE_BOUNDARIES.md` (the guard), `ARCHITECTURE.md`'s "A pickup".
B: `capture.mjs stage7c effects-ffa`: the four chips (Repair, Speed boost,
Armor, Damage boost, 3.7 s) the same as `stage7b/`'s, cropped side by side.
Gate A: oxlint 0/0; format: the first run flagged `supply.ts` (its import
line, too long once `EFFECTS` and `Effect` joined), fixed with Prettier,
then clean; tsc clean (again after the fix); build clean (3,993.79 kB, gzip
1,402.68 kB); `npm test` 237 passed (again after the fix); check all pass
in 289.95 s (Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `cf8ee33c944f`.

### Stage 7 — end gates (2026-10-09)

The local game server (`npm run server`, started this morning on build
`4c158a5697cd`, stage 4's code) was restarted on the current code (build
`cf8ee33c944f`) before these runs. **Departure:** the scripted lobby shots
of stages 5 and 6 (hints, Edit, one gun, the custom TK match before) talked
to that older server; the browser matches build a server of their own from
the tree, so they ran the current server code each time.
**B**, the whole smoke list (scripted; the extension still not connected):
- `shots/capture.mjs stage7`, every block: 32 shots, no page or console
  error, no failed step, 573.3 s. Against stage 0's `baseline/`, pixels
  differing by more than 40: `menu`, `garage-minigun`, `hud-ffa`,
  `lobby-form-advanced`, `lobby-list`, `results-ffa-crown` 0.0 %;
  `waiting-room` 0.1 %; `hud-tdm`, `results-tdm-win` 0.3 %; `board-tdm`,
  `results-ffa-loss` 0.6 %; `garage-rocketpod` 0.9 %; `death-board` 7.0 %
  and `board-ffa` 19.2 % (the scene's moment, as at stage 3). The lobby
  shots against `stage5-before/` 0.0–0.4 %; the custom TK board and results
  against `stage7-before/` 1.6 % and 4.6 % (two matches); the scenery shots
  differ by where the items fell. Exit to the garage: `window.match`
  undefined; geometries 496 / textures 193 in the match, as in every run.
- `node scripts/browser-match.mjs`: `browser match ok` at 116.5 s (one
  room, a's car seen driving 21.3 m on b's screen, a left and a bot took the
  seat). `browser-match.mjs custom`: ok at 86.5 s.
**C:**
- `node scripts/arena-parity.mjs`: `ok scrapyard 227c4ce7 (expected
  227c4ce7)`, `ok city 8913ad26 (expected 8913ad26)`.
- Balance probe, team deathmatch "even" on The City, 10 matches: 127.7
  kills a match (winner 67.7, loser 60.0), overtime 1 of 10, blue 4 wins,
  the player (Minigun) 13.9 kills / 16.3 deaths; `waitMismatches 0`,
  `alternationErrors 0`; kills a minute by phase 16.5, 13.2, 10.8, 9.7.
  Inside stage 3's code's range (126.6–129.6).
**D:** this entry, and one per step above.

## Stage 7 — done (2026-10-09)

Rendering is out of the mode contract: no `show`, no scene for a mode; the
runtime draws the pickups from any supply and a mode's own scenery from
`MODE_SCENERY`, and the server bundle carries neither. Each mode brings its
HUD and results panels (`MODE_VIEWS`); `hud/` and `screens/` never branch on
the mode, and `repo.test.ts` holds it with no exception. The chips and the
share loop come from the catalogue. No lint allowance is left. `npm test`
237. Every pin, digest and fixture as at baseline; `PROTOCOL` 6. Build id
`cf8ee33c944f`. Departures: the garage-side memory counts are not
comparable run to run (7.1); allocations compared by heap sampling at about
2 frames a second (7.2); the older local server under stages 5–6's lobby
shots (above).

## Stage 8 — Module splits

### 8.1 `server/room.ts` (2026-10-09)

- New `server/journal.ts`: `DRIVING`/`STANDING`/`COASTING`, `Given`,
  `ReplayLine` (moved from `room.ts`), and the `in` row both ways:
  `givenRow(seat, given, tick)` (what `room.ts`'s `note()` built) and
  `readGiven(row)` (what `replay.ts` destructured). One definition of the
  persisted format; `room.ts`, `replay.ts` and `records.ts` import it.
- New `server/inputs.ts`, pure: `InputQueue` (the queue's fields, which
  `Human` now extends, so `human.drops` and the rest read as before),
  `createQueue`, `pushInput` (was `room.input`'s body), `takeInput` (the
  queue's half of `drive()`: the next input or the last again, repeats, the
  drain window, depths), `stale`, `queueDepth` (moved; `server.ts` and
  `netplay.check` import it from here), and `QUEUE`, `DRAIN`, `STALE` with
  their comments. In `drive()` the bot lets go of the wheel (`takeWheel`)
  after the queue's bookkeeping instead of inside it: the two touch nothing
  in common (the queue's fields; the machine's brain and gun), so nothing
  that steps moves (the pins hold).
- The five custom-room options are one `custom?: CustomRoom` (`lobby`,
  `plan`, `chat`, `over`, `idle`); `seating.ts`, `replay.ts` (from the
  header's `lobby`/`plan`) and `server.check`'s two custom rooms pass it.
  The journal's header is as before.
- `step()` is untouched, statement for statement.
- `server/inputs.test.ts` (Vitest, 12 tests): in order, a repeat and an
  older seq refused; `QUEUE` kept, the oldest dropped; a step's input
  before the first, next, dry (a repeat); a drain window's end letting go
  what waited all through it beyond one (a burst of 4: 3 drops), and leaving
  a queue that ran down to one alone; stale past `STALE` ms; the depth
  statistics.
- `room.ts` is 617 lines (723 before): what's left is one match (the step,
  seats, the fair-play watch, the record, what goes out). **Departure:**
  over the plan's ~450 with the plan's split done; listed for stage 11.
  Docs: the code map (`inputs.ts`, `journal.ts`).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,993.79 kB, gzip
1,402.68 kB); `npm test` 251 passed; check all pass in 289.94 s (server 172:
the journal room's and the custom room's replays to the bit; netplay 32;
Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `7c8dcce7fc1a`.

### 8.2 The page's two stores (2026-10-09)

New `src/net/sessionSocket.ts`, what `net/matchmaking.ts` and
`net/lobbies.ts` had word for word: `dial()` (a fresh session, then the
socket; `Dial`, which `client.check` imports from here now), `RETRY`
(`[0, 1000, 2000, 4000, 7000]`) and `comeBack(wanted, again, giveUp)`, the
retry loop both stores ran (a wait, the "still wanted?" check, a try, the
check again on a failure, the next wait or giving up), and the tab's mark
(`mark(key, value | null)`, `readMark(key)`, each swallowing a storage that
throws). Each store keeps its own state machine and its own `back(mine)`:
what "wanted" means (Classic: this attempt, searching, away; custom: this
attempt, `back`) and what a try does (Classic: connect and ask for the
ticket's state; custom: dial, attach, `back` into the lobby). `matchmaking.ts`
213 → 208 lines, `lobbies.ts` 275 → 263. The keys (`scrapyard.search`,
`scrapyard.lobby`), the graces and the order of every call are as before.
`src/net/sessionSocket.test.ts` (Vitest, fake timers, no real wait, 5
tests): the tries at 0, 1, 3, 7 and 14 s, then giving up; a store that moves
on at 2.5 s gets no third try and no give-up; the first try that works
ends it; the mark kept, read, removed; storage that throws keeps nothing and
throws nothing. Docs: the code map (`sessionSocket.ts`).
B (the local server restarted on the current code, build `cf4a38979eda`):
- `node scripts/browser-match.mjs custom`: ok at 86.2 s (a reload in the
  waiting room and back; the invite link signed out).
- A reload during a Classic search (scratch `shots/tools/search-reload.mjs`,
  headless, against `:3000` and `:7360`): Find Match, the mark
  `{"mode":"tdm","map":"scrapyard"}`, the server counting 1 searching;
  reload: the main menu's status line "Team Deathmatch · Scrapyard · Finding
  players · 0:01" at 0.5 s, the server still counting 1 (the same ticket);
  Cancel: "Search cancelled", the server 0, the mark gone. (A first version
  of the script read the store through a dynamic `import()` and got a
  second module instance (Vite serves the app's copy with `?t=` after an
  edit), so it read the DOM instead.)
- A reload in a lobby's match (20 s) is `client.check`'s "back in after a
  drop (waiting or in a match) or a reload"; StrictMode's double mount runs
  in every scripted page (the dev server's build).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,993.68 kB, gzip
1,402.71 kB); `npm test` 257 passed; check all pass in 289.82 s (client 47;
Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `cf4a38979eda`.

### 8.3 `runtime/match.ts` (2026-10-09)

`createMatch` (practice's match and its `MatchSource`), `MatchOptions` and
`freshSeed`, with their comments, moved as they were to the new
`runtime/practice.ts`, beside `online.ts`; `runtime.ts` imports it from
there. `match.ts` keeps `playMatch`, `MatchParts`, `MatchSource`,
`MatchPhase` and `Match` (its header now points at `practice.ts`), and
dropped the imports only `createMatch` used: 253 lines (was 328),
`practice.ts` 84. Docs: the code map (`practice.ts`), `ARCHITECTURE.md`'s
`createMatch` line.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,993.68 kB, gzip
1,402.60 kB); `npm test` 258 passed; check all pass in 290.07 s (Classic's
four and the two custom pins as before; digests `227c4ce7`/`8913ad26`).
Build id `6c670eb229a7`.

### 8.4 Screens (2026-10-09)

- `screens/lobbies/Lobby.tsx` (477 → 279 lines): `SlotGrid.tsx` (the
  players count, the two columns and their headers, each slot and its menu;
  the owner's crown), `SettingsCard.tsx` (the arena, the settings lines, the
  owner's Edit), `InviteCard.tsx` (the code, Copy link, Reset), the markup
  moved as it was, each rendered where it was (fragments, so the DOM is the
  same). New `kit.ts`: the class names (`keycap`, `label`, `PRIMARY`,
  `SECONDARY`) and `modeOf`/`traitsOf` the parts share (a card importing
  `Lobby.tsx` back would be a cycle). `SlotGrid` counts the people itself
  (the waiting room's `people()` stayed with its other users). The slot
  menu's state stays in `Lobby.tsx` (its keys close it).
- `screens/GameCanvas.tsx` (376 → 256 lines): `LoadingOverlay.tsx`,
  `PauseMenu.tsx` (with `MatchMenu`, practice's and online's), `ExitConfirm.tsx`
  (a lobby's match, Classic, practice). The `startGame`/dispose effect, the
  link closing and `release` stay where they were.
- Accessible names unchanged (the browser matches click `Play`,
  `+ Create lobby`, `Advanced`, `More players`, `Create lobby`, `Ready`,
  `Start match`).
- `hud/Hud.tsx` (745 lines) is not split: **departure**, the plan's optional
  part; its markup and its per-frame writes are one `data-hud` contract,
  and a split moves the hot path for no change. Listed for stage 11.
B, screenshot pairs (`capture.mjs` gained `loading` and `exit-confirm` in the
scenery block): before (the step stashed, `stage8-before/`), after
(`stage8a/`): `loading`, `pause-settings`, `lobby-form-advanced`,
`lobby-list`, `lobby-onegun-form` 0.0 %; `waiting-room`,
`lobby-onegun-room` 0.1 %; the hints 0.2 %; `edit-tdm` 0.3 %, `edit-ffa`
0.4 %; `exit-confirm` 0.6 % (the arena behind the dialog);
`board-tdm`/`tdm-again` 0.3 %, `results-tdm-win` 0.8 %, `hud-tdm`,
`death-board` 3.0 %, the scenery shots by where items fell (the scene).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,995.12 kB, gzip
1,403.12 kB); `npm test` 265 passed; check all pass in 290.20 s (Classic's
four and the two custom pins as before; digests `227c4ce7`/`8913ad26`).
Build id `5ec93e7d582e`.

### 8.5 `server/server.ts`: the latency simulator (2026-10-09)

New `server/netsim.ts`: `createNetsim({ lag, jitter, stall }, started)`
returns `{ delayed, held }`: the jitter's own seeded stream (`0x51ed`),
`stallEnd` and the one-way `held` link, moved as they were from
`server.ts`. `server.ts` (385 → 358 lines) makes it where `started` was
measured (the stream was made a few lines earlier, before `seating`; a
stream's draws don't depend on when it's made) and uses `delayed`/`held` as
before. `netplay.check` drives it (32 checks, its rough link). Docs: the
code map (`netsim.ts`).
Gate A, first run: everything green but `client.check`: `Error: client: a
page searches, is found, accepts, and hears each step` (exit 1 at 112 s).
Then `node --experimental-webstorage dist-server/client.check.js`, as
`server:check` runs it, five times, and three times without the flag: `client
ok (47 checks)` each time. The cause is in the check, not this step: its two
raw pages accept the moment they're found, and only the first acceptor is
told `accepted` before both are seated; the check asks it of page `a`, so it
fails when `b`'s accept reaches the server first. No lag is configured
there, so `server.ts` runs its direct path, which this step didn't touch.
Noted for stage 9, which moves the check into Vitest (`a` should accept
after `b` has been found, or the check ask it of the first acceptor).
Gate A, rerun: oxlint 0/0; format clean; tsc clean; build clean (3,995.12 kB,
gzip 1,403.12 kB); `npm test` 266 passed; check all pass in 290.84 s
(client 47, netplay 32; Classic's four and the two custom pins as before;
digests `227c4ce7`/`8913ad26`). Build id `446e401150d6`.

### 8.6 `sim/ai.ts` (2026-10-09)

`git mv src/sim/ai.ts src/sim/ai/think.ts` (history follows the biggest
part), then the text moved, as it was, into four modules:
- `sim/ai/brain.ts` (154 lines): the `AI` tuning table (now exported: every
  part reads it), `WEAPON_IDS`, `armBot`, `botGun`, `Agent`, `Brain`,
  `Plan`, `createBrain`, `provoke`.
- `sim/ai/perception.ts` (105): `blastRadius`, the shared ray scratch
  (`from`, `along`, `ray`: used by `feel`, `canSee`, `open`, `hiddenFrom`,
  each finishing before the next starts, as before), `feel`, `canSee`,
  `clearOfMates`, `open`, `hiddenFrom`, `pickHideout` with its `spot`.
- `sim/ai/navigation.ts` (83): `nodesInView`, `routesTo`, `travel`.
- `sim/ai/think.ts` (273): `TACTICS`, `flightTime`, `between`, the step's
  scratch (`goal`, `circling`, `weaving`, `lead`, `aimAt`, `errandAt`,
  `toAim`, `toLead`), `pickTarget`, `leadTarget`, `think`.
The one change beyond the move: `travel` wrote the module-level `goal`
that `think` then read; with the two in different files it writes the
`goal` vector it is handed (`think` passes its own, the same object), so
every statement and every `random()` draw is where it was. Importers (10:
the simulation, the roster, the two adapters, the room, `matchMode.ts`, the
weapon test and three checks) import by name from the module that has it;
the probes (`tdm-metrics.js`, `ffa-metrics.js`) take `createBrain` from
`sim/ai/brain.ts`. Docs: the code map, `ARCHITECTURE.md`, `GAME_LOOP.md`,
`STATE_OWNERSHIP.md`.
**Departure:** the plan's "a 2-minute practice match per difficulty,
watched" was not watched by eye (headless pages run at about 2 frames a
second); `bots.check` (every difficulty on the city yard: never stuck or
parked, both guns, cover and ambushes, harder wrecks more), the pins and
the stage's probe run stand in.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,995.13 kB, gzip
1,403.13 kB); `npm test` 269 passed; check all pass in 290.04 s (bots 21:
kills a minute easy 7.8, normal 13.8, hard 17.8; tdm 182; Classic's four and
the two custom pins as before; digests `227c4ce7`/`8913ad26`). Build id
`44d0988aa49f`.

### Stage 8 — end gates (2026-10-09)

**B:** after 8.2 (the stores: `browser-match.mjs custom`, a reload during a
Classic search) and 8.4 (the screens: pairs before and after), as the
stage file asks; logged there.
**C:**
- `node scripts/arena-parity.mjs`: `ok scrapyard 227c4ce7 (expected
  227c4ce7)`, `ok city 8913ad26 (expected 8913ad26)`.
- Balance probe, team deathmatch "even" on The City, 10 matches: 128.9
  kills a match (winner 70.7, loser 58.2), overtime 2 of 10, blue 1 win,
  the player (Minigun) 14.9 kills / 17.2 deaths; `waitMismatches 0`,
  `alternationErrors 0`; kills a minute by phase 16.5, 13.2, 11.0, 10.0.
  Inside stage 3's code's range (126.6–129.6). The first try failed at
  once with `net::ERR_CONNECTION_REFUSED at http://localhost:3000/`: the
  dev server had just been restarted (its process 1:47 old a minute later,
  not by me); the retry ran.
**D:** this entry, and one per step above.
Production files over about 450 lines, outside the plan's exceptions
(`city.ts` 933, `recipes.ts` 690, `scrapyard.ts` 667, `kit/props.ts` 567,
`ffa/rules.ts` 561), each with its reason:
- `hud/Hud.tsx` 745: the markup and its per-frame writes are one
  `data-hud` contract; the optional split was left (8.4).
- `server/room.ts` 617: one match (step, seats, the fair-play watch, the
  record, what goes out) after the plan's split (8.1).
- `net/protocol.ts` 559: the match's wire at its path; the pre-lobby file
  is 556 lines under today's Prettier (6.3).
- `server/lobbies.ts` 520: the pure lobby service, one state machine the
  analysis says to keep whole.
- `view/sounds.ts` 472: every sound's synthesis recipe, a content table like
  `recipes.ts`.

## Stage 8 — done (2026-10-09)

`server/journal.ts` (the one persisted format) and `server/inputs.ts` (the
input queue, tested) out of the room, one `custom` room option;
`net/sessionSocket.ts` (what the two stores shared, tested with fake
timers); practice's match in `runtime/practice.ts`; the waiting room and the
gameplay screen in parts; the latency simulator in `server/netsim.ts`;
`sim/ai/` in four modules. `step()`, `think()` and the frame untouched
statement for statement. `npm test` 269. Every pin, digest and fixture as
at baseline; `PROTOCOL` 6. Build id `44d0988aa49f`. Departures: `room.ts`
and `Hud.tsx` over 450 (above); `travel` takes its goal vector (8.6); the
practice matches per difficulty not watched by eye (8.6); `client.check`'s
accept-order race, for stage 9 (8.5).

## Stage 9 — One test runner

### 9.1 Pure and fast (2026-10-09)

Each script `git mv`'d to its Vitest file, then converted by a scratch tool
(`shots/tools/check2test.py`), the same way for every file: the script's
`check(ok, label)` no longer throws but records `[label, ok]`, and the file
ends in `describe(<name>, () => it.each(checks)('%s', (_, ok) =>
expect(ok).toBe(true)))`: each check is one test with its label, in the
order it ran, with one `expect`. Everything else in the scripts (inputs,
seeds, clocks moved by hand, the order) is as it was; their headers say
"Tests for" and no longer how to run them. One label changed:
`protocol`'s "under plain node there is no build id: dev" is "under the
unit tests there is no build id: dev" (Vitest defines `__BUILD__` as
`'dev'`). `loading`'s zero-delay `setTimeout` yields stay (a yield, not a
timed wait).

| Script | File | Script's count | Vitest's |
|---|---|---|---|
| `src/sim/ai.check.ts` (router) | `src/sim/ai/navigation.test.ts` | 4 (it printed `router ok`) | 4 |
| `src/net/chat.check.ts` | `src/net/chatCommand.test.ts` | 14 | 14 |
| `src/net/protocol.check.ts` | `src/net/protocol.test.ts` | 96 | 96 |
| `server/fairplay.check.ts` | `server/fairplay.test.ts` | 10 | 10 |
| `server/matchmaker.check.ts` | `server/matchmaker.test.ts` | 63 | 63 |
| `server/lobbies.check.ts` (custom) | `server/lobbies.test.ts` | 73 | 73 |
| `src/modes/ffa/ffa.check.ts` | `src/modes/ffa/rules.test.ts` | 152 | 152 |
| `src/modes/tdm/tdm.check.ts` | `src/modes/tdm/rules.test.ts` | 182 | 182 |
| `src/runtime/loading.check.ts` | `src/runtime/loading.test.ts` | 23 | 23 |

`package.json`'s `check` runs only what's left (`bots`, `simulation`,
`server:check`). `npm test`: 877 = 269 − 9 (`repo.test.ts`'s "is run" rows
of the nine scripts gone) + 617. The code map's "Checks" list waits for 9.5.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,995.13 kB, gzip
1,403.13 kB); `npm test` 877 passed; check all pass in 290.53 s (bots 21,
simulation 58, arena 80, server 172, client 47, netplay 32; Classic's four
and the two custom pins as before; digests `227c4ce7`/`8913ad26`). Build id
`44d0988aa49f` (unchanged: tests aside).

### 9.2 Simulation (2026-10-09)

Converted the same way:

| Script | File | Script's count | Vitest's |
|---|---|---|---|
| `src/sim/simulation.check.ts` (the two yard pins asserted, as before) | `src/sim/simulation.test.ts` | 58 | 58 |
| `src/sim/bots.check.ts` | `src/sim/bots.test.ts` | 21 | 21 |

`bots` still prints its kills a minute, now from its suite's `afterAll`:
`bots: kills a minute: easy 7.8, normal 13.8, hard 17.8`. Vitest hid
whatever a passing file printed (the default reporter); `vitest.config.ts`
sets `silent: false`, so these lines (and, in 9.3, the pins) show in
`npm test`'s output. `check` runs `server:check` alone. The scratch gate
script now keeps `npm test`'s output and prints those lines from it.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,995.13 kB, gzip
1,403.13 kB); `npm test` 954 passed in 6.1 s (877 − 2 "is run" rows + 79;
bots 7.8/13.8/17.8); check all pass in 282.28 s (arena 80, server 172,
client 47, netplay 32; Classic's four and the two custom pins as before;
digests `227c4ce7`/`8913ad26`). Build id `44d0988aa49f`.

### 9.3 Integration, and 9.4 scripts and CI (2026-10-09)

Converted the same way, to a Vitest project `integration`:

| Script | File | Script's count | Vitest's |
|---|---|---|---|
| `server/arena.check.ts` | `server/arenas.test.ts` | 80 | 80 |
| `server/server.check.ts` (Classic's four and the two custom pins, asserted and printed) | `server/server.test.ts` | 172 | 172 |
| `server/client.check.ts` | `server/client.test.ts` | 47 | 47 |
| `server/netplay.check.ts` | `server/netplay.test.ts` | 32 | 32 |

`client` and `netplay` ended in `process.exit(0)` (open handles under
plain node); Vitest refuses it ("process.exit unexpectedly called"), so it
went, and both files exit cleanly in their fork. Run alone: arenas 2.9 s,
server 74.5 s, client 28.5 s, netplay 178.0 s.
`vitest.config.ts` has two projects: `unit` (`__BUILD__` `'dev'`, every test
but the four) and `integration` (the four; `pool: 'forks'`,
`fileParallelism: false`, `testTimeout`/`hookTimeout` 600 s, `execArgv:
['--expose-gc', '--experimental-webstorage']` as `server:check` ran them,
`sequence.groupOrder` 1 so it runs after `unit`). Its `__BUILD__` is
`buildId()`, the tree's own, as the bundle had it: under `'dev'` the
strict-server case ("lets in its own build") can't hold.
**Departure:** 9.4 landed in the same commit: with the last `.check.ts`
gone, `repo.test.ts`'s "finds the checks" fails, so the scripts and the
guard had to change with them.
- `vite.server.config.ts` `ENTRIES`: `main`, `load`, `replay`.
- `package.json`: `check` and `server:check` are gone (no alias); `npm test`
  runs both projects.
- `repo.test.ts`: "one test runner: no *.check.ts is left" in place of the
  list of scripts.
- `.github/workflows/ci.yml`, the game job: `npm test` in place of `npm run
  check` then `npm test`. `deploy.yml` still excludes `*.check.js` when it
  copies `dist-server/` (nothing matches now); left for stage 11.
- The scratch gate script runs `check` only while the script exists.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,995.13 kB, gzip
1,403.13 kB); `npm test` 1281 passed (30 files) in 287.3 s (954 − the 5
"is run" rows + 1 + 331): bots 7.8/13.8/17.8, Classic's four and the two
custom pins as before, digests `227c4ce7`/`8913ad26`. Build id
`44d0988aa49f` (unchanged).

### 9.5 Docs (2026-10-09)

- `game/AGENTS.md`: the commands (`npm test` runs both projects;
  `server:build` builds the server, the capacity tool and the replay
  runner; no `server:check`); "Checks" is "Tests": the two projects, what
  they print, then a line per folder of what its tests cover; the "Tests"
  line under "Where this project departs from the shared guides" is gone
  (the project follows `ts/testing.md` now); the code map's "a check" and
  "the checks' page".
- Root `README.md` (the game's verify line), `.claude/work/net/NET_RUNBOOK.md`
  (`npm test`; the digests printed by `npx vitest run
  server/arenas.test.ts`), `NET_ARCHITECTURE.md` ("Tests", `server.test.ts`,
  `arenas.test.ts`), `arch/ARCHITECTURE.md` ("Tests and build", and four
  test paths), `arch/MODULE_BOUNDARIES.md` (the guard: no `*.check.ts`
  comes back). Plans, prompts, reports and logs keep their paths (history).
- Code comments that named a check script (14, in `chatCommand.ts`,
  `protocol.ts`, `items.ts`, `matchSettings.ts`, `loading.ts`, `scoring.ts`,
  `simulation.ts`, `room.ts`, `lobbies.ts`, `netsim.ts`, `fairplay.ts`,
  `replay.ts`, `matchmaker.ts`, `auth.ts`) name the test, or lose the "the
  self-checks run this under plain node" aside. Comments only: `git diff` on
  `src/` and `server/` holds no other line; the build id moves with them, as
  it does with any source change.
- 9.6 (coverage) is not done: `@vitest/coverage-v8` would be a new dev
  dependency, the owner's call.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,995.13 kB, gzip
1,403.13 kB); `npm test` 1281 passed in 287.3 s (bots 7.8/13.8/17.8;
Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `da4ed4db26b2`.

### The client test's accept order (2026-10-10)

8.5's race, fixed in the test it was found in: `server/client.test.ts`'s
matchmade seat asked page `a` whether it was told `accepted`, but only the
first page to accept is told (the second's accept seats both at once), and
either page may be first. The check now asks that both pages heard
`searching` and that one of them heard `accepted`; its label is unchanged.
Test only: the build id doesn't move.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,995.13 kB, gzip
1,403.13 kB); `npm test` 1281 passed (30 files) in 286.5 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `da4ed4db26b2` (unchanged).

### Stage 9 — end gates (2026-10-10)

**Steadiness** (the stage file: the integration project 10 times in a row
while another `npm test` runs beside it). A scratch script ran `npx vitest
run --project integration` ten times, one after the other, at 7e85d4e,
while a loop ran `npx vitest run` (both projects) beside it; the loop's
runs overlap the ten in order (a beside run takes about 5 s longer), and
the one under way after the tenth was stopped.

| Run | Integration project | Rough link: p50, recovery | Crossing shots: wake / clear | `npm test` beside |
|---|---|---|---|---|
| 1 | 331 passed, 283 s | 2, 32 steps (534 ms) | miss, 5 ahead / hit, 1 ahead | 1281 passed, 289 s |
| 2 | 331 passed, 281 s | 2, 40 steps (667 ms) | miss, 4 ahead / hit, 1 ahead | 1281 passed, 287 s |
| 3 | 331 passed, 282 s | 2, 35 steps (582 ms) | miss, 5 ahead / hit, 2 ahead | 1281 passed, 287 s |
| 4 | 331 passed, 282 s | 2, 38 steps (635 ms) | miss, 4 ahead / hit, 2 ahead | 1281 passed, 287 s |
| 5 | 331 passed, 282 s | 2, 40 steps (667 ms) | miss, 5 ahead / hit, 1 ahead | 1281 passed, 287 s |
| 6 | 331 passed, 281 s | 1, 32 steps (521 ms) | miss, 5 ahead / hit, 2 ahead | 1281 passed, 288 s |
| 7 | 331 passed, 282 s | 2, 39 steps (650 ms) | miss, 4 ahead / hit, 2 ahead | 1281 passed, 287 s |
| 8 | 331 passed, 281 s | 2, 39 steps (650 ms) | miss, 5 ahead / hit, 2 ahead | 1281 passed, 286 s |
| 9 | 331 passed, 281 s | 2, 60 steps (1000 ms) | miss, 4 ahead / hit, 1 ahead | 1281 passed, 287 s |
| 10 | 331 passed, 281 s | 2, 59 steps (984 ms) | miss, 4 ahead / hit, 1 ahead | stopped after the tenth |

Every run passed. The rough link recovered in 32–60 steps (bound 90); the
nine runs beside it in 30–62. Stage 0's ten (0.2) recovered in 32–59: the
move to Vitest kept the steadiness.
**A:** after every step. **B:** not due: no screen, HUD, view, runtime or
store changed. Across the stage, `git diff 92b5d52..HEAD` on `src/` and
`server/` (tests and `browser.ts` aside) changes comment lines only.
**C:** not due, for the same reason: no arena, physics, `sim/` or `modes/`
code changed.
**D:** this entry. CI isn't run (commits stay local); gate A runs its game
job's steps (`lint`, `format:check`, `build`, `npm test`) on Node 26 here,
CI on 24.

## Stage 9 — done (2026-10-10)

One test runner: Vitest, two projects (`unit`; then `integration`, one file
at a time in forks, with the tree's build id). No `*.check.ts` is left
(`repo.test.ts` guards it), `npm test` runs every test (1281 in 30 files,
about 287 s), and CI's game job runs it. Every count matches its script's
(the tables in 9.1–9.3), and the integration project held ten loaded runs
in a row. Every pin, digest and fixture as before; `PROTOCOL` 6. Build id
`da4ed4db26b2`. Departures: 9.4 landed in 9.3's commit; 9.6 (coverage) not
done, a new dev dependency being the owner's call; `deploy.yml` still
excludes `*.check.js` (stage 11); 8.5's accept-order race fixed in the test
(above).

## Stage 10 — Content ready

### 10.1 Seats honour the vehicle (2026-10-10)

- `sim/simulation.ts`: `changeVehicle(world, c, vehicle)` turns the machine
  in a seat into another vehicle where it stands: its body and vehicle
  controller leave the world; the new vehicle's (`createCar`) take their
  place (`placeCar`: level, facing the way the old one faced, at rest), in or
  out of play and kinematic or not as the old one was; its pose read back,
  its `last` pose with it; its hull keeps its share (`health / maxHealth`)
  of the new armour. Between steps only; false, and nothing changes, when
  the seat already is that vehicle. `enlist` sets nothing else up on a body,
  so this is all a new one needs. `bodyOwner` finds a collider's machine
  among the seats as they stand (a `find` over at most 12) instead of a map
  built once, since a seat's body can now change.
- `server/room.ts`: `join` seats the person in the vehicle they chose;
  Classic's `leave` gives the bot back its own (the roster's, kept per seat
  as `botVehicles`). The plan names `takeWheel` too: the swap happens at the
  join, before the welcome, so the welcome's line-up already says it and
  the page builds it; at the first input the bot only lets go of the wheel.
- `modes/roster.ts`: `SeatPlan`'s person entries carry the vehicle they come
  in (`vehicle?`); a custom seat waiting for its person is built in it.
  `server/seating.ts`: a lobby's start fills it from each person's hello.
- The optional `vehicles` match setting (one vehicle for everyone) is not
  done: no lobby asks for it.
With one vehicle every `changeVehicle` call is a no-op, so rooms play as
before; the one new thing written is the vehicle in a lobby room's plan, in
its replay's header.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,995.15 kB, gzip
1,403.15 kB); `npm test` 1281 passed (30 files) in 287.0 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `6e8ada8e3827`.

### 10.2 The wire and the journal (2026-10-10)

- `net/protocol.ts`: `PROTOCOL` 7. `ro` (a seat changed hands) carries the
  seat's `vehicle`; the welcome's line-up already named each seat's.
- `server/room.ts` sends it on a join and on a leave. The journal's `join`
  line is `[seat, uid, name, weapon, vehicle]`; `server/replay.ts` seats
  the person in it through `parseLoadout`, so a line written before has no
  vehicle and gets the default's (the replay runner reads files kept for
  `REPLAY_DAYS`, some from older builds).
- `net/client.ts`: a `ro` naming another vehicle swaps the seat's body in
  the page's world too (`changeVehicle`: kinematic there, as the server's
  word moves it) and asks the view to `refit`. `view/view.ts`'s `refit`
  already rebuilt the model from `MODELS[c.vehicle]`; its comment says so.
- Fixtures changed on purpose, in this commit, `src/net/protocol.test.ts`:
  the custom match's welcome says `"v":7` (was 6), and the `ro` fixture
  gains `"vehicle":"razor"` between `weapon` and `uid`, where the type
  and the room put it. No other fixture moved.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,995.81 kB, gzip
1,403.39 kB); `npm test` 1281 passed (30 files) in 287.0 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `2be1594436ce`.

### 10.3 Bots' vehicles (2026-10-10)

`modes/roster.ts`: each seat draws a vehicle, one draw a seat in seat
order, from a stream of its own (`createRng(seed ^ 0x6a09e667)`), out of the
registry as it stands when the roster is made (`Object.keys(VEHICLES)`).
Bots drive it; a custom seat waiting for a person whose plan entry names no
vehicle is built in it. The guns' stream (`0x2545f491`) and the
simulation's are untouched, so no draw that exists moves; with one vehicle
every seat draws the Razor and every pin holds. Practice and the server
share `recruits`, so practice's bots draw too. The roster's header named
`match.ts` for practice's seat 0: `practice.ts` since 8.3.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,995.86 kB, gzip
1,403.41 kB); `npm test` 1281 passed (30 files) in 287.1 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `8ddf31c37bf8`.

### 10.4 Tests (2026-10-10)

`server/testVehicle.ts`: a second vehicle for the tests alone, the hauler
(2,000 kg, 140 armour, wider and longer than the Razor on 0.55 m wheels,
its turret higher). `addHauler()` puts it in `VEHICLES` and returns what
takes it out; each test that needs it adds it and takes it out again, so
nothing else sees it (bots draw from the registry as it stands: the pins
are played without it). `server/browser.ts` takes a `vehicle` option.
- `server/server.test.ts`: the tripwire is gone (it failed on purpose the
  day `VEHICLES` had a second entry, until rooms seated people in theirs).
  In its place, "two vehicles", at the end of the file after every pin:
  - a Classic room (team deathmatch on The City, seed 4040): bots draw
    both (`hauler, razor, hauler, razor, hauler, razor, razor, razor`); a
    person takes seat 4 mid-match in the other vehicle (hauler to razor):
    its body replaced 0.20 m from where it stood (`placeCar` lifts it
    0.2 m), the old body no longer valid and the world's body count the
    same, its hull's share kept; a round that strikes the new body is the
    seat's; the others hear `ro` with the vehicle; the person drives it
    (15.0 m in 4 s); they leave and the bot takes the seat back in its own,
    the others told; the room replays to the bit (14,700 steps), records
    the same;
  - a custom room (free for all on the Scrapyard, six seats: two people in
    different vehicles, three bots, one empty): each person's seat built in
    the vehicle its plan names, no body replaced as they sit down; replayed
    to the bit (11,040 steps).
  The first try had one failure: "the old one out of the world" was
  `!world.getRigidBody(oldHandle)`, and Rapier's JS body map looks a handle
  up by its index alone, so the new body in the freed slot answered. The
  check holds the old body instead (`isValid()` false) and counts the
  world's bodies.
- `server/netplay.test.ts`: the hauler at 100 ms each way ±10: the server
  seats the page in it and the page builds and predicts it; 15 s of driving
  with 0 corrections and a maximum error of 0.008 m (0 inputs late, 0
  dropped).
- `server/client.test.ts`: a lobby member comes in the hauler; the lobby's
  match seats them in it, and the owner's page is told so in its welcome.
- `server/arenas.test.ts`: every start's clearance is tried with every
  vehicle's collision shells (the Razor's alone today).
- `modes/roster.ts`: `BOT_VEHICLE` is gone; nothing read it after 10.3 but
  the tripwire.
Counts: server 172 → 181 (the tripwire out, 10 in), netplay 32 → 35,
client 47 → 48, `repo.test.ts` one more file (the hauler's).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,995.86 kB, gzip
1,403.41 kB); `npm test` 1295 passed (30 files) in 309.7 s (1281 + 14;
the new blocks add about 22 s, most of it the hauler's 15 s drive; bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `e716099c9690`.

### 10.5 Garage (2026-10-10)

`screens/Garage.tsx`: a vehicle pager like the weapon's, over `VEHICLES`'
ids: once there are two or more, the vehicle page shows the place
(`· 1 / 2` after the kind) and a `Pager` ("Previous/Next vehicle"), and ←→
page through them while Vehicle is picked (the hint bar says so). The spec
sheet and the turntable's model already follow `loadout.vehicle`. Both
pagers step with one helper, `turn(ids, at, step)`. With one vehicle
nothing shows and ←→ do nothing there, so the garage is as it was. The
pager with two vehicles is tried in gate B (stage end, a scratch second
vehicle).
**B:** `shots/capture.mjs` gained `garage-vehicle` (the vehicle page as the
garage opens). `stage10-before/` (at a84ec09) against `stage10a/`, pixels
differing by more than 40: `menu` 0.0 %, `garage-vehicle` 0.1 %,
`garage-minigun` 0.5 %, `garage-rocketpod` 0.8 % (the turntable's angle,
as in stage 4's pairs); looked at side by side, the same.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,996.20 kB, gzip
1,403.51 kB); `npm test` 1295 passed (30 files) in 309.9 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `07e80dbf6fe2`.

### 10.6 The new-map checklist as tests (2026-10-10)

The stage file's list, against `server/arenas.test.ts`:
- every mode it hosts at the largest size: there (stage 0's check);
- six starts a base: there (two bases of at least 6);
- at least 12 FFA spawns: it asked for 8. Now a start for every machine of
  the biggest free for all a lobby may ask for, read from
  `MODE_TRAITS.ffa.sizes` (12): 16 on both maps;
- a nav graph in one piece: there;
- item spots clear of starts: not there. Now room for a full drop of
  pickups: `itemSpots` over every start (the spawns and both bases, as
  team deathmatch passes them; free for all passes the spawns alone, so
  it has at least as many) gives at least `SUPPLY.maxActive` (16): 44 on
  the Scrapyard, 50 on The City;
- a headless build: there ("nothing left to look at", built once and
  kept);
- a digest: there (the same build after build, and `digests.json`'s).
Added, since a new map would miss it with nothing failing: its preview card
(`MAPS[id].image`) is a file in `public/`. Spawn clearance is already
tried with every vehicle (10.4). The test went from 80 to 84.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,996.20 kB, gzip
1,403.51 kB); `npm test` 1299 passed (30 files) in 309.7 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `07e80dbf6fe2` (unchanged: a test). The
first run passed too but took 2,865 s: the machine went to clamshell sleep
at 01:32 (`pmset -g log`), five minutes into it; run again awake.

### 10.7 Docs (2026-10-10)

`.claude/work/arch/ARCHITECTURE.md`, "How to add …":
- **A vehicle**: the two files, then what follows by itself (the garage's
  pager and turntable, the loadout's parser, a room seating the person in
  it through `changeVehicle`, the welcome, `ro` and the journal naming it),
  what moves (bots draw from the registry, so the yard's and Classic's
  pins re-pin in a commit of their own that shows the old hashes without
  the entry) and the tests that hold it (every start's clearance, the
  two-vehicle tests, whose test-only hauler a real one can replace).
- **A map**: where it's listed and built (the arena screen, the lobby
  form, the server's seating and its headless build), its digest in
  `digests.json` and who holds the browser and the server to it, and the
  checklist the arena test holds it to (10.6), its preview card included.
- **A weapon**: what follows by itself (the wire, the record, the replay,
  the one-gun setting), the re-pin, and a new `kind`: the places the
  compiler lists (stage 4's scratch `mine`, at today's paths: `fire` and
  the recorder's `fired`, `TACTICS` and `flightTime` in `sim/ai/think.ts`,
  `blastRadius` in `sim/ai/perception.ts`, `FIRE_CUE` and `SPINS`, the
  garage's `ROUND` and `kindSpecs`) and what it can't (the projectile in
  the simulation's state and step, its wire event and recorder line, the
  view's effects, the bots' use of it).
- `game/AGENTS.md`: the code map names `changeVehicle` and
  `server/testVehicle.ts`; "Tests" names the new-map checklist, the two
  vehicles in `server.test.ts` and the second vehicle in netplay.
The rest of the living docs is stage 11's.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,996.20 kB, gzip
1,403.51 kB); `npm test` 1299 passed (30 files) in 310.4 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `07e80dbf6fe2` (docs only).

### Stage 10 — end gates (2026-10-10)

**B**, item 5 (Classic) and 6 (custom) with two vehicles, as the stage file
asks. A scratch worktree of `076b6fe` (10.6; 10.7 is docs), never
committed: a second vehicle in `VEHICLES` and `MODELS` (the hauler's
numbers from `server/testVehicle.ts`, the Razor's body on its chassis), and
`scripts/browser-match.mjs` with page `a` (Classic) and page `d` (custom)
keeping the hauler in `scrapyard.loadout`, a check of each seat's vehicle
and wheel radius on both pages, and a garage page first.
- Classic, run 1: every check ok, 127.2 s. The garage pages to the second
  vehicle with →, shows `Scratch / gate B · 2 / 2`, its sheet and the ←→
  Vehicle hint, and keeps the loadout. Both pages in one room (`a` seat
  4); `a` in the hauler and `b` in the razor on both pages; `a`'s car,
  held on W, drove 55.0 m on `b`'s screen; `a` left and seat 4 was
  "Hexbolt" again, in the hauler: that seat's bot had drawn the hauler, so
  no body was replaced either way.
- To make the takeover swap, the scratch roster put every bot in the razor.
  Run 2: `!!  a held W for 12 s: on b's screen a's car drove 0.1 m`, every
  other check ok (`a` took seat 0 mid-match; its page shows the same
  position at the join and after, hull 140/140). Rerun once, stage 0's
  rule for this check: run 3, every check ok, 127.3 s. `a` took seat 4
  from a razor bot in the hauler and drove 17.9 m on `b`'s screen (one
  respawn jump left out); `a` left, and on `b`'s page seat 4 was "Hexbolt"
  in the razor again, wheels 0.5 m: the page swapped the body back and
  rebuilt the model.
- Run 2's cause, looked for server-side with a scratch test (not kept): 40
  takeovers (both maps, seeds 1–20, after 10 + seed seconds of bots; the
  person in the hauler on odd seeds, the razor on even), then full throttle
  straight ahead for 4 s. 14 replaced the body, 26 didn't. Four moved less
  than 3 m while alive: three without a swap, one with. A taken-over
  machine left nose to something doesn't move, swap or not: the check's
  known flake (0.1), not the swap.
- Custom: every check ok, 86.9 s. In both of the lobby's matches, `c` in
  the razor and `d` in the hauler on both pages; `d`'s screen shows the
  hauler at GO, hull 140.
**C:** `node scripts/arena-parity.mjs`: `ok scrapyard 227c4ce7 (expected
227c4ce7)`, `ok city 8913ad26 (expected 8913ad26)`.
- Balance probe, team deathmatch "even" on The City, 10 matches: 124.8
  kills a match (winner 66.0, loser 58.8), overtime 1 of 10, blue 8 wins,
  the player (Rocket Pod) 18.1 kills / 14.9 deaths; `waitMismatches 0`,
  `alternationErrors 0`; kills a minute by phase 15.8, 13.0, 11.0, 9.3.
  Under stage 3's code's five runs (126.6–129.6), so run again (86 s): 128.9
  kills a match (winner 67.2, loser 61.7), overtime 2 of 10, blue 5 wins,
  the player (Minigun) 17.2 / 15.8; 0 and 0; by phase 16.5, 12.8, 11.4,
  9.8. Each match draws its own seed, so a run of ten moves by a few kills;
  the pins, which replay fixed seeds, held at every step.
**D:** this entry, and one per step above.

## Stage 10 — done (2026-10-10)

A person plays the vehicle they picked, in Classic (a bot's machine taken
over in it, the bot's own given back) and in a custom lobby (the seat
built in it), and every page and every replay builds the same machine:
`changeVehicle`, `SeatPlan`'s vehicle, `ro` and the journal's `join`,
`PROTOCOL` 7. Bots draw their vehicles from a stream of their own. The
garage pages through vehicles once there are two. The arena test holds a
new map to the checklist, and the how-tos give the steps for a vehicle, a
weapon and a map. With one vehicle every pin, digest and the play are as
before; the fixtures changed on purpose in 10.2 (the welcome's protocol,
`ro`'s vehicle). `npm test` 1299 (+18), about 310 s. Build id
`07e80dbf6fe2`. Proven on a test-only second vehicle (`server/testVehicle.ts`)
and, in the browser, a scratch one. Departures: no `vehicles` match
setting (optional, nothing asks for it); the swap happens at `join`, not
`takeWheel`; an old replay's `join` line gets the default vehicle; the map
checklist gained the preview card; 10.6's first gate A slept through
clamshell sleep and was run again; gate B's Classic needed its one rerun.

## Stage 11 — Cleanup

### 11.1 Living docs, final (2026-10-10)

Every backticked path in `game/AGENTS.md`, the root `AGENTS.md`, the five
`arch/` docs and `net/NET_ARCHITECTURE.md` was looked up on disk (a scratch
sweep): the one that no longer exists is `LOADING_ARCHITECTURE.md`'s
`game/loading.check.ts`. Then each doc against the code:
- `ARCHITECTURE.md`: "How a match starts" says how practice seats everyone
  (the roster: guns and vehicles drawn) and builds, in order, and how an
  online match is seated from the welcome and runs through the same
  `playMatch`; randomness names the bots' guns and vehicles; "pure,
  tested" where it said checked; a new how-to, **a match setting**
  (`MatchSettings`, `classic`, `CUSTOM`, `checkSettings`, the form and the
  card, what carries it and what re-pins); "Future multiplayer (Nakama)"
  (it said not implemented) gives way to "Online play", a paragraph and a
  link to `NET_ARCHITECTURE.md`.
- `NET_ARCHITECTURE.md`: written as a drop-in section for `ARCHITECTURE.md`
  "the owner merges"; now a page of its own, linked both ways, headings one
  level up. "Who owns what" names vehicles among a seat's; "Adding content,
  online" says how a vehicle travels and is seated; "the checks" are the
  tests.
- `MODULE_BOUNDARIES.md`: the levels table as `.oxlintrc.json` has them
  (`sessionSocket` and `scenery.ts` at level 4; the wire's five files at
  3); tests, not checks.
- `STATE_OWNERSHIP.md`: a row for a seat's vehicle and body; the match
  seed's owner (practice's, or the room's online) and the roster's stream;
  the mode's scenery made and disposed with the match; the teardown order;
  a section for the page's side of an online match.
- `GAME_LOOP.md`: the frame's `source.receive` and `source.place`; a step
  is the source's (practice: the simulation, as the server's room; online:
  the page's prediction and world).
- `LOADING_ARCHITECTURE.md`: the match is made by `createMatch` or
  `createOnlineMatch`; its validation section says it is that work's
  record, and where the check it names went.
- `game/AGENTS.md`: a mode's folder holds tests, not a check.
The config the docs point to: `.oxlintrc.json` lost its 13 `*.check.ts`
excludes (no such file can come back: `repo.test.ts`) and puts
`net/limits.ts` at level 3 with the wire that imports it (it was held only
to level 4's rules, though the server imports it). `.github/workflows/deploy.yml`
no longer excludes `*.check.js` from the server's bundle (stage 9 left it:
no such file is built), and its comment names what goes.
Gate A: oxlint 0/0 (189 files, 123 rules); format clean; tsc clean; build
clean (3,996.20 kB, gzip 1,403.51 kB); `npm test` 1299 passed (30 files)
in 310.0 s (bots 7.8/13.8/17.8; Classic's four and the two custom pins as
before; digests `227c4ce7`/`8913ad26`). Build id `07e80dbf6fe2` (no source
changed).

### 11.2 Public surface (2026-10-10)

Recounted first, on `14fcd67`, with stage 1.3's sweep
(`shots/tools/sweep.mjs`: every relative import in `src/`, `server/` and
the root's `.ts` files resolved; an export read by no other file, tests
included, is listed): 90 exports read only in their own file, in 53 files
(the plan's 67 and 1.3's 87 were counted on older trees), and two read
nowhere at all: `HotZone` (`modes/ffa/zone.ts`) and `Pickups`
(`modes/items/pickups.ts`), `ReturnType` aliases left when stage 7 moved
the scenery out of the mode contract. Both deleted.
Of the 90, 35 stay exported: what a caller passes or implements, which it
may need to name. The `…Options` types (`GroundOptions`, `FfaOptions`,
`SupplyOptions`, `ClientOptions`, the eight material recipes', `OnlineOptions`,
`MatchOptions`, `GameOptions`, `SimulationOptions`, `PilotOptions`,
`ViewOptions`, `BrowserOptions`, `RecordsOptions`, `SeatingOptions`,
`ServerOptions`); hooks and the room's `CustomRoom` (`LobbyHooks`,
`MatchmakerHooks`); what a match is built from (`MatchParts`,
`MatchSource`); the inputs of exported functions (`WaveInput`, `Driver`,
`TacticsView`, `ScoreRules`, `Conditions`, `ModeContext`); and the mode
contract's `ModePhase` and `SupplyView`, beside `MatchMode`.
The other 53 lose `export`:
- `content/`: `ArenaLayout` (digest), `MapInfo` (maps);
- `render/`: `SUN_DIRECTION` (environment), `Rooms` (facade);
- `sim/`: `Control` (simulation);
- `modes/`: `inside`, `FfaPhase`, `Contender`, `chooseZone` (ffa/rules;
  and its re-export of `Stats` beside `createStats`, so its own import of
  `Stats` went too: `tsc` named it); `Effects`, `Drop` (supply); `Respawn`,
  `RESPAWN`, `RespawnWaits`, `SettingsCheck` (matchSettings); `ModeTraits`
  (traits); `ModeViews` (views);
- `net/`: `ChatLine`, `ChatRoster` (chat); `ChatIntent`, `named`
  (chatCommand); `Hello` (connection); `EventCode` (events); `Asked`,
  `NOTES` (lobbies); `LOBBY_ACTIONS` (lobbyProtocol); `Unstartable`
  (lobbyRules); `NOTES` (matchmaking); `TOLERANCE` (prediction);
  `QUEUE_ACTIONS`, `ClientMessage`, `SeatInfo`, `cm`, `q4`, `clamp`,
  `Parsed` (protocol); `DELAY` (snapshots);
- `view/`: `Engine` (audio), `CHASE_CAMERA` (camera), `FeedLine` (feed),
  `Settings` (settings), `CarView` (view);
- `hud/`: `Styled` (dom);
- `server/`: `Identity` (auth), `Lobby` (lobbies), `Ticket`, `sameQueue`
  (matchmaker), `ReplayResult` (replay), `SeatRecord` (room), `Person`,
  `Joined` (seating), `originAllowed` (server).
The tsconfigs emit nothing (`noEmit`), so an exported signature may use a
type its file no longer exports. The sweep after: the 35 kept, nothing
dead, no file unread.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (3,996.21 kB, gzip
1,403.53 kB); `npm test` 1299 passed (30 files) in 310.1 s (bots
7.8/13.8/17.8; Classic's four and the two custom pins as before; digests
`227c4ce7`/`8913ad26`). Build id `04afc8e8770b`.

### 11.3 Measured again (2026-10-10)

Stage 0's numbers (0.1, at `28bc205`) against `17032ac`, by the same
commands: lines counted with `git show <rev>:<file> | wc -l` over the
`.ts`/`.tsx` files of `src/` and `server/`; the mode literals with the
analysis's Appendix B grep (`'tdm'`/`'ffa'` in `src/` and `server/`,
tests and the two mode folders aside); timings on this machine, warm.

| Measure | Stage 0 | Now |
|---|---|---|
| Production code | 117 files, 22,000 lines (23,928 after the one formatting pass, `4a2a349`) | 155 files, 24,647 lines |
| Tests | 15 check scripts, 4,867 lines; 1 Vitest file | 30 Vitest files, 7,254 lines |
| Test count | 1,006 check assertions + 1 test (0.1's table) | 1,299 tests |
| Production files over 400 lines | 13 | 14 (below) |
| Mode literals outside the modes | 39 lines in 11 files; 34 of them in 7 shared files | 6 lines in 5 files, every one where the guard allows it (`modes/ids.ts` 1, `maps.ts` 2, `App.tsx`'s first pick 1, `server/browser.ts` 1, `load.ts` 1); none in shared code |
| Import cycles, types included | 43 reports in 14 files | 0: `import/no-cycle` with `ignoreTypes: false` fails lint on one |
| Duplicates | `wrap` 5 times, `Point` 3 (and a 3-D one in `fairplay.ts`) | `wrap` and `Point` once each, in `shared/math.ts` (fairplay's is `Vector`) |
| Exported, read only by its own file | 87 (1.3's sweep; the plan says 67) | 35, every one an option or contract type (11.2) |
| Client build (raw / gzip) | `App` 3,989.97 / 1,399.72 kB, `index` 222.59 / 69.81, css 66.63 / 11.46; 132 modules | `App` 3,996.21 / 1,403.53 kB, `index` 222.59 / 69.81, css 66.44 / 11.43; 168 modules |
| Server build | main chunk 4,435.22 / 1,420.94 kB (93 modules), `main.js` 2.05 kB, beside the check bundles | chunk 4,554.59 / 1,455.53 kB, `main.js` 161.49 / 38.04 kB, `replay.js` 4.73, `load.js` 2.61 (95 modules) |
| `npx oxlint` | 0 warnings, 0 errors; 135 files, 116 rules | 0 warnings, 0 errors; 189 files, 123 rules; 60 ms (0.29 s real) |
| `npx tsc -b` | 3.54 s; 3.45 s with the build info deleted; 3.43 s warm | 3.28 s with the build info deleted; 3.25–3.29 s warm |
| `npm run build` | 3.95 s | 3.59 s |
| Tests' wall time | `npm run check` 290.4 s (then `npm test`'s one test) | `npm test` 310.1 s, both projects |

Files over 400 lines now: `content/arenas/city.ts` 933, `hud/Hud.tsx`
745, `render/materials/recipes.ts` 690, `content/arenas/scrapyard.ts` 667,
`server/room.ts` 621, `content/arenas/kit/props.ts` 567,
`modes/ffa/rules.ts` 561, `net/protocol.ts` 559, `server/lobbies.ts` 520,
`sim/simulation.ts` 476, `view/sounds.ts` 472, `net/client.ts` 445,
`screens/lobbies/Lobbies.tsx` 427, `modes/tdm/rules.ts` 401. The plan's
exceptions (`city.ts`, `recipes.ts`, `scrapyard.ts`, `kit/props.ts`,
`ffa/rules.ts`) and stage 8's reasons (`Hud.tsx`, `room.ts`, `protocol.ts`,
`server/lobbies.ts`, `sounds.ts`) cover ten. `simulation.ts` grew 32 lines
with `changeVehicle` (10.1: 444 to 476); `net/client.ts` (444, now 445),
`Lobbies.tsx` (427) and `tdm/rules.ts` (401) were over 400 before stage 8
and outside its splits.

Where the lines went: the formatting pass alone added 1,928; then 38 more
files (each its own imports and header), the mode traits and panels, the
event codec, the stores' shared socket, the tests moved out (the scripts'
counts grew by stage 0's pins and fixtures and stage 10's tests), and stage
10's seats. The client chunk grew 6.24 kB raw, 3.81 kB gzipped; the server's
`main.js` holds what the check bundles used to share with it.

**11.4, bundle weight:** not done. The plan makes it optional and the
owner's call; the numbers above are what it would start from (the client
chunk is mostly Rapier's inlined WASM, stage 11's file says about 2.9 MB).
Gate A (no file changed since 11.2's): oxlint 0/0; format clean; tsc
clean; build clean (3,996.21 kB, gzip 1,403.53 kB); `npm test` 1299
passed (30 files) in 309.7 s (bots 7.8/13.8/17.8; Classic's four and the
two custom pins as before; digests `227c4ce7`/`8913ad26`). Build id
`04afc8e8770b`.

### 11.5 Close (2026-10-10)

`PLAN.md` opens with its status: done, stages 0–11 passed their gates on
`refactor/game`; push, the pull request and the merge wait for the owner.
`.claude/work/BBMV_GAME_REFACTOR_PLAN.md` stays as the analysis.
Gate A (no file under `game/` changed): oxlint 0/0; format clean; tsc
clean; build clean (3,996.21 kB, gzip 1,403.53 kB); `npm test` 1299 passed
(30 files) in 310.1 s (bots 7.8/13.8/17.8; Classic's four and the two
custom pins as before; digests `227c4ce7`/`8913ad26`). Build id
`04afc8e8770b`.

### Stage 11 — end gates (2026-10-10)

**B:** not due: no screen, HUD, view, runtime or store changed in
behaviour (11.2 removed `export` keywords and two unused type aliases;
the bundle's size moved by 0.01 kB). **C:** not due: no arena, physics,
`sim/` or `modes/` code changed in behaviour; the pins held at every step.
**D:** this entry, and one per step above.

## Stage 11 — done (2026-10-10)

The docs describe the code as it is (11.1: the arch docs, the net
architecture linked from them, the code map; the lint config and the
deploy workflow without check-script leftovers). Only what other files
read is exported, apart from 35 option and contract types (11.2). The
before/after table is in 11.3. Bundle weight (11.4) is left to the owner.
`PLAN.md` says done. Every pin, digest and fixture as at stage 10's end;
`PROTOCOL` 7. `npm test` 1299 in about 310 s. Build id `04afc8e8770b`.
Departures: the kept exports include the mode contract's `ModePhase` and
`SupplyView` and the inputs of exported functions, not only `…Options`;
`net/limits.ts` moved to level 3 in the lint config.

## The final run (2026-10-10)

Gate B whole, on the finished tree (`85de9d2`): the local game server
rebuilt (`npm run server`: protocol 7, build `04afc8e8770b`), local Nakama
up, the dev server on `:3000`.
- `shots/capture.mjs final`, every shot: 35, no page or console error,
  586 s. Against `stage8a/`, pixels differing by more than 40: 0.0–1.0 %
  for 16 of the 20 shots both hold, `hud-tdm` 3.1 % and `death-board`
  3.2 % (the moment), `scenery-tokens` 51.8 % and `scenery-zone` 53.9 %
  (where the items and the zone fell, as in every run since stage 7).
  Exit to the garage: `window.match` undefined; in the match 496
  geometries and 193 textures, as in every run; the next match 588 / 197.
- `node scripts/browser-match.mjs custom`: every check ok, 86.8 s.
- `node scripts/browser-match.mjs`: `!!  a held W for 12 s: on b's screen
  a's car drove 0.2 m`, every other check ok; the rerun the same (0.2 m).
  Both times `a` was in seat 0, so it was looked into, with the script
  instrumented in a scratch worktree of `85de9d2` (not kept): four more
  runs, three ok (11.6 m with `a` in seat 4, 45.4 m in seat 0, 46.1 m in
  seat 4), one `!!` (0.6 m, `a` in seat 4). In that one, `a`'s page held
  throttle 1 and the server applied it (`b`'s mirror of the seat:
  throttle 1), hull 100: the room's first match had started without the
  pages (`load timeout`, both late, as SwiftShader loads them), the seat's
  bot had parked the car nose to the storage tanks (`a`'s screenshot), and
  W alone doesn't move a car against a wall. That is stage 0's run-1
  failure (0.1): the check's known flake, neither seat 0 nor this tree.
  Headless, with scratch tests (not kept): a matchmade seat 0 whose second
  page loads late drives 53–74 m in 5 s on both maps, and a car driven
  straight from any start goes 18–31 m in 3 s.

The branch is ready for the owner: push, the pull request and the merge
are theirs.

## After stage 11

The owner's list before GitHub (2026-10-10): the branch reviewed, CI
matched on Node 24, the deploy path tried locally, the held-W check made
sturdy, a check by hand on a real GPU; then coverage (9.6) and bundle
weight (11.4); then the content phase planned. Everything stays local on
`refactor/game`.

### 1.1 The branch reviewed (2026-10-10)

`git diff main...refactor/game` (238 files, +14,970 −4,911), `game/` and
the docs, looked through for leftovers: comments naming the old check
scripts or files that moved, scratch or dead code, comments the code no
longer matches. Two scratch sweeps (not kept): every file name a comment
in `src/`, `server/` and the root's `.ts` files gives, looked up on disk;
every camelCase or capitalised identifier a comment names, looked up in
the code (what was left: Rapier's, three's and the browser's names, the
docs' file names, the brief's capitals in `server/matchmaker.ts`). No
`TODO`, `FIXME`, `debugger`, `.only` or `.skip` was added; the
`console.log` lines added are the tests' prints and the tools' output.
Fixed, comments only:
- Commit 1, the known ones: `content/vehicles/vehicles.ts` (its "(Imports
  carry .ts: the simulation check runs under node.)" is every file's rule
  now; the same note gone from `net/prediction.ts` and
  `net/snapshots.ts`), `content/arenas/digest.ts` (the server and the
  tests run it, not "the server's checks"), `server/room.ts` (a fixed seed
  for the tests; the netplay test's yard, and its compensation switch),
  `server/seating.ts` (the netplay test's yards), `net/protocol.ts:25`
  (`BUILD` is 'dev' from the dev server and in the unit tests; nothing
  runs it under plain node now). Build id `04afc8e8770b` to
  `ef0865b5b867`; nothing else moved. Gate A: oxlint 0/0 (189 files, 123
  rules); format clean; tsc clean; build clean (`App` 3,996.21 kB, gzip
  1,403.53 kB); `npm test` 1299 passed (30 files) in 309.4 s (bots
  7.8/13.8/17.8; the two yard pins; Classic's `d9ee9ad8fa7017af`,
  `467400f8225aeea3`, `3c2735848552d2b4`, `6c4c3343a80b5f99`; custom
  `c6f185549c8774b2`, `5e53e03454103914`; digests `227c4ce7`/`8913ad26`).
- Commit 2, the rest the sweeps found: `ai.ts` (stage 8.6 split it) named
  as `sim/ai/brain.ts` or `sim/ai/think.ts` where the thing named lives
  (`net/protocol.ts`'s `armBot`, `modes/tdm/tactics.ts`'s `Plan`, grudge
  and errands, `sim/matchMode.ts`, `view/pilot.ts`, and in two tests);
  `*.check.ts` and `client.check` named as the tests that hold the same
  now (`net/lobbyRules.test.ts`, `sim/simulation.test.ts`,
  `server/netplay.test.ts`, `server/client.test.ts`'s message,
  `scripts/browser-match.mjs`); "the checks" as "the tests" in the
  comments of `net/connection.ts`, `net/sessionSocket.ts`,
  `net/protocol.ts`, `net/client.ts`, `server/seating.ts`,
  `server/server.ts` and `server/browser.ts`; "the server's arena check"
  in `scripts/match-smoke.mjs` and `NET_RUNBOOK.md` step 5. One line of
  dead code: `build-id.ts`'s filter still left out `*.check.ts` files,
  which can't exist (`repo.test.ts`); it leaves out tests only now, and
  the id over today's files is the same either way. `README.md`'s checks
  line gains `npm run format:check`, which CI runs. Build id
  `ef0865b5b867` to `f1d686f7bfd2`. Gate A: oxlint 0/0; format clean; tsc
  clean; build clean (`App` 3,996.21 kB, gzip 1,403.52 kB); `npm test`
  1299 passed (30 files) in 309.6 s (bots 7.8/13.8/17.8; every pin and
  both digests as above).
- Found, not fixed here: `.claude/work/ffa/ffa-metrics.js`, the free for
  all balance probe, still reads `ffa.items`, `contender.effects` and
  `FFA.items`, which moved to the pickup supply before the refactor
  (`3b0943d`; stage 0.1 logged it). Its run throws. The content plan
  ports it first, since every addition runs the probes.

### 1.2 CI matched on Node 24 (2026-10-10)

Node 24.21.0 (npm 11.19.0) installed with nvm at the owner's word; the
default stays 26.7.0. A scratch worktree of `a370614`, detached, its
dependencies its own; each job's steps as `ci.yml` runs them:
- game: `npm ci` (7 s); `npm run lint` 0 warnings, 0 errors (189 files,
  123 rules); `npm run format:check` clean; `npm run build` clean (`App`
  3,996.21 kB, gzip 1,403.52 kB); `npm test` 1299 passed (30 files) in
  312.6 s (bots 7.8/13.8/17.8; every pin and both digests as in 1.1).
- www: `npm ci` (5 s); `npm run lint` (eslint) clean; `npm run check`
  `nakama.check: ok`; `npm run build` 12 pages.
One thing differed: the worktree's build id was `7d4ef2f26a10`, this
tree's `f1d686f7bfd2`, for the same commit. `build-id.ts` hashed every
file under `src/` and `server/`, and this tree has an untracked
`src/.DS_Store` (gitignored; macOS writes it). So a Mac's build id was
not CI's for the same commit, though its comment says "the same on every
machine". The page and the server are always built on one machine, so
nothing refused a page; but a build id written down here could not be
found again on CI. It was so on `main` too. Fixed: the walk leaves out
hidden files (names starting with "."), and none is tracked under `src/`
or `server/`, so CI's id is what it was. This tree's id is now
`7d4ef2f26a10`, the worktree's; the client bundle's name, `App-NHg6aMb_.js`,
is the same from both. Gate A: oxlint 0/0; format clean; tsc clean; build
clean (`App` 3,996.21 kB, gzip 1,403.52 kB); `npm test` 1299 passed (30
files) in 309.7 s (bots 7.8/13.8/17.8; every pin and both digests as
above).

### 1.3 The deploy path, locally (2026-10-10)

- `scripts/build.sh` (Node 26, this tree at `097b992`): 20 s, exit 0. The
  game for `/play` (`App` 3,996.24 kB, gzip 1,403.55 kB: the base path
  adds 0.03 kB), the server (`main.js` 161.49 kB, `replay.js` 4.73 kB,
  `load.js` 2.61 kB, `chunks/`), the site (0 errors), `precompress: 24
  files in www/dist`. Build id `7d4ef2f26a10` in the page's `App` chunk
  and the server's chunk.
- `.github/workflows/deploy.yml`, read whole. What it names on disk:
  `game/package-lock.json`, `www/package-lock.json`, `scripts/build.sh`,
  `deploy/compose.yml`, `deploy/Caddyfile`, `nakama/data`,
  `scripts/deploy.sh`, `scripts/backup.sh`, `www/dist/`,
  `game/dist-server/` (with `load.js` left out, which the build still
  makes), `scripts/nakama-smoke.mjs`, `scripts/chat-smoke.mjs`,
  `scripts/match-smoke.mjs`; the site's `/`, `/docs/modes` and `/play`.
  Every one exists or is built. Nothing else in it names a file that no
  longer exists; 11.1's change (no `*.check.js` exclude) was the only one.
  `deploy/compose.yml` runs `node /srv/server/main.js`, which the build
  makes.
- The local stack: the game server restarted on this tree (`npm run
  server`: protocol 7, build `7d4ef2f26a10`; the one left from the final
  run was on `04afc8e8770b`), Nakama on `:7350`.
  - `node scripts/nakama-smoke.mjs`: 6 ok (register, account, login and
    refresh, realtime socket, logout, cleanup), 5 s.
  - `node scripts/match-smoke.mjs`: `ok scrapyard ... arena 227c4ce7 as
    expected, build 7d4ef2f26a10`, `ok city ... arena 8913ad26 as
    expected`, cleanup ok, 1 s.
  - `node scripts/chat-smoke.mjs`: 6 ok (room chat, refusals, rate,
    whisper, edits refused, cleanup), 10 s.
  - `node scripts/arena-parity.mjs`: `ok scrapyard 227c4ce7 (expected
    227c4ce7)`, `ok city 8913ad26 (expected 8913ad26)`, 16 s.
  - `node scripts/guests-smoke.mjs`: failed at its first SQL line,
    `column "provider" of relation "user_device" does not exist`. The
    local Nakama container runs `heroiclabs/nakama:3.30.0` (up two days),
    while `nakama/compose.yml` and `deploy/compose.yml` pin 3.41.0, whose
    `user_device` has the column the script writes. Neither the script
    nor `nakama/` changed on this branch. The owner recreates the local
    stack on 3.41.0; the script runs again then.

### 1.4 The held-W check made sturdy (2026-10-10)

`scripts/browser-match.mjs`, Classic: the person's page holds W for 12 s,
as before. If the car went 3 m or less on the other page's screen, the
seat's bot had most likely parked it nose to a wall ("The final run"), so
the page then holds S for 12 s, and the distance backed out counts too.
The check is the same on the sum (over 3 m, and over 3 times the drift
with no key); its line says which keys were held and how far each went.
Five Classic runs and one custom, every check ok in each:

| Run | Seats (a, b) | W | S | Time |
|---|---|---|---|---|
| Classic 1 | 0, 4 | 0.8 m | 24.7 m back | 124.9 s |
| Classic 2 | 0, 4 | 20.6 m | not needed | 112.4 s |
| Classic 3 | 4, 0 | 2.6 m | 24.3 m back | 125.0 s |
| Classic 4 | 0, 4 | 77.0 m | not needed | 109.8 s |
| Classic 5 | 0, 4 | 0.4 m | 9.5 m back | 126.1 s |
| Custom | | | | 86.7 s, 11 checks ok |

Three of five times W alone would have failed. Run 5's screenshot as `a`
joined shows the car's nose against the concrete barriers, hull 50/100
from the bot's fight. Each time `a` left, the seat went back to its bot
("Sawtooth" or "Hexbolt"). The pages drew 1–3 frames a second, their match
clocks at 17–21 % of real time (SwiftShader).
Gate A (no file under `game/` changed since 1.2): oxlint 0/0; format
clean; tsc clean; build clean (`App` 3,996.21 kB, gzip 1,403.52 kB);
`npm test`, first run: 1298 passed, 1 failed, `server/netplay.test.ts`'s
"the hauler at 100 ms: 15 s of driving (100 m), every correction from an
input the network delivered late or dropped (1 corrections; 0 late, 0
dropped)". Run again: 1299 passed (30 files) in 309.7 s (bots
7.8/13.8/17.8; every pin and both digests as above). The failure's cause
is in the test (1.4b).

### 1.4b The hauler's drive, counted as the Razor's (2026-10-11)

1.4's gate A failed once on `server/netplay.test.ts`'s hauler drive (10.4's
test): "1 corrections; 0 late, 0 dropped", max error 0.008 m. It passed
every gate from 10.4 to 1.2. In about a dozen runs since, it failed three
times: twice that way, once "2 corrections; 1 late". Asked, the owner
chose to dig before going on. Two causes, both in how the test counts;
neither in the game.
- The Razor's drive counts late and dropped inputs from the countdown's
  last second, for the reason its comment gives (one there moves which
  input the server uses on which step). The hauler's counted them from GO.
- The Razor's drive notes corrections while it waits for GO (its "held on
  the grid" check); the hauler's didn't. `watchCorrections` counts from
  when it is made, so a correction on the grid was noted at the first
  step of the drive and charged to it, after the drive's max error was
  reset: the 0.008 m.
Found with scratch tests (not kept). Corrections between the seat and GO,
ten hauler rooms: one each in four of the six rooms where the person's
hauler replaced the seat's bot's razor at the join (`changeVehicle`), none
in the four where the seat's bot had drawn the hauler. Each came 0.43–0.47 s
into the countdown, at the page's first acknowledged inputs (ack 5–7):
the new body is still settling from `placeCar`'s 0.2 m lift (1.02 m/s
off in speed, or the comparison against an input the page doesn't hold).
Bots draw vehicles from the registry with the hauler in it, so whether
the seat's body is swapped is the room's seed's draw: about one room in
two. Sixteen drives, each its own room, with the corrections read at GO
instead: every correction came after a late input (0.250–0.286 m, at
14.7–16.1 m/s: one step's travel against the 0.25 m tolerance).
Fixed in the test: the hauler's drive counts as the Razor's (late inputs
from the countdown's last second, corrections noted on the grid and left
out of the drive), and its printed line gives the grid's count. Four runs
of the file alone: 0, 0, 0 and 1 on the grid (that one with 1 late input
and 1 correction in the drive), every check ok; gate A's run below: 1 on
the grid, 0 in the drive. In the game this is one correction as a person
takes a seat in another vehicle than the bot's, while the countdown holds
the car: not seen on screen, and noted for the content plan (a real
second vehicle makes the swap common in Classic).
Gate A: oxlint 0/0; format clean; tsc clean; build clean (`App` 3,996.21
kB, gzip 1,403.52 kB); `npm test` 1299 passed (30 files) in 310.4 s (bots
7.8/13.8/17.8; every pin and both digests as above). Build id
`7d4ef2f26a10` (a test only).

### 1.3, finished: guests-smoke on Nakama 3.41 (2026-10-11)

At the owner's word the local stack was moved to the image its compose
file names. First the local database, dumped (`pg_dump`, 25 kB gzipped,
in the session's scratch folder): Nakama's migrations don't go back down
(`nakama/AGENTS.md`). Then `podman compose up -d` in `nakama/`:
`heroiclabs/nakama:3.41.0`, "Successfully applied migration" (4), the
three Lua modules found (`chat.lua`, `guests.lua`, `stats.lua`),
"Startup done", healthy.
- `node scripts/guests-smoke.mjs`: `ok who goes: {"deleted":13,"more":false}`
  (the RPC deletes every guest older than 3 days, the local stack's own
  among them, as each night on the server), `ok the same browser comes
  back as a new guest`, `ok 250 old guests in 381 ms`, `ok cleanup: 7
  accounts deleted`; 3 s.
- Again on 3.41: `nakama-smoke.mjs` 7 ok (7 s), `chat-smoke.mjs` 6 ok
  (10 s), `match-smoke.mjs` both arenas ok, build `7d4ef2f26a10` (1 s).

### 1.5 The check in Chrome, on a real GPU (2026-10-11)

The owner said to do it, and connected the Chrome extension. Chrome 155,
WebGL on "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)", the
owner's settings (high quality, full resolution). The dev server started
on `:3000` for it (`npm run dev`; it was down), a second one on
`127.0.0.1:3001` for the second player's tab (another origin, so its own
stored session and guest; stopped after), the game server with
`NET_LAG_MS=60` (runbook step 7), Nakama 3.41. Everything checked through
the page's own controls, the dev build's `window.match` read for numbers,
and states staged the way `shots/capture.mjs` stages them (the clock
moved to the buzzer, a hull set to one point).
- Main menu: no console errors, on load or after, in the first tab all
  session long. (The second tab's console was not readable: the
  extension has no permission for that origin's console.)
- Garage: the vehicle page shows the Razor and its sheet, no pager and
  no ←→ hint (one vehicle). The weapon page pages Rocket Pod ↔ Minigun
  with ←→, the turret model changes, the hint says ←→ WEAPON.
- Practice team deathmatch, the Scrapyard: in the match 10 s after
  Practice; `ARENA 227c4ce7`; 69–79 FPS; held W for 3 s: 26.6 m, 54
  km/h. Tab board (K, D, A, streak, damage, score); Esc pauses (the clock
  held at 9:30) and Esc resumes (1.5 s on in 1.5 s); wrecked with the
  hull at one point and a rival in front: the death board, "Wrecked by
  Carrion", "Respawning in 2", back with hull 100; the buzzer: Victory,
  MVP, the standings; Play again: in again at 0:03, 0 : 0; a settings
  change in the pause drawer (quality to medium, saved, then back to
  high); resumed, the clock runs (2 s in 2 s).
- Exit to garage (it asks first): `window.match` undefined; the
  renderer's counts 336 geometries / 117 textures in the match, 194 / 98
  in the garage.
- Practice free for all, The City: `ARENA 8913ad26`; 81 FPS; the clock
  moved 2 minutes: the hot zone "Downtown" (banner, feed, minimap) and a
  supply drop of 9 pickups; driven onto the armor pickup: the armor
  effect for 10 s and its chip above the hull bar; the board with the
  leader's crown; a bot at 30 kills at the buzzer: Defeat, 7th of 8,
  items collected 1; Play again with the player at 30: Victory, 1st, the
  crown.
- Classic, two tabs (`localhost:3000` and `127.0.0.1:3001`, two guests):
  both searched team deathmatch on the Scrapyard; "Match found"
  (Scrapyard, 2 players) in both within half a second of the second
  search; both accepted; one room, `f57af2`, seats 0 and 4, "2 people
  playing". At 60 ms each way the F3 line read ping 121–128 ms and
  snapshots 6–19 ms old. The first tab's car, held on W with a turn,
  drove 31.8 m (into a pile of wrecks: "Stuck — press R to recover");
  corrections went 181 to 193 over those 5 s, max 0.57 m, and stayed at
  193 for 6 s standing. The second tab saw that car at (5.5, 0, -88.3)
  against its own (5.5, 0, -88.4). Esc online: "Match menu — the match
  goes on without a pause"; leaving asks first ("A bot takes your
  machine over"). The match chat: a line sent came back through Nakama
  ("You: chat check after refactor").
  Two tabs share a window, so one is always hidden, and Chrome stops a
  hidden tab's frames: the second tab sent no input for a minute and
  the server let it go ("Connection lost — No input for a minute"), as
  designed. The first tab then read "1 people", the seat was "Hexbolt"
  again, the feed said the guest left. The 181 corrections before the
  drive were most likely the first tab's own hidden spell (it caught up
  when shown); a person's feel at 60 ms, with both windows in front,
  is still the owner's to judge.
- Custom lobby: made in the first tab (6 v 6, friendly fire on); the
  second tab's list showed it live (TDM, Scrapyard, 1/12); joined by the
  code typed in lower case; lobby chat both ways ("Guest 5e84: hello from
  b"); Edit with pickups on: the member saw "Pickups All" and "The owner
  changed the lobby — everyone is unready"; ready, "Everyone's ready",
  Start: one room, `5b03be`, seats 0 and 6, 12 seats with 2 in play (the
  empty seats stayed empty); the board with its TK column; Back to lobby
  (it asks first): the waiting room, "Match in progress · 9:38 left",
  Join match, the tally 0 — 0, `window.match` undefined; Leave lobby
  ("Guest 5e84 becomes the owner"): the other tab's host now Guest 5e84.
- Put back: the stored loadout (the Rocket Pod; paging had set the
  Minigun), quality high, the debug overlay off (F3 had stored it on);
  the tabs closed, the second dev server stopped, the game server
  restarted without the lag. The dev server on `:3000` is left running.
Every item on the list passed.
Gate A for 1.3 and 1.5 (no file under `game/` changed since 1.4b): oxlint
0/0; format clean; tsc clean; build clean (`App` 3,996.21 kB, gzip
1,403.52 kB); `npm test` 1299 passed (30 files) in 309.9 s (bots
7.8/13.8/17.8; every pin and both digests as above; the hauler: 0 on the
grid, 0 in the drive).

### 2.1 Coverage (stage 9.6) (2026-10-11)

`@vitest/coverage-v8` 5.0.2, Vitest's own version, as a dev dependency
(the lockfile gains its packages and nothing else moves); `npm run
test:coverage` (`vitest run --coverage`); in `vitest.config.ts` the
coverage of `src/` and `server/`, tests aside, printed only (`text`,
`text-summary`), no threshold; `coverage` in `.gitignore` for the folder
V8 works in. `game/AGENTS.md` names the command. A first run counted the
root's `.ts` files too: `build-id.ts` read 0 % only because it runs in
Vitest's config process, not under the tests, so they were left out.
`npm run test:coverage`: 1299 passed in 334 s (`npm test` 310 s).

| | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| All | 61.47 % (6,716 / 10,925) | 54.76 % (3,134 / 5,723) | 52.75 % (1,101 / 2,087) | 61.54 % (5,596 / 9,092) |
| `server/` | 90.61 | 85.45 | 91.62 | 92.50 |
| `src/sim/` | 96.82 | 90.51 | 96.82 | 97.98 |
| `src/sim/ai/` | 100 | 99.64 | 100 | 100 |
| `src/modes/` | 75.60 | 79.16 | 60.00 | 73.84 |
| `src/modes/ffa/` | 72.84 | 69.36 | 66.08 | 72.52 |
| `src/modes/tdm/` | 86.23 | 79.07 | 74.46 | 87.73 |
| `src/modes/items/` | 74.79 | 86.11 | 80.00 | 71.42 |
| `src/net/` | 72.38 | 65.84 | 63.45 | 73.98 |
| `src/content/` (`parts.ts`) | 13.04 | 60.00 | 33.33 | 14.51 |
| `src/content/arenas/` | 95.71 | 95.51 | 91.50 | 95.47 |
| `src/content/arenas/kit/` | 99.33 | 99.13 | 98.63 | 99.38 |
| `src/content/vehicles/` | 9.09 | 0 | 0 | 9.52 |
| `src/content/vehicles/models/` | 0 | 0 | 0 | 0 |
| `src/content/weapons/` | 75.00 | 100 | 0 | 100 |
| `src/content/weapons/turrets/` | 0 | 100 | 0 | 0 |
| `src/render/` | 54.59 | 72.91 | 60.00 | 52.94 |
| `src/render/materials/` | 90.39 | 93.15 | 90.32 | 89.54 |
| `src/runtime/` | 5.51 | 4.31 | 4.93 | 5.41 |
| `src/` (`main.tsx`, `App.tsx`, `analytics.ts`), `src/screens/`, `src/screens/lobbies/`, `src/hud/`, `src/view/` | 0 | 0 | 0 | 0 |

What it says: the simulation, the bots, the server and the arenas are
held almost line by line; the wire and the modes' rules three lines in
four. What the tests don't reach is what draws (the vehicle and turret
models, the view, the HUD, the screens) and the browser's half of a match
(`runtime/`): those the smoke list and the browser scripts hold. The
first real vehicle's model is in that 0 %: the content plan says what
holds it.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (`App` 3,996.21
kB, gzip 1,403.52 kB); `npm test` 1299 passed (30 files) in 309.4 s (bots
7.8/13.8/17.8; every pin and both digests as above). Build id
`0dcd359f9068` (the lockfile).

### 2.2 Bundle weight (11.4a): the libraries in chunks of their own (2026-10-11)

The ask: three, Rapier and React in one vendor chunk with Vite 8's
chunking option (`build.rolldownOptions.output.codeSplitting.groups`),
then measure. Measured first, four ways, each a build of this tree with
`base: '/play/'` (a scratch script, not kept: every chunk's size raw,
gzip -9 and brotli 11, and what the entry pulls in statically, which is
all that a device without a mouse downloads, since `main.tsx` shows it a
notice and never imports the game). kB:

| Variant | Chunks (raw / gzip) | Without a mouse (gzip / br) | The game (gzip / br) | A deploy that changes only the game's code re-downloads (gzip) |
|---|---|---|---|---|
| Today | App 3,996.2 / 1,383.0; index 222.6 / 68.9 | 80.2 / 68.8 | 1,463.1 / 1,117.2 | App, 1,383.0 |
| One vendor chunk: three, Rapier, React | vendor 3,727.5 / 1,306.6; App 488.2 / 142.1; index 4.0 / 1.9 | **1,319.7 / 996.3** | 1,461.8 / 1,117.9 | App and index, 144.0 |
| Two: `react` (React, React DOM, scheduler) and `engine` (three, Rapier) | engine 3,508.1 / 1,239.3; App 488.3 / 142.2; react 218.9 / 67.4; index 4.0 / 1.9 | 80.5 / 69.1 | 1,462.0 / 1,118.7 | App and index, 144.1 |
| `engine` alone | engine 3,508.1 / 1,239.3; App 488.3 / 142.2; index 222.8 / 69.1 | 80.3 / 68.9 | 1,461.8 / 1,118.5 | App and index, 211.3 |

(The CSS, 66.4 / 11.2, is in every path.) One chunk works, but it puts
three and Rapier behind the entry: a phone would download 1.3 MB gzipped
to be told the game needs a mouse, where `main.tsx` says it never
downloads the game. So the build has the two groups instead: the same
saving on every deploy (144 kB gzipped instead of 1,383), first visits
the same (1,462 kB), the phone's path as today. The owner asked for one
chunk; the reason is in the report, and one line changes it back.
`vite.config.ts`: `codeSplitting.groups` `react` and `engine`, matched
by their `node_modules` folder; its comment says why. `index.html`
preloads the `react` chunk; App's dynamic import brings App, `react` and
`engine`. The server's build (`vite.server.config.ts`) is untouched.
Checked: the build, served as static files and loaded in headless
Chromium (a scratch script): the menu at 1.7 s, a practice match on the
Scrapyard, F3's `ARENA 227c4ce7`, the five files fetched with 200, no
console or page error.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (`index` 3.97 /
1.89 kB, `react` 218.85 / 68.25, `App` 488.25 / 143.42, `engine`
3,508.09 / 1,258.05; Vite's own gzip); `npm test` 1299 passed (30 files)
in 309.5 s (bots 7.8/13.8/17.8; every pin and both digests as above; the
hauler: 1 on the grid, 0 in the drive). Build id `0dcd359f9068` (the
config is outside it).

### 2.3 Bundle weight (11.4b): Rapier's WASM as a file (2026-10-11)

The spike: load Rapier's WASM as a file instead of the base64 inside
`@dimforge/rapier3d-compat`'s `rapier.mjs`, the same engine version, and
keep it only if every pin and digest still matches and the game loads at
`/play`.
- The compat package ships the module beside its bundle,
  `dist/rapier_wasm3d_bg.wasm`, and its `init()` hands wasm-bindgen's
  loader `toByteArray("<base64>").buffer`. Decoded, the base64 is that
  file byte for byte: 2,021,200 bytes, SHA-256 `4d621b86d803ce99…` both.
  So the file is the same engine, not just the same version.
- `vite.config.ts`: a plugin of a few lines, for `vite build` only,
  before Vite's own: in `rapier.mjs` it replaces that expression with
  the URL of the package's `.wasm`, imported with `?url` (Vite emits it
  as an asset with a hashed name, under the build's base), and fails
  the build if the expression is gone (a new Rapier). The loader fetches
  the URL and compiles the module as it streams in. The dev server
  (Vite pre-bundles the package) and the game server's bundle
  (`vite.server.config.ts`; Node's `fetch` reads no files) keep the
  base64; the server's chunk still holds it.
- The first try left the loader `undefined`: the expression ends in
  `.buffer`, which the first pattern didn't take, so the page asked the
  URL string for its `.buffer` and Rapier fell back to a URL of its own,
  "Failed to construct 'URL': Invalid base URL" at "Starting physics".
  The pattern now takes `.buffer` and has to.
Measured, as in 2.2 (kB):

| | `engine` chunk (raw / gzip / br) | The WASM file (raw / gzip / br) | The game (raw / gzip / br) | Without a mouse (gzip) |
|---|---|---|---|---|
| 2.2 (inline) | 3,508.1 / 1,239.3 / 928.0 | in the chunk | 4,285.7 / 1,462.0 / 1,118.7 | 80.5 |
| Now | 812.0 / 190.6 / 155.6 | 2,021.2 / 765.8 / 558.1 | 3,610.8 / 1,179.1 / 904.5 | 80.5 |

The game's first download is 19 % smaller gzipped and brotli'd alike
(1,462 to 1,179 kB, 1,119 to 905), the base64 no longer parsed as
JavaScript, and the module compiles while it downloads. `scripts/
precompress.mjs` already took `.wasm`: `.br` 558,066 and `.gz` 765,814
bytes beside it (27 files in `www/dist`, 24 before 2.2). Caddy's
`file_server` names `.wasm` `application/wasm` and keeps `/play/assets/*`
forever, as for the chunks.
Checked:
- `scripts/build.sh`, `www/dist` served as static files (Python's
  server, `application/wasm`), `/play/` in headless Chromium: the menu at
  1.3 s, a practice match on the Scrapyard, `ARENA 227c4ce7`, the six
  files fetched with 200, the `.wasm` as `application/wasm`, no console
  or page error.
- The `.wasm` refused once (Playwright's route): "Starting physics
  failed" with Retry; Retry fetched the file again and the menu opened
  (wasm-bindgen keeps only a module that loaded, and `initPhysics`
  forgets a failed start). Its message blames the browser ("This
  browser couldn't start the physics engine (WebAssembly)") even when
  the network failed; left as it is.
- `node scripts/browser-match.mjs` (its pages built with this config,
  so they load the file, against the server's inline module): every
  check ok, 109.5 s (`a` held W, 31.3 m on `b`'s screen); `custom`: every
  check ok, 86.3 s. A development-mode build was checked to carry the
  file too.
- Gate A below: every pin and both digests as before. Kept.
`.claude/work/arch/LOADING_ARCHITECTURE.md`: "Starting physics" says the
page's build fetches the module as a file.
Gate A: oxlint 0/0; format clean; tsc clean; build clean (`index` 3.97 /
1.89 kB, `react` 218.85 / 68.25, `App` 488.25 / 143.42, `engine` 811.98 /
192.45, the `.wasm` 2,021.20 / 773.54; Vite's own gzip); `npm test` 1299
passed (30 files) in 309.6 s (bots 7.8/13.8/17.8; every pin and both
digests as above; the hauler: 1 on the grid, 1 in the drive after 1 late
input). Build id `0dcd359f9068`.

### 3. The content phase, planned (2026-10-11)

Asked of the owner, answered: four vehicles beside the Razor (Scout,
Brute, Rammer, Buggy: five in all, past D5's 2–4, the owner's choice);
five weapons beside the Minigun and the Rocket Pod (Cannon, Shotgun,
Homing missiles, Mines, and Lasers, which the owner added); one map
(Docks); the order the first vehicle, a weapon that is only data, the
map, then the rest, new kinds and mechanics last.
`.claude/work/content/PLAN.md`, a plan only, nothing built:
- the decisions, with each addition's starting numbers beside today's;
- what moves when: a vehicle or weapon moves all eight pins (bots draw
  from the registries), a map moves none and adds two, a new kind adds a
  wire event and a `PROTOCOL` bump;
- the recipe for each: built unregistered (its gate prints the old
  pins), tuned with the probes in a scratch tree, registered and re-pinned
  in a commit of its own that gives the reason and old → new, checked
  (gates B and C, Chrome), patch notes, then the site's copy;
- step 0 before any of it: the free for all probe ported (1.1), the
  probes by vehicle and gun, a test for every model and turret (2.1's
  0 %);
- the steps in order: the Brute first, in place of the test-only hauler
  (its spec into `server/testVehicle.ts` while unregistered, the file
  gone when registered; the takeover correction of 1.4b measured with
  it); the Cannon; the Docks; the Scout and the Buggy; the Shotgun
  (pellets on guns); the Laser (the kind decided at its start: a `beam`
  recommended); homing missiles; mines; the Rammer's ram damage, as a
  property of the vehicle so others play as before;
- open points, each settled at its step.
`.claude/work/.gitignore` lets `content/` in; `.claude/work/README.md`
lists it.
Gate A (no file under `game/` changed since 2.3): oxlint 0/0; format
clean; tsc clean; build clean (as in 2.3); `npm test` 1299 passed (30
files) in 309.8 s (bots 7.8/13.8/17.8; every pin and both digests as
above; the hauler: 1 on the grid, 1 in the drive after 1 late input).

## After stage 11 — done (2026-10-11)

Ten local commits on `refactor/game` after `54af70e`, nothing pushed.
The branch reviewed and its stale comments fixed (1.1); CI's jobs green on
Node 24, and the build id the same on a Mac as on CI (1.2); the deploy
path built and smoke-tested locally, Nakama 3.41 included (1.3); the
held-W check sturdy (1.4) and the hauler's netplay drive counted as the
Razor's (1.4b); the list checked in Chrome on a real GPU (1.5);
coverage (2.1); the libraries in chunks of their own (2.2) and Rapier's
WASM as a file (2.3), the game's download 19 % smaller; the content phase
planned (3). Every pin, digest and fixture as at stage 11's end;
`PROTOCOL` 7; `npm test` 1299. Build id `0dcd359f9068`. Push, the pull
request and the merge are the owner's.

### 4. Tailwind classes as Tailwind writes them (2026-10-11)

The owner's editor (Zed, with `@tailwindcss/language-server` 0.16.0)
warned on classes in both projects. Its `suggestCanonicalClasses` rule
asks the project's own Tailwind (4.3.3) to print each class
(`canonicalizeCandidates([class], { rem: 16 })`) and warns when the
answer differs. Read first: `.claude/codes/tw/`, every file.
- Found by driving that same server over stdio (a scratch LSP client, not
  kept) on every file of `game/src`, `game/index.html` and `www/src`: 45
  warnings, all `suggestCanonicalClasses` (42 in the game, 3 in the
  site); no `cssConflict` and no other rule. A scan with Tailwind's own
  scanner and `canonicalizeCandidates` found the same 45.
- The changes, by kind: `tracking-[0.1em]` to `tracking-widest` (11) and
  `tracking-[0.05em]` to `tracking-wider` (5); `bg-gradient-to-*` to
  `bg-linear-to-*` (9, one under `before:`); opacity as a percent
  (`bg-white/[0.03]` to `bg-white/3`, and five more); px as spacing
  steps (`max-w-[540px]` to `max-w-135`, `min-w-[380px]` to `min-w-95`,
  `max-w-[420px]` to `max-w-105`, `max-w-[1120px]` to `max-w-280`,
  `h-[3px]` to `h-0.75`) and `max-w-[9rem]` to `max-w-36`; `z-[5]` to
  `z-5`; `border-t-[8px]` to `border-t-8`; `aspect-[1010/470]` and
  `aspect-[2/1]` to `aspect-1010/470` and `aspect-2/1`; `break-words` to
  `wrap-break-word`; `[mask-image:…]` to `mask-[…]`; `[text-shadow:none]`
  to `text-shadow-none`; a `left-[clamp(…)]` without its `_+_` spacing.
- Each pair compiled and compared (a scratch script): 12 give the same
  CSS byte for byte. The other 10 are the same in effect: the tracking
  steps are the theme's `0.1em` and `0.05em`; `bg-linear-to-*` adds an
  `@supports` fallback for browsers without `oklab` interpolation;
  `text-shadow-none` also registers its variables; the hover one
  differs in its selector only; the five px values become spacing steps,
  equal at the default 16 px root size, and now scale with the browser's
  font size as the rest of the UI does.
- Applied at the server's own positions (a scratch script that checked
  each class was there first): 45 classes in 21 files (18 in the game,
  3 in the site). The server run again: 0 diagnostics in 206 files.
  Prettier's class order still holds.
- Not changed, on purpose: names v4 kept with another meaning than v3's
  (`rounded`, `rounded-sm`, `backdrop-blur-sm`, `outline-none`,
  `space-y-*`). No warning names them, and both projects started on
  Tailwind 4.3 (`a4d7927`), so they already draw what they mean in v4.
  No `@tailwind`, `@screen` or `theme()` in the CSS, no `!` prefix, no
  class built at runtime.
Gates: the game's gate A: oxlint 0/0; format clean; tsc clean; build
clean (`App` 488.14 / 143.37 kB); `npm test` 1299 passed (30 files) in
312.2 s (every pin and both digests as above). The site: `npm run lint`
clean, `npm run check` ok, `npm run build` complete. **B:**
`shots/capture.mjs tw`, 35 shots, no page or console error, 588 s;
against `final/`: 0.0–1.6 % for 28 shots, `exit-confirm` 2.5 %,
`results-custom` 3.3 %, `death-board` 3.8 %, `custom-board-tk` 5.9 %
(the match's own numbers and moment: looked at side by side, layout,
type and spacing the same), `scenery-tokens` and `scenery-zone` 55 %
(where items and the zone fell, as in every run); the renderer's counts
in the match 496 / 193, as before. Build id `5ebbbbccb797`.

### 4b. So it doesn't come back (2026-10-11)

The owner asked for the rule in `AGENTS.md`. It applies to the game and
the site, so it goes in the root one (the narrowest that covers both):
a "Tailwind (game and www)" section.
- Write each class the way Tailwind prints it, its canonical form. It
  gives four kinds of example: v4 names; a theme or spacing step where
  one equals the value; opacity as a percent; a utility over an
  arbitrary property. Each example was checked against Tailwind 4.3.3:
  all ten `canonicalizeCandidates` answers are as the section says.
- Names v4 kept with another meaning are picked by their v4 value
  (`pitfalls.md`).
- Before writing classes, read `.claude/codes/tw/`, `pitfalls.md` first.
- The check, so the rule is more than prose: `scripts/tailwind-classes.mjs`.
  Each project's own Tailwind (its scanner, then `canonicalizeCandidates`
  with a 16 px root, as the language server does) goes over `game/src`,
  `game/index.html` and `www/src`, tests and CSS included. It lists every
  class it would write another way, with the form to use, and exits 1 if
  there is any. On this tree: "every class as Tailwind writes it (227
  files)", exit 0. On `2425009`, the tree before 4: the same 45 classes
  the editor showed, exit 1. It is not in CI; the root `AGENTS.md` lists
  it with the other scripts.
Gate A (no file under `game/` changed since 4): oxlint 0/0; format clean;
tsc clean; build clean; `npm test` 1299 passed (30 files) in 309.7 s
(every pin and both digests as above).
