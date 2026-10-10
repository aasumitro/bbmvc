# Stage 7 — UI and scenery seams

**Goal:** rendering leaves the gameplay contract, and a mode brings its own HUD
and results panels. Looks, per-frame cost, and restart and dispose order all
stay as they are.

**Before:** stage 6 done on `refactor/game` (its gates passed). Three parts, one
per step group below, each passing gates A and B before the next.

## Steps

1. **Scenery out of the contract.**
   - Drop `MatchMode.show(camera)` and `ModeContext.scene`.
   - The runtime draws the pickup tokens from `mode.supply`, generically through
     `modes/items/pickups.ts`.
   - FFA's hot zone draws through `modes/scenery.ts`:
     `MODE_SCENERY: Partial<Record<Mode, (scene) => Scenery>>`, client-only.
   - `net/client.ts`'s `seatOnline` stops passing a scene to the mode.
   - `modes/modes.ts` no longer imports `pickups.ts` or `zone.ts`: remove the
     stage-7 lint allowance.
   - Tokens and the zone stay pooled and pre-parked for the shader compile, as
     today.
   - Check: a string unique to `pickups.ts` and one unique to `zone.ts` no
     longer appear in `dist-server/`.
2. **Mode panels.**
   - `modes/views.ts`: `MODE_VIEWS: Record<Mode, { HudPanel, ResultsPanel }>`,
     client-only.
   - `modes/{ffa,tdm}/HudPanel.tsx` take, out of `hud/Hud.tsx`:
     - FFA's score, board and lead line;
     - TDM's team score and momentum;
     - the scoreboard's order, headers and TK column.
   - `modes/{ffa,tdm}/ResultsPanel.tsx` take, out of `screens/Results.tsx`:
     FFA's record, TDM's team score and MVP.
   - A panel queries `data-hud` only under its own root (otherwise TDM's panel
     can take FFA's slots), allocates nothing per frame, and writes the DOM
     imperatively, as today.
   - `hud/minimap.ts` takes marks and colours from the panel or the supply, and
     drops its `ffa/rules` import.
3. **Chips and sharing from the catalogue.**
   - The HUD's effect chips come from `ITEMS` (a `timed` flag) instead of the
     hard-coded `EFFECTS` list.
   - `supply.share()`/`mirror()` loop over the effect keys instead of naming
     four.
   - Tighten the literal guard: no `mode.kind ===` and no mode literal left in
     `hud/` or `screens/`. Remove stage 5's two exceptions.

## Must not change

- HUD and results pixels.
- Per-frame allocations: a Chrome allocation timeline over 10 s of a match,
  before and after.
- The pickup and zone visuals.
- Restart and dispose order, and the renderer's geometry and texture counts
  after leaving a match.

## Verify

- Gate A.
- Gate B, the whole smoke list, with screenshot pairs against stage 0's
  baseline:
  - practice TDM and FFA;
  - custom TDM with pickups and friendly fire at 12 seats (the TK column);
  - results with the lobby's tally;
  - the death board.
- The allocation spot-check.

## Done when

- `hud/` and `screens/` never branch on the mode.
- The server bundle holds no mode view.
- Adding a mode's HUD means adding its two panels and one `MODE_VIEWS` line.

**Rollback:** revert the part's commits.
