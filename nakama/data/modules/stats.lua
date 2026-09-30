local nk = require("nakama")

-- Who is in the game right now: every open game socket joins this stream and
-- Nakama drops the presence when the socket closes. The mode sits outside
-- Nakama's built-in stream modes; hidden, so joins send no presence events.
local ONLINE = { mode = 100, label = "online" }

-- How long the counts are reused: every open page of the site polls them this
-- often (www/src/lib/stats.ts), so however many there are, the database is
-- asked at most once per period.
local KEEP = 30 -- seconds

-- Called by the game over its socket (game/src/net/session.ts): the presence
-- belongs to that socket's session, not to the token.
nk.register_rpc(function(context, _)
  if not context.session_id then
    error({ "call over the realtime socket", 3 }) -- INVALID_ARGUMENT
  end
  nk.stream_user_join(context.user_id, context.session_id, ONLINE, true, false)
  return ""
end, "join_online")

-- Public counts for the site (deploy/Caddyfile calls it with the HTTP key).
-- Registered = email accounts; guests are the game's device accounts.
nk.register_rpc(function(_, _)
  local cached = nk.localcache_get("stats")
  if cached then
    return cached
  end
  local rows = nk.sql_query("SELECT count(*) AS n FROM users WHERE email IS NOT NULL", {})
  local users = {}
  local active = 0
  for _, p in ipairs(nk.stream_user_list(ONLINE, true, true)) do
    if not users[p.user_id] then
      users[p.user_id] = true
      active = active + 1
    end
  end
  local stats = nk.json_encode({ registered = rows[1].n, active = active })
  nk.localcache_put("stats", stats, KEEP)
  return stats
end, "get_stats")

return { ONLINE = ONLINE } -- guests.lua spares whoever is on it
