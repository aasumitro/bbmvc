# Stage 5 — Mode traits and lobby rules

**Goal:** code outside a mode's folder learns about modes from one table, and the
rules both server and page use are written once.

Today, from the analysis (§1.5, §7.2):

- 34 lines in 7 shared files compare against `'tdm'`/`'ffa'`, two of those files
  on the server;
- the side of a slot is computed in 3 places (`server/custom.ts` `side`,
  `screens/Lobby.tsx` `side`, `tdm/mode.ts` `lineUp`);
- the start rule in 2 (`unstartable`, `startHint`);
- the tally key in 2 (`over()`, `winnerKey`);
- "12 seats" in 5.

**Before:** stage 4 done on `refactor/game` (its gates passed). Two parts, each
passing gate A before the next: **5a** (server and domain) and **5b** (screens).

## 5a — server and domain

1. **Traits.** Each mode's config exports a plain object of traits, typed by
   nothing: `TDM_TRAITS` in `modes/tdm/config.ts`, `FFA_TRAITS` in
   `modes/ffa/config.ts`.
   - Fields:
     - `teams`: two sides, the first half of the seats blue;
     - `sizes`: the sizes a lobby may choose, today `CUSTOM.sizes[mode]`;
     - `friendlyFire`: whether the option means anything in this mode;
     - `classic: { size, duration, pickups }`: today written inside
       `classic(mode)`.
   - `modes/traits.ts` imports `modes/ids.ts` and the two configs, declares
     `ModeTraits`, and exports:
     - `MODE_TRAITS = { tdm: TDM_TRAITS, ffa: FFA_TRAITS } satisfies Record<Mode, ModeTraits>`;
     - `MAX_SEATS`, the largest size over all modes (12);
     - `sideOf(mode, size, seat)`.
   - The configs never import `traits.ts`, or the cycle comes back.
     `satisfies` checks their shape from the registry's side.
2. **Settings from traits.** In `modes/matchSettings.ts`:
   - `classic(mode)` reads `MODE_TRAITS[mode].classic`, so it gives the same
     numbers and the pins hold;
   - `CUSTOM.sizes` comes from the traits;
   - `checkSettings` takes size and friendly-fire validity from the traits.
     Error texts stay word for word (the form shows them).
3. **Lobby rules.** New `net/lobbyRules.ts`, pure and server-safe:
   - `startable(lobby): '' | 'alone' | 'waiting' | 'sides'`, keeping the
     server's order of reasons;
   - `tallyKey(mode, winner, slots)`: the side, the person's uid, or
     `bot:<slot>`.
   - `server/lobbies.ts` uses them, and the traits for the side, the free slot,
     regrouping on a mode change and slot claims.
4. **The rest of the server and domain.**
   - `server/room.ts`'s team chat comes from `teams`.
   - `modes/tdm/mode.ts`'s `lineUp` uses `sideOf`.
   - `net/protocol.ts`'s `SLOTS` becomes `MAX_SEATS`.
5. **Tests** (Vitest):
   - `modes/traits.test.ts`, consistency: `MAX_SEATS` equals `SLOTS`,
     `BOT_NAMES.length` and the HUD's pools; `CUSTOM.sizes` equals the traits.
   - `net/lobbyRules.test.ts`, parity: `startable`, `tallyKey` and `sideOf` give,
     over every case `server/lobbies.check.ts` already drives (as an `it.each`
     table), the answers the old code gave. Write the table before deleting the
     old code.

## 5b — screens

6. `screens/lobbies/Lobby.tsx`: `side()` and `startHint()` use
   `sideOf`/`startable`. The hint keeps the server's order of reasons.
7. `screens/lobbies/LobbyForm.tsx`: defaults, and which fields show, come from
   the traits.
8. `screens/Results.tsx`: `winnerKey` becomes `tallyKey`. `hud/Hud.tsx`:
   `MARKERS` and `SCORE_ROWS` become `MAX_SEATS`.
9. **Literal guard.** `repo.test.ts`: no `'tdm'`/`'ffa'` string literal outside:
   - `modes/ids.ts`, `modes/traits.ts`, `modes/modes.ts` and the mode folders;
   - the data lists (`content/arenas/maps.ts`, `App.tsx`'s default pick);
   - checks, `server/browser.ts` and `server/load.ts`;
   - until stage 7: `hud/Hud.tsx` and `screens/Results.tsx`, whose `mode.kind`
     branches are its work.

## Must not change

- Pins and `PROTOCOL` 6.
- `lobbies.check` (71), `client.check` (47), `server.check`'s custom cases, and
  the fixtures.
- The server's refusals and their notes.
- The page's hints, sides and tally highlight for today's two modes.

## Verify

- Gate A.
- Gate B item 6, all of it: waiting-room hints, sides, regroup on Edit, the
  tally. Screenshot pairs of the waiting room and the form.

## Done when

- No mode literal in `server/`, `modes/matchSettings.ts` or `screens/lobbies/`.
- A scratch third mode (`teams: false`, sizes 2–8, a copy of FFA's rules), tried
  on a scratch branch and not committed, shows in the lobby form and lines up
  touching only its folder and the registries (`ids`, `traits`, `modes`, a
  map's list).

**Rollback:** revert the part's commits.
