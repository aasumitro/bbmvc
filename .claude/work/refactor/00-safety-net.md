# Stage 0 — Safety net

**Goal:** pin what the existing pins don't cover, make the gates trustworthy, set
up Vitest, and measure the baseline every later stage is compared with. Checks,
test tooling and logs only: no production file changes.

**Before:** branch `refactor/game` at `3b0943d`. All work stays on this branch
(D3).

## Steps

One commit each.

1. **Baseline.** Start `LOG.md` with numbers from commands run now, not copied
   from the analysis:
   - `npm run lint`, `npx tsc -b`, `npm run check`: every check's count and the
     six pin hashes as printed; wall time of `npm run check` and `npx tsc -b`.
   - Lines of production code and of checks (`.ts`/`.tsx` in `src/` and
     `server/`, checks apart); every production file over 400 lines.
   - `npm run build`: every client chunk, raw and gzip. `npm run server:build`:
     the `dist-server/` main chunk.
   - Mode literals: the analysis Appendix B grep (34 lines in 7 shared files at
     `3b0943d`, plus `server/browser.ts` and `server/load.ts`).
   - Type cycles: oxlint `import/no-cycle` with `ignoreTypes: false`, through a
     throwaway config. 43 reports at `3b0943d`; 0 with `ignoreTypes: true`.
   - Duplicates: `wrap` 5 times (`view.ts`, `camera.ts`, `ai.ts`, `pilot.ts`,
     `hud/Hud.tsx`); `Point {x, z}` 3 times (`mode.ts`, `items/items.ts`,
     `tdm/types.ts`), plus `server/fairplay.ts`'s 3-D `Point`.
   - `node scripts/browser-match.mjs` and `node scripts/browser-match.mjs custom`:
     their output.

2. **Steady timing check.** `server/netplay.check.ts`'s rough-link case asserts
   the queue's recovery in wall-clock milliseconds (`recovery <= 1250`). That
   fails on a loaded machine, because page and server slow down together but
   the clock doesn't.
   - Count steps instead: the samples between a burst and the depth back at 1
     or less (`m - n`), bounded at 75 (1250 ms at 60 Hz). Read
     `server/browser.ts` first to confirm one sample is one page step. Keep the
     milliseconds in the printed line.
   - Do the same for every other wall-clock bound that is asserted, not only
     printed, in `netplay.check.ts` and `server.check.ts`. Convert each one, or
     write in `LOG.md` why it stays.
   - Done when 10 runs in a row pass while another `npm run check` runs beside
     them.

3. **Pins for custom settings.** In `server/server.check.ts`, beside `GOLDEN`:
   - Extend `bare()` to take a `MatchSettings` and an optional empty-seat
     schedule: vacate a seat at step _a_, take it back at step _b_. Use the same
     simulation and rules calls, in the same order, that `room.ts` makes when a
     custom room's person leaves and comes back.
   - Two pins, each a whole match, stopped at the outcome and capped like
     `GOLDEN`:
     - **TDM on the Scrapyard:** 12 seats, friendly fire, every pickup group,
       kill limit 25, fast respawn, a 5-minute clock; seat 11 empty from 60 s to
       120 s.
     - **FFA on The City:** 2 seats, pickups off, normal respawn, a 5-minute
       clock.
   - The pin is the first 16 hex digits of the fingerprint's sha256, as in
     `GOLDEN`.
   - Commit only once the hash is the same twice in one process and the same on
     CI (Linux) as on the Mac.

4. **Wire fixtures.** Literals inline in the checks (no fixture files):
   - `src/net/protocol.check.ts`:
     - a snapshot frame as hex, from `packSnapshot` over hand-built rows (one
       machine present, one absent) and a `meRow`;
     - `JSON.stringify` of a welcome with custom settings and a lobby, a `ro`,
       and an `inputMessage(…)`.
   - `server/server.check.ts`: one event of each wire code (`sh ln rk bu hu wr
     cr rl sp rc ru go`), as the recorder writes it. The recorder imports
     without extensions until stage 1, so plain node can't load it yet.
   - `server/custom.check.ts`: a fixed lobby's `LobbyRow` and `LobbyView` JSON.
   - Review: flip one clamp in `packCars` locally, see a fixture fail, revert.

5. **Every map with every mode at its largest size.** In `server/arena.check.ts`:
   for each map, each mode it hosts, lined up at the largest size
   `CUSTOM.sizes[mode]` allows. The mode's adapter is built headless, nothing
   throws, and every seat gets a start.

6. **Screens baseline.** Take screenshots into `.claude/work/refactor/shots/`
   (gitignored, so they survive across chats without being committed):
   - main menu;
   - garage with each weapon;
   - HUD in TDM and in FFA, with the Tab board open;
   - death board;
   - results: a TDM win (MVP), an FFA loss and an FFA crown;
   - lobby list;
   - waiting room (TDM 6 v 6 with bots);
   - lobby form with Advanced open.

   UI steps in later stages compare against these, and note each before/after
   pair in `LOG.md`.

7. **Vitest** (D4; `vitest` 5 is already a dev dependency, so nothing new is
   installed).
   - `vitest.config.ts` at the game root, environment `node`. Its tests:
     `src/**/*.test.{ts,tsx}`, `server/**/*.test.ts` and `*.test.ts` at the root.
     `__BUILD__` defined as `'dev'`, as the dev server does.
   - Stage 9 adds an `integration` project (forks, one file at a time) for the
     socket tests. React component tests wait until someone wants them, since
     they need a DOM library: an owner's call, then.
   - `package.json`: `"test": "vitest run"` and `"test:watch": "vitest"`.
     `.github/workflows/ci.yml` (game job): `npm test` after `npm run check`.
   - `build-id.ts` skips `*.test.ts` and `*.test.tsx`, as it skips `*.check.ts`.
     Otherwise a test edit would change the build id and restart the game
     server on deploy.
   - `tsconfig.node.json` includes `vitest.config.ts`.
   - First test: `src/game/rng.test.ts`, the first ten draws of `createRng(1234)`
     as literals. Every seeded stream rests on it, and it shows the setup works.
   - Game `AGENTS.md`, "Where this project departs from the shared guides": new
     tests are Vitest (`ts/testing.md`), and the `.check.ts` scripts stay until
     stage 9 moves them.

## Must not change

Every production file (`src/**` and `server/**` except `*.check.ts` and
`*.test.ts`). The six existing pins. `server/digests.json`. The build id doesn't
move either: it skips checks and tests.

## Done when

- `LOG.md` holds the baseline.
- The timing check is steady 10/10 under load.
- The two custom pins, the wire fixtures and the map × mode check are in
  `npm run check`.
- `npm test` runs in CI.
- Gates A and D are green.

**Rollback:** revert.
