# Scrapyard - Game Server

Nakama 3.41.0 on Postgres 16, run with Podman (podman-compose). The site (`www/`) and the game (`game/`) sign in against it from the browser (see `.claude/work/www/WWW_IMPLEMENTATION_PLAN.md`), and the game's online matches chat over it (`.claude/work/nakama-mm/`).

## Local

```sh
podman compose up -d           # from nakama/
node ../scripts/nakama-smoke.mjs
```

- API and realtime socket: `http://127.0.0.1:7350` (server key `defaultkey`)
- Console: `http://127.0.0.1:7351` (admin / password)
- gRPC: `:7349`, Postgres: `:5432` (clashes with any other Postgres on that port)
- Stop: `podman compose down` (the database volume stays; `down -v` wipes it)

The smoke test signs in a guest and an email account, reads and updates the account, refreshes the session, opens the realtime socket, creates a match and joins the online count, logs out, then deletes both accounts. It exits 1 on the first failure.

`node ../scripts/chat-smoke.mjs` tests the match chat's rules (`chat.lua`) with two guests: a room message reaches both and isn't stored; other room names, groups, empty, overlong and malformed messages and edits are refused with the socket left open; a burst is cut at 8 messages in 10 s; a whisper is requested, joined back and delivered. It deletes the guests.

`node ../scripts/guests-smoke.mjs` tests the nightly guest cleanup (`guests.lua`): a player's session is refused; an old guest is deleted with its device, and 250 more in one call; a young guest, an old guest online, old guests who linked an email or another login, and an email account stay; the same browser comes back as a new guest. It backdates the accounts it makes with psql in this stack's Postgres, so it's local only, and the cleanup deletes every guest here older than 3 days.

Upgrading (3.30 → 3.41 was the last): the container runs `nakama migrate up` before starting, and migrations don't go back down, so on a server run `scripts/backup.sh` first. Session tokens were signed the same way in 3.30 and 3.41, so the game server needed no change.

## Configuration

`data/config.yml`: session token 2 h, refresh token 30 days. Images in `compose.yml` are fully qualified (`docker.io/...`): Podman won't resolve short names without a prompt.

Nakama warns at boot about its insecure defaults (console user, password and signing key, server key, session encryption keys, runtime HTTP key). They are fine here; a server passes its own through `deploy/compose.yml` from `deploy/.env`.

Go modules: source in `modules-src/`, built with `heroiclabs/nakama-pluginbuilder:3.41.0`; only the `.so` goes into `data/modules/`.

Lua modules load from `data/modules/` as they are. `stats.lua`: `join_online`, which the game calls over its socket so it counts as online until the socket closes, and `get_stats` (email accounts, players online) for the site's footer, called with the runtime HTTP key (`defaulthttpkey` here). `chat.lua`: the match chat's rules, as before-hooks on the realtime chat (see `AGENTS.md`). `guests.lua`: `prune_guests`, called with the HTTP key only, deletes the guests made more than 3 days ago (accounts a device is the only way into), except those online right now; on the server `scripts/backup.sh` calls it each night, after the dump.
