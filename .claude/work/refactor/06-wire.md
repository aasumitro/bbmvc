# Stage 6 — Wire modules

**Goal:** one definition of each wire event, used by both encoder and decoder,
and the lobby wire in a module of its own. Every byte and every JSON shape stays
as it is. `PROTOCOL` stays 6.

**Before:** stage 5 done on `refactor/game` (its gates passed).

## Steps

One commit each.

1. **Event codec.** New `net/events.ts`. For each wire code (`sh ln rk bu hu wr
   cr rl sp rc ru go`), the field names in wire order and their quantisation.
   It exports:
   - `encode(code, fields)`, used by `server/recorder.ts`;
   - `decode(row)`, which returns a typed object and is used by `net/client.ts`'s
     `play()`;
   - `owners(row)`: the seats that make an event the player's own, so it plays
     at once. This replaces `net/client.ts`'s `mine()`, which hard-codes for
     example that `sh`'s victim sits at `f[11]`;
   - `NOW`: the codes always played at once (`ru`, `go`, which `net/client.ts`
     special-cases today).
2. **Old against new, then remove the old.**
   - Record a real match's events (a bots-only room, a minute).
   - In a Vitest test (`net/events.test.ts`), run every event through both the old positional decode and
     `mine()`, and through `decode()` and `owners()`. Assert the same fields and
     the same owners for every event.
   - The same file keeps a round trip for every code: `decode(encode(x))`
     equals `x`.
   - Then delete `mine()` and every positional `f[n]` read in `net/client.ts`.
     The event fixtures from stage 0 stay unchanged.
3. **Lobby wire.** New `net/lobbyProtocol.ts` takes out of `net/protocol.ts`:
   - the lobby types (`LobbyForm`, `Lobbying`, `LobbyRow`, `LobbySlot`,
     `LobbyView`, `LobbyNote`);
   - `LOBBY_ACTIONS`, `INVITE`, `readCode`, `tidy`, `LOBBY_FORM`;
   - the `lb`/`lbs` message types and the `lb` parser (`lobbying()`).

   `parseClient` hands `lb` to it. `net/protocol.ts` keeps `PROTOCOL`, `BUILD`
   and the match wire, at its path. Importers: `server/lobbies.ts`,
   `net/lobbies.ts` and the lobby screens.

## Must not change

- Bytes and JSON (stage 0's fixtures); `PROTOCOL` 6.
- Event playback order.
- Which events wait for the drawn tick, and catch-up after a second behind
  (effects dropped, rules events kept).

## Verify

- Gate A, with `client.check`, `netplay.check` and `server.check`'s replay
  cases.
- Gate B items 3, 5 and 6 online: hits, rockets, wrecks, kill feed and sounds
  arrive at the moment they did before.

## Done when

- No positional event decode is left in `net/client.ts`.
- The lobby wire lives in `net/lobbyProtocol.ts`.
- `net/protocol.ts` is back near its pre-lobby size (about 480 lines).

**Rollback:** revert per commit.
