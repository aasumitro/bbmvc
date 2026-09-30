# SQL Pitfalls

## NULL three-valued logic (the #1 source of wrong results)

- `NULL = NULL` is NULL, not true. `WHERE x <> 'a'` silently drops rows where `x IS NULL`.
- **`NOT IN` with a NULL in the list returns zero rows, always:**

```sql
WHERE id NOT IN (SELECT user_id FROM user_device)   -- one NULL ⇒ empty result
```

  Use `NOT EXISTS`, or filter the subquery `WHERE user_id IS NOT NULL`.
- Aggregates skip NULLs (`count(col)` ≠ `count(*)`); `sum` of no rows is NULL — wrap
  `coalesce(sum(x), 0)`.
- Null-safe comparison: `IS [NOT] DISTINCT FROM`.

## Nakama's data

- **The system user.** `users` holds a row Nakama creates for itself, id
  `00000000-0000-0000-0000-000000000000` with an empty username. Exclude it from counts and
  lists unless a filter already does (`email IS NOT NULL` does).
- **Registered vs guest** is a data question, not a column: email accounts have `email`;
  the game's guests are device accounts (a `user_device` row, no email). A player can have both
  after linking — say which one a count means. Since 3.41 `user_device` also holds auth
  providers' logins (`provider` not empty): a device is `provider = ''`. What the nightly
  cleanup deletes (`data/modules/guests.lua`) is stricter: a device is the only way in.
- **"Never" is the epoch, not NULL.** `disable_time` and `verify_time` are `NOT NULL` with
  default `1970-01-01`: a disabled account is `disable_time > '1970-01-01'`, and
  `disable_time IS NULL` matches nothing.
- **Columns change between Nakama versions.** Check the live table (`README.md`) after an image
  bump, and never `SELECT *`.

## Lua result shapes

- `nk.sql_query` returns an array of rows, each a table keyed by column name — and 1-indexed:
  `rows[1].n`. An empty result makes `rows[1]` nil; guard before indexing unless the query
  always returns a row (an aggregate without `GROUP BY` does).
- A failed query raises a Lua error, which fails the RPC. Let it: the caller gets an error,
  not a half-built answer. Catch (`pcall`) only where a fallback value is correct.
- `count(*)` arrives as a Lua number (`get_stats` encodes it as a JSON number).

## Implicit casts kill indexes silently

`WHERE id = $1` with a text parameter against a `uuid` column casts per row or fails. Cast the
parameter (`$1::uuid`), not the column.

## Non-sargable predicates

A column wrapped in a function (`WHERE lower(username) = $1`, `date(create_time) = $1`) can't
use a plain index — rewrite as a range (`create_time >= $1 AND create_time < $2`). A leading
wildcard (`LIKE '%term'`) can't use a B-tree.

## WHERE vs ON in a LEFT JOIN

A filter on the right table in `WHERE` turns a LEFT JOIN into an INNER JOIN. Filter the right
side in `ON`:

```sql
LEFT JOIN storage s ON s.user_id = u.id AND s.collection = $1
```

## Injection

Values go through the params table, always. An identifier that must vary (a sort column)
comes from a fixed allowlist in the module, never from RPC input — escaped or not.
