<!-- BEGIN:agent-rules -->

# nakama/ — accounts, sessions, the match chat

Nakama 3.41.0 on Postgres 16 (`nakama/`, run with Podman). It is the control plane only: gameplay never runs here (why: `.claude/work/nakama-mm/PLAN.md`).
- `podman compose up -d` — starts postgres + nakama (console on `:7351` admin/password, client API + socket on `:7350`, gRPC `:7349`, Postgres `:5432`); images are fully qualified (`docker.io/...`) because Podman won't resolve short names without a prompt. Upgrading the image runs Nakama's own migrations at start, which don't go back down: back the database up first (`scripts/backup.sh` on the server)
- `node scripts/nakama-smoke.mjs` (from the repo root) — smoke test against the running Nakama: guest + email sign-in, account, refresh, socket + match, logout; deletes what it creates; `NAKAMA_URL` / `NAKAMA_CLIENT_KEY` for a server
- `node scripts/chat-smoke.mjs` — the match chat's rules on the running Nakama (`chat.lua`): room names, limits, nothing stored, a whisper delivered; same variables
- `node scripts/guests-smoke.mjs` — the nightly guest cleanup on the local Nakama (`guests.lua`): who is deleted, who stays. Local only: it backdates its own accounts with psql (`NAKAMA_POSTGRES`, default `nakama_postgres_1`), and the cleanup deletes every guest there older than 3 days
- Sessions: token 2 h, refresh token 30 days (`data/config.yml`)
- Runtime modules: Lua loads from `data/modules/` as is: `stats.lua` (`join_online`, `get_stats`; it returns its online stream for `guests.lua`), `guests.lua` (`prune_guests`, runtime HTTP key only: deletes the guests made more than 3 days ago — accounts whose only way in is a device, an email or any other login keeps one — except those online right now; `scripts/backup.sh` calls it nightly, after the dump), `chat.lua` (before-hooks on the realtime chat: only the game's room names, `sy-` and 24 hex digits; direct messages; no groups, no edits; nothing stored; `{"text"}` of 1–200 characters, 8 messages in 10 s a user). A hook refuses by raising an error: returning nil would close the player's socket. Go source goes in `modules-src/`, built with `heroiclabs/nakama-pluginbuilder:3.41.0` (the runtime image's version); only the built `.so` goes into `data/modules/`.

More (ports, `stats.lua`, the boot warnings): `README.md`.

## Database

Every table is Nakama's own, created and upgraded by `nakama migrate up` (the container's first step in `compose.yml`): this repo has no schema, migrations or `.sql` files. Read Nakama's tables with SQL; change them only through the `nk` API. Two queries today, both read-only: the cached count in `data/modules/stats.lua`, and the walk over old guests in `data/modules/guests.lua` (which deletes them through `nk.account_delete_id`). How to write one: `.claude/codes/sql/`.

<!-- END:agent-rules -->
