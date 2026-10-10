# Stage 8 — Module splits

**Goal:** a module per job where one file does several. Code moves between files;
**no statement is reordered** inside `room.step()`, `think()` or
`playMatch`'s frame.

**Before:** stage 7 done on `refactor/game` (its gates passed). The splits run
least risky first, each passing gate A before the next.

## Steps

1. **`server/room.ts`** (613 lines).
   - New `server/journal.ts`: `ReplayLine`, `Given`,
     `DRIVING`/`STANDING`/`COASTING` and the row encoding (`note()`), imported by
     both `room.ts` and `replay.ts`. That makes one definition of a persisted
     format.
   - New `server/inputs.ts`: the per-person input queue (drain window, stale
     input to neutral, repeats, drops, depth statistics). It is pure, with its
     own `server/inputs.test.ts` (Vitest: drain window, stale input, repeats
     and drops as `it.each` rows).
   - The five custom-room options (`lobby`, `plan`, `chat`, `over`, `idle`)
     become one `custom?: {…}` option.
   - `step()`'s order stays as it is: release the hold, drive people (with
     journal notes), the journal's `in` lines, `sim.step`, `rewind.record`, rules
     events, `report`, then outcome, end or restart, abandonment, broadcast, and
     the idle check last.
   - Guards: `server.check`'s replay cases (Classic and custom), the pins,
     `netplay.check`.
2. **The page's two stores.** New `net/sessionSocket.ts` holds what
   `net/matchmaking.ts` and `net/lobbies.ts` share word for word:
   - `dial()`;
   - the retry schedule `[0, 1000, 2000, 4000, 7000]` and its loop;
   - the `sessionStorage` mark helpers.

   Two stores and two state machines remain: Classic hands its socket to the
   match, while custom keeps it and takes it back. This layer had four bugs
   fixed in the custom work's review.
   `net/sessionSocket.test.ts` drives the retry loop and the marks with fake
   timers (`vi.useFakeTimers`), never a real wait.

   Guards:
   - `client.check` and `browser-match.mjs custom`;
   - by hand: a reload during a search (15 s grace), a reload in a lobby and in
     a lobby's match (20 s);
   - StrictMode's double mount in dev, and a `?join=` link.
3. **`runtime/match.ts`.** `createMatch`, practice's match source, moves to
   `runtime/practice.ts`, beside `online.ts`.
4. **Screens.**
   - `screens/lobbies/Lobby.tsx` (415 lines) → `SlotGrid.tsx`,
     `SettingsCard.tsx`, `InviteCard.tsx`.
   - `screens/GameCanvas.tsx` (345 lines) → `PauseMenu.tsx`, `ExitConfirm.tsx`,
     `LoadingOverlay.tsx`. Leave the `startGame`/dispose effect and the
     link-closing and `release` semantics where they are.
   - Accessible names stay word for word, because `browser-match.mjs` clicks by
     them: `Play`, `+ Create lobby`, `Advanced`, `More players`,
     `Create lobby`, `Ready`, `Start match`.
   - Optional: if `hud/Hud.tsx` is still over ~450 lines after stage 7, split
     its shared parts (compass, vitals, weapon, feed, markers).
5. **`server/server.ts`** (optional). The dev latency simulator (`held()`,
   `stallEnd`) moves to `server/netsim.ts`. `netplay.check` drives it.
6. **`sim/ai.ts`** (581 lines), last because it is the riskiest. Split it into
   `sim/ai/brain.ts` (`Agent`, `Brain`, `Plan`, `createBrain`, `provoke`),
   `perception.ts`, `navigation.ts` and `think.ts` (with targeting, which shares
   its scratch state). Rules:
   - every `random()` call stays in its order;
   - no statement is reordered in `think()`;
   - each module-level scratch vector (`goal`, `circling`, `weaving`, `lead`,
     `aimAt`, `from`, `along`, `spot`, `errandAt`, `toAim`, `toLead`) moves with
     the one function that uses it, and is never shared by two functions that
     run at the same time.

   Guards:
   - the pins: any change means revert, never re-pin;
   - `bots.check`'s ranges and the kills a minute it prints (easy 7.8,
     normal 13.8, hard 17.8 at baseline);
   - `tdm.check`;
   - a 2-minute practice match per difficulty, watched.

## Must not change

- Pins, digests, fixtures, `PROTOCOL` 6.
- The journal line format, and replays of journals written by the same build.
- The stores' reconnect behaviour: `RETRY`, the 15 s and 20 s graces, the marks.
- The screens' look and accessible names.

## Verify

- Gate A.
- Gate B after steps 2 and 4, with screenshot pairs.
- Gate C after step 6.

## Done when

- No production file is over about 450 lines, except the content builders
  (`city.ts`, `scrapyard.ts`, `recipes.ts`, `props.ts`), the two rules files and
  whatever `LOG.md` lists with a reason.
- `inputs.test.ts` and `sessionSocket.test.ts` run in `npm test`.

**Rollback:** revert the split's commits.
