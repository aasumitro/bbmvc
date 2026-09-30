local nk = require("nakama")

-- The match chat's rules (the game's net/chat.ts; the room names come from
-- game/server/room.ts). Classic's chat goes over Nakama's realtime chat: a
-- room channel per game room and per team, and direct messages for
-- whispers. These hooks hold every page to what the game sends:
--   joins    room channels only by the game's own names (sy- and 24 hex
--            digits, unguessable: a room channel lets in whoever knows its
--            name); direct messages as Nakama keeps them (the other user must
--            exist and not have blocked you); groups closed; nothing stored.
--   sends    {"text": "..."}, 1 to 200 characters; 8 messages in 10 s a user.
--   edits    closed.
-- A hook refuses by raising an error: the page is told why and its socket
-- stays open (a hook returning nil would close it).

local ROOM, DIRECT, GROUP = 1, 2, 3 -- channel types
local NAME = "^sy%-%x+$"
local LIMIT = { chars = 200, messages = 8, window = 10 } -- window: seconds

-- Characters in a UTF-8 string: bytes that don't continue a character.
local function characters(text)
  local _, count = string.gsub(text, "[^\128-\191]", "")
  return count
end

nk.register_rt_before(function(_, envelope)
  local join = envelope.channel_join
  if join.type == ROOM then
    if type(join.target) ~= "string" or not string.match(join.target, NAME) then
      error({ "only the game's own chat rooms", 3 }) -- INVALID_ARGUMENT
    end
  elseif join.type ~= DIRECT then
    error({ "group chat is closed", 7 }) -- PERMISSION_DENIED
  end
  join.persistence = false
  return envelope
end, "ChannelJoin")

nk.register_rt_before(function(context, envelope)
  local send = envelope.channel_message_send
  local ok, content = pcall(nk.json_decode, send.content or "")
  if not ok or type(content) ~= "table" or type(content.text) ~= "string" then
    error({ 'a chat message is {"text": "..."}', 3 })
  end
  local length = characters(content.text)
  if length == 0 or length > LIMIT.chars then
    error({ "a message is 1 to " .. LIMIT.chars .. " characters", 3 })
  end
  -- messages this user has sent in the current window, shared by every runtime instance
  local key = "chat:" .. context.user_id .. ":" .. math.floor(nk.time() / 1000 / LIMIT.window)
  local sent = (tonumber(nk.localcache_get(key)) or 0) + 1
  if sent > LIMIT.messages then
    error({ "slow down: " .. LIMIT.messages .. " messages in " .. LIMIT.window .. " seconds at most", 8 }) -- RESOURCE_EXHAUSTED
  end
  nk.localcache_put(key, tostring(sent), LIMIT.window * 2)
  return envelope
end, "ChannelMessageSend")

nk.register_rt_before(function()
  error({ "chat messages can't be edited", 7 })
end, "ChannelMessageUpdate")

nk.register_rt_before(function()
  error({ "chat messages can't be removed", 7 })
end, "ChannelMessageRemove")
