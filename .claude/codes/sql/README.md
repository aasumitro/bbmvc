# SQL Guide — use when writing SQL in `nakama/`

> Written for Scrapyard (not pulled from `aasumitro/workspace`). The database is Nakama 3.41.0's
> Postgres 16 (`nakama/compose.yml`, `deploy/compose.yml`). SQL lives in string literals inside
> runtime modules: `nakama/data/modules/*.lua` (`nk.sql_query`, `nk.sql_exec`), or Go modules
> built from `nakama/modules-src/` if one is ever added.

## Nakama owns the schema

Every table in the database is Nakama's own, created and upgraded by `nakama migrate up` (the
first step of the Nakama container's entrypoint in both compose files). This repo has no
schema, no migrations and no `.sql` files, and the guide has no schema-design or migration
chapters for that reason.

- **Read Nakama's tables; never write them with SQL.** Change accounts, storage, leaderboards
  and the rest through the `nk` API (`nk.account_update_id`, `nk.storage_write`, ...): Nakama
  keeps invariants and caches that a raw `UPDATE` bypasses.
- **New persistent data goes in Nakama's storage engine** (`nk.storage_write` /
  `nk.storage_read`, JSON objects by collection and key), not a new table. A table of our own
  means owning its migrations next to Nakama's — decide that with the user first. What the game
  may persist at all is bounded by the scope rules in the root `AGENTS.md`.
- **Check a column before using it** — against the running database, not from memory:
  `podman exec nakama_postgres_1 psql -U postgres -d nakama -c '\d users'`.
  Nakama's names are its own (`create_time`, `update_time`); match them.

## Files

| File | Read when |
|---|---|
| `style.md` | Always, once — layout, casing, how SQL sits in a Lua module |
| `query-patterns.md` | Writing anything beyond a single-table read: counts, aggregates, lists |
| `pitfalls.md` | Reviewing or debugging — NULL logic, Nakama's system user, Lua result shapes |
| `indexing.md` | A query on a hot path, or one that reads a big table (`users`, `storage`) |

## The rules that outrank everything

1. Read-only against Nakama's tables (above).
2. Parameterize every value (`$1`, `$2`, passed in the `nk.sql_query` params table) —
   string-built SQL is an injection, even in a module nobody calls from outside.
3. NULL is three-valued logic — every `NOT IN`, `<>` and `WHERE` on a nullable column is a bug
   candidate until proven (`pitfalls.md`).
4. Name the columns you read; no `SELECT *` (Nakama adds columns between versions).
5. The database also serves every sign-in: cache any read a page or poll triggers
   (`nk.localcache_put` with a period, as `get_stats` in `data/modules/stats.lua` does).
