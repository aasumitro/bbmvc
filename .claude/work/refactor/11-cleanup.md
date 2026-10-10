# Stage 11 — Cleanup

**Goal:** the docs match the code, the public surface is as small as its readers
need, and the refactor is measured against stage 0's baseline.

**Before:** stage 10 done on `refactor/game` (its gates passed).

## Steps

1. **Living docs, final.**
   - Game `AGENTS.md`: code map, commands, tests.
   - `.claude/work/arch/ARCHITECTURE.md`: "how to add a vehicle / weapon / map /
     mode / pickup / match setting" gives exactly the steps the code needs now
     (`PLAN.md`, "After the refactor").
   - `MODULE_BOUNDARIES.md` points to `.oxlintrc.json`.
   - `STATE_OWNERSHIP.md`, `GAME_LOOP.md`, `LOADING_ARCHITECTURE.md`.
   - `.claude/work/net/` architecture: "adding content, online".
2. **Public surface.** Un-export what only its own file uses (67 exports at
   baseline), except option types a caller needs to name. Re-count on the new
   tree first: names have moved since.
3. **Measure again.** Every stage 0 number, as a before/after table in `LOG.md`:
   - lines of code;
   - files over 400 lines;
   - mode literals;
   - cycles;
   - duplicates;
   - bundle sizes;
   - lint, `tsc` and test times;
   - the test count.
4. **Bundle weight** (optional, its own commits, the owner's call). Code structure
   doesn't change what a player downloads.
   - At the last build in `dist/` (2026-09-30) the client was one 3.9 MB chunk,
     1.37 MB gzipped. About 2.9 MB of it is Rapier's `rapier.mjs`, whose WASM is
     inlined as base64.
   - (a) Put `three`, Rapier and React in a vendor chunk through Vite 8's
     chunking option. A deploy then makes players download only the game's own
     code again.
   - (b) A spike: load Rapier's WASM as a file instead of base64. It is the same
     engine version, so every pin must still match.
5. **Close.** Mark `PLAN.md` done. `.claude/work/BBMV_GAME_REFACTOR_PLAN.md`
   stays as the analysis.

## Done when

- The docs describe the code as it is.
- `LOG.md` has the before/after table.

**Rollback:** revert.
