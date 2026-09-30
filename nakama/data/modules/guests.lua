local nk = require("nakama")
local ONLINE = require("stats").ONLINE

-- Guests are kept 3 days from when they were made, then deleted: every
-- browser that ever pressed Play makes one, so they would only pile up. A
-- guest is an account whose only way in is a device (the game's guest ID);
-- an email, from registering or linked since, or any other login keeps it.
-- A guest whose game is open right now (on the online stream) waits for a
-- night it isn't. Called nightly by scripts/backup.sh with the runtime HTTP
-- key, after the database dump that still holds them.
local DAYS = 3
local BATCH = 200
local BUDGET = 5000 -- ms a call spends deleting, well inside Nakama's 10 s HTTP write timeout; the rest waits a night

-- Walked by id, after the last one seen: the ids of guests left alone (online
-- now) never come round again. The first page starts after the nil UUID, the
-- system user's.
local OLD_GUESTS = [[
SELECT u.id
FROM users u
WHERE u.id > $1::uuid
  AND u.create_time < now() - make_interval(days => $2::int)
  AND u.email IS NULL
  AND u.custom_id IS NULL
  AND u.apple_id IS NULL
  AND u.facebook_id IS NULL
  AND u.facebook_instant_game_id IS NULL
  AND u.gamecenter_id IS NULL
  AND u.google_id IS NULL
  AND u.steam_id IS NULL
  AND EXISTS (SELECT 1 FROM user_device d WHERE d.user_id = u.id AND d.provider = '')
  AND NOT EXISTS (SELECT 1 FROM user_device d WHERE d.user_id = u.id AND d.provider <> '')
ORDER BY u.id
LIMIT $3::int
]]

nk.register_rpc(function(context, _)
  if context.user_id then
    error({ "only with the server's HTTP key", 7 }) -- PERMISSION_DENIED
  end
  local online = {}
  for _, p in ipairs(nk.stream_user_list(ONLINE, true, true)) do
    online[p.user_id] = true
  end
  local deleted, after = 0, "00000000-0000-0000-0000-000000000000"
  local stop = nk.time() + BUDGET
  while true do
    local rows = nk.sql_query(OLD_GUESTS, { after, DAYS, BATCH })
    for _, row in ipairs(rows) do
      if nk.time() > stop then
        return nk.json_encode({ deleted = deleted, more = true })
      end
      if not online[row.id] then
        nk.account_delete_id(row.id, false)
        deleted = deleted + 1
      end
      after = row.id
    end
    if #rows < BATCH then
      return nk.json_encode({ deleted = deleted, more = false })
    end
  end
end, "prune_guests")
