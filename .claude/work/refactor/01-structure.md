# Stage 1 — Structure

**Goal:** one formatting pass, unused code deleted, `src/game/` replaced with
layer folders, the names that mislead fixed, one import convention, and the code
map rewritten. Formatting, deletions, moves and renames only: no logic changes
anywhere in this stage.

**Before:** stage 0 done on `refactor/game` (its gates passed); the feature
freeze on `game/` announced.

## The tool

One throwaway script, kept in the scratchpad and never committed. It applies a
move map:

- `git mv` each file;
- rewrite every relative specifier in `src/` and `server/`: `import … from`,
  `import type … from`, `export … from`, `import '…'` and `import(…)`;
- resolve each specifier against the old tree, map it to the file's new path,
  and write the new relative path with the file's extension.

Only specifiers change. Every application ends with `npm run format`, because a
longer path can wrap a line. Then run gate A. Checks and tests move with their
subject (stage 0's `rng.test.ts` goes to `shared/`).

## Steps

One commit each, gate A green at every commit. Every move commit also fixes, in
the same commit, each path it breaks: the `check` script in `package.json`,
`scripts/arena-parity.mjs`, and the balance probes
(`.claude/work/ffa/ffa-metrics.js`, `.claude/work/tdm/tdm-metrics.js`, which
import `/src/game/...`).

1. **Formatter** (D1), as two commits.
   - **Commit 1, the config.** Add `prettier` and `prettier-plugin-tailwindcss`
     (it sorts class names: the official plugin) as dev dependencies.
     - `.prettierrc` follows today's style: `semi: false`, `singleQuote: true`,
       `trailingComma: 'all'`, `arrowParens: 'always'`.
     - Choose `printWidth` by trying 120, 140 and 160 on a scratch copy. Take the
       one that breaks the extreme lines (602 over 160 characters at baseline)
       with the fewest lines changed, and log the numbers.
     - `.prettierignore`: `dist`, `dist-server`, `public`.
     - `package.json`: `"format"` and `"format:check"`. CI (game job) runs
       `npm run format:check`.
     - Game `AGENTS.md` line "no formatter is configured" goes.
   - **Commit 2, one formatting pass.** Run it over `src/`, `server/` and the
     root `.ts` files. Its hash goes in `.git-blame-ignore-revs` at the repo
     root.
   - Gate A: formatting can't change behaviour; the pins prove it.
2. **One import convention.** Give every relative specifier its file's extension
   (433 have none at baseline). Then:
   - drop the "imports without file extensions" reason from
     `vite.server.config.ts`'s comment (`import.meta.env` and `__BUILD__` still
     need Vite);
   - in game `AGENTS.md`, replace "Node checks import local modules with `.ts`;
     the bundled ones need Vite (extensionless imports …)" with "every relative
     import names its file".
3. **Unused code goes before anything moves** (D2), with a commit per kind and
   the evidence in `LOG.md`.
   - Remove the legacy generators `VehicleGenerator.ts`, `ArenaGenerator.ts` and
     `proceduralTexture.ts` (325 lines: nothing imports the first two, and only
     `VehicleGenerator.ts` imports the third). Drop game `AGENTS.md`'s sentence
     that keeps them. Its rule about keeping today's procedural Razor and arenas
     when a glTF asset replaces them stays.
   - Remove `public/icons.svg`: nothing in `game/`, `www/` or `scripts/` names
     it, and nothing has since the first commit.
   - Remove the exported types nobody imports: `Tactics`, `NetClient`,
     `Prediction`, `SnapshotBuffer`, `FairPlay`, `Matchmaker`, `Rewind`.
   - Sweep once more for code with no reader, and remove only what is proven
     unread:
     - files no other file imports (except entries, checks and tests);
     - exports never imported;
     - `package.json` dependencies never imported;
     - files in `public/` no source, HTML or CSS names.

     Write each finding and its proof (the grep, or the script's line) in
     `LOG.md`. Exports used only inside their own file are not dead: stage 11
     un-exports them, once names have settled.
4. **`shared/`, `render/`:** see the map below.
5. **`content/`.**
6. **`sim/`.**
7. **`modes/`.**
8. **`view/`.**
9. **`runtime/`.** `src/game/` is now empty; remove it.
10. **Names that mislead.** Rename the file, plus the factory and type names that
    collide; `tsc` guards each one. Nothing else changes: no string on the
    wire, in logs, in `/health` or in records.
    - `server/lobby.ts` → `server/seating.ts`. Its `createLobby`, `Lobby`
      and `LobbyOptions` become `createSeating`, `Seating` and
      `SeatingOptions`, and the game server's `lobby` property becomes
      `seating`. Today the server has two unrelated `Lobby` types (this one and
      `server/custom.ts`'s).
    - `server/custom.ts` → `server/lobbies.ts`; `server/custom.check.ts` →
      `server/lobbies.check.ts`.
    - `net/custom.ts` → `net/lobbies.ts`.
    - `screens/search.ts` → `screens/hooks.ts` (it holds `useSearch`,
      `useCustom` and `useClock`).
    - `screens/{Custom,Lobbies,Lobby,LobbyForm}.tsx` → `screens/lobbies/`.
11. **Docs.**
    - Game `AGENTS.md`: rewrite the code map for the new tree, one line per
      folder plus the files a newcomer needs. Aim for half its length; folder
      names now carry meaning.
    - Root `AGENTS.md`: the repo-layout line for `game/`.
    - Every living doc that names an old path: `.claude/work/arch/` (not the
      `REFACTOR_*` reports, which are history) and `.claude/work/net/`
      architecture or runbook pages. Find them with `git grep -n "<old path>"`
      for each moved file.
    - Logs and finished plans stay as written.

## Move map

Paths are under `src/`; old paths are under `src/game/`.

| From | To |
|---|---|
| `rng.ts` | `shared/rng.ts` |
| `renderer.ts`, `environment.ts`, `postprocessing.ts`, `geometry.ts` | `render/` |
| `materials/*` (7 files) | `render/materials/` |
| `vehicle/vehicles.ts` | `content/vehicles/vehicles.ts` |
| `vehicle/vehicle.ts` | `content/vehicles/models.ts` (it holds `MODELS`) |
| `vehicle/parts.ts` | `content/parts.ts` (vehicles and arena props share it) |
| `arena/arena.ts`, `arena/digest.ts`, `arena/scrapyard.ts`, `arena/city.ts` | `content/arenas/` |
| `arena/{props,ground,buildings,street}.ts` | `content/arenas/kit/` |
| `maps.ts` | `content/arenas/maps.ts` |
| `simulation.ts`, `combat.ts`, `physics.ts`, `scoring.ts`, `loadout.ts`, `ai.ts` and the checks `simulation`, `ai`, `bots` | `sim/` |
| `vehicle/drive.ts` | `sim/drive.ts` |
| `mode.ts` | `sim/matchMode.ts` (the contract; `modes.ts` is the registry) |
| `modes.ts`, `matchSettings.ts`, `roster.ts` | `modes/` |
| `items/*`, `ffa/*`, `tdm/*` | `modes/items/`, `modes/ffa/`, `modes/tdm/` |
| `view.ts`, `feed.ts`, `pilot.ts`, `input.ts`, `camera.ts`, `effects.ts`, `audio.ts`, `sounds.ts`, `settings.ts`, `turntable.ts` | `view/` |
| `runtime.ts`, `match.ts`, `online.ts`, `loading.ts`, `loading.check.ts` | `runtime/` |

Files move whole. Splits come later, each in its own stage, in their final
folders: `combat.ts`'s weapon data and `loadout.ts`'s storage in stage 4,
`maps.ts`'s arena cache in stage 3.

## Must not change

- File contents, beyond formatting (step 1), deletions of unused code (step 3),
  specifiers, and step 10's identifiers.
- `net/protocol.ts`'s path (`scripts/match-smoke.mjs` reads `PROTOCOL` from it).
- Pins, digests, fixtures, `PROTOCOL` 6.
- `window.match`'s shape (the probes and `browser-match.mjs` read it).

## Verify

- Gate A on every commit.
- At the end, gate B (the whole smoke list) and gate C (`arena-parity.mjs`, one
  probe run).
- `git log --follow src/sim/simulation.ts` reaches the file's history from before
  the move.
- The build id changes; that is expected.

## Done when

- `src/game/` no longer exists.
- No relative import is missing its extension (stage 2's lint keeps it so).
- No two `Lobby` types.
- The code map describes the new tree.
- The dev server on `:3000` serves the game (restarted by the owner if needed).

**Rollback:** revert the stage's commits. Moves revert cleanly; each commit can be reverted on
its own too.
