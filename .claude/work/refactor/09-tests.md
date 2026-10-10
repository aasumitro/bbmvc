# Stage 9 — One test runner

**Goal:** every `.check.ts` script becomes a Vitest test, with every assertion
kept. `npm test` becomes the one command and the plain-node runner goes (D4).
Tests only: production code doesn't change.

**Why now:** the scripts guarded stages 0–8 as they were. By now the folders are
final, so every test lands where it stays.

**Before:** stage 8 done on `refactor/game` (its gates passed). One group below
at a time.

## Rules for every file moved

- **Parity.**
  - Every `check(condition, label)` becomes one `expect` in an `it` (or one row
    of an `it.each`), with the same label.
  - Count before (the script prints its count) and after (Vitest's count).
  - The two are equal, or `LOG.md` names each difference and why.
- Same inputs, same seeds, same pins: the hash literals move as they are.
- The old script is deleted in the commit where its replacement passes. Never
  both running, never neither.
- Follow `.claude/codes/ts/testing.md`:
  - factories with overrides instead of shared blobs;
  - `it.each` with named rows;
  - no real waits in unit tests.

  `matchmaker` and `lobbies` already take a clock: keep their hand-moved clocks.

## Steps

1. **Pure and fast:** `ai`, `chat`, `protocol`, `fairplay`, `matchmaker`,
   `lobbies`, `ffa`, `tdm`, `loading`. Each becomes `<subject>.test.ts` beside
   its subject.
2. **Simulation:** `simulation` (with the two yard pins) and `bots` (behaviour
   ranges). `bots` keeps printing kills a minute per difficulty; the balance
   probes and `LOG.md` read them.
3. **Integration**, the bundled checks: `arena`, `server` (with the 4 + 2
   pins), `client`, `netplay`.
   - They go to a Vitest project `integration`: `pool: 'forks'`,
     `fileParallelism: false`, a long `testTimeout`, run after `unit` in CI.
   - They keep their real sockets on port 0. Vitest's Vite transform gives them
     `import.meta.env` and `__BUILD__`.
   - `vite.server.config.ts` `ENTRIES` keeps only `main`, `load` and `replay`.
4. **Scripts and CI.**
   - `package.json`: `check` and `server:check` go. If the habit helps, `check`
     can stay as an alias of `vitest run`.
   - `npm test` runs both projects. CI runs `npm test`.
   - `repo.test.ts` now asserts that no `*.check.ts` is left, instead of
     listing them.
5. **Docs.**
   - Game `AGENTS.md`: "Checks" becomes "Tests", one line per folder on what
     its tests cover (shorter than today's list).
   - Drop the "Tests" line from "Where this project departs from the shared
     guides": the project now follows `ts/testing.md`.
   - Living docs that name `npm run check` or `server:check`:
     `.claude/work/net/` runbook, `.claude/work/arch/`.
6. **Coverage (optional).** `@vitest/coverage-v8` would be a new dev dependency,
   so it's the owner's call. If added, it is read as a risk map, not a target
   (`ts/testing.md`).

## Must not change

- Production code.
- Pins and digests.
- The number of assertions (parity).

## Verify

- Gate A, with `npm test` in place of `npm run check` once step 4 lands.
- `LOG.md`: a table per file of the script's count against the tests' count.
- The integration project 10 times in a row while another `npm test` runs beside
  it: stage 0's steadiness must survive the move.

## Done when

- No `*.check.ts` is left, and one command runs every test.
- CI is green.
- Every count matches, or its difference is explained.

**Risk:** medium. An assertion lost in translation fails nothing; the parity
count and a side-by-side review of each file are the guard.

**Rollback:** revert the group's commits. The old script comes back with its revert.
