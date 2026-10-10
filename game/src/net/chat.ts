import type { Channel, ChannelMessage, ChannelPresenceEvent, Notification, Socket } from '@heroiclabs/nakama-js'
import { readChat, type Person } from './chatCommand.ts'
import type { ChatChannels } from './protocol.ts'
import { nakama, onSocket, player } from './session.ts'

// A Classic match's chat, over the page's own Nakama socket (session.ts):
// everyone in the room, the team (team deathmatch), and whispers. The room
// and team channels are Nakama room channels named by the game server (the
// welcome's `chat`): a room channel lets in whoever knows its name, so only
// the room's seats are told it, and a team's only to that team. A whisper
// is a direct message to the user id the room says holds the seat. Nakama's
// hooks (nakama/data/modules/chat.lua) keep it to the game's rooms, 200
// characters, 8 messages in 10 s, nothing stored. A direct message reaches
// only someone who has joined its channel: the sender joins and waits (5 s
// at most) for the other side, whose page joins when Nakama tells it someone
// in its match wants to chat. Lines show once Nakama has passed them on (it
// sends a channel's messages back to their sender too). What a typed line
// asks for is chatCommand.ts's. DOM-free: the chat box (hud/Chat.tsx) reads
// it; nothing in the match waits on it. Made without side effects; `start`
// joins, `dispose` leaves.

export type ChatKind = 'all' | 'team' | 'from' | 'to' | 'note'

interface ChatLine {
  id: number
  kind: ChatKind // all, team; a whisper from someone, or to someone; a note from the page itself
  who: string
  text: string
  at: number // performance.now()
}

// Who holds each seat, as the match knows it now (seats change hands mid-match).
interface ChatRoster {
  names(): readonly string[]
  uids(): readonly string[] // '' a bot's
  me(): number // the player's seat
}

const REACH = 5000 // ms a whisper waits for its receiver's page to join
const KEEP = 60 // lines kept
const DM_REQUEST = -1 // Nakama's notification: someone joined a direct chat with you

export type Chat = ReturnType<typeof createChat>

export function createChat(channels: ChatChannels, roster: ChatRoster) {
  const lines: ChatLine[] = []
  const listeners = new Set<() => void>()
  const joined = new Map<string, Channel>() // 'all', 'team', or a user id (a whisper's channel)
  const present = new Map<string, Set<string>>() // by channel id: who is in it (user ids)
  const muted = new Set<string>() // user ids
  let socket: Socket | null = null
  let me = ''
  let lastFrom = '' // the user id the last whisper came from: /r answers them
  let serial = 0
  let version = 0 // bumped with every change: the chat box's snapshot
  let offline = false
  let unsubscribe = () => {}

  function changed() {
    version++
    for (const listener of listeners) listener()
  }
  function say(kind: ChatKind, who: string, text: string) {
    lines.push({ id: ++serial, kind, who, text, at: performance.now() })
    if (lines.length > KEEP) lines.shift()
    changed()
  }
  const note = (text: string) => say('note', '', text)

  // Names are the match's: the seat the user id holds now, else what Nakama calls them.
  const seatOf = (uid: string) => (uid ? roster.uids().indexOf(uid) : -1)
  const nameOf = (uid: string, fallback = 'Someone') => {
    const seat = seatOf(uid)
    return seat >= 0 ? roster.names()[seat] : fallback
  }
  // The other people in the match, as they're named now.
  const others = (): Person[] =>
    roster
      .uids()
      .map((uid, seat) => ({ uid, name: roster.names()[seat] }))
      .filter(({ uid }, seat) => uid && seat !== roster.me())

  function heard(m: ChannelMessage) {
    const content: unknown = m.content
    const text = content && typeof content === 'object' && 'text' in content && typeof content.text === 'string' ? content.text : ''
    const sender = m.sender_id ?? ''
    if (!text || muted.has(sender)) return
    const mine = sender === me
    const who = mine ? 'You' : nameOf(sender, m.username || 'Someone')
    if (m.channel_id === joined.get('all')?.id) return say('all', who, text)
    if (m.channel_id === joined.get('team')?.id) return say('team', who, text)
    const [one, two] = [m.user_id_one ?? '', m.user_id_two ?? '']
    if (!one) return
    if (mine) return say('to', nameOf(one === me ? two : one), text)
    lastFrom = sender
    say('from', who, text)
  }

  function presence(e: ChannelPresenceEvent) {
    const here = present.get(e.channel_id)
    if (!here) return
    for (const p of e.joins ?? []) here.add(p.user_id)
    for (const p of e.leaves ?? []) here.delete(p.user_id)
    changed()
  }

  // Someone opened a direct chat with the player: joined back when they're in the match.
  function notified(n: Notification) {
    if (n.code !== DM_REQUEST || !n.sender_id) return
    if (seatOf(n.sender_id) >= 0 && !muted.has(n.sender_id)) void whisperChannel(n.sender_id).catch(() => {})
    const id = n.id
    if (id)
      void player().then(
        (p) => nakama.deleteNotifications(p.session, [id]),
        () => {},
      ) // they're kept otherwise
  }

  async function join(key: string, target: string, type: 1 | 2) {
    if (!socket) throw new Error('Chat is offline')
    const channel = await socket.joinChat(target, type, false, type === 1) // a room's presence is hidden; a whisper's shows (its sender waits for it)
    // nakama-js types `presences` as an array, but it's absent when nobody else is in the channel
    const others: Channel['presences'] | undefined = channel.presences
    present.set(channel.id, new Set((others ?? []).map((p) => p.user_id)))
    joined.set(key, channel)
    return channel
  }
  const whisperChannel = async (uid: string) => joined.get(uid) ?? join(uid, uid, 2)

  async function connect(next: Socket | null) {
    socket = next
    joined.clear()
    present.clear()
    if (!next) {
      if (!offline) note('Chat is offline — reconnecting')
      offline = true
      return
    }
    next.onchannelmessage = heard
    next.onchannelpresence = presence
    next.onnotification = notified
    try {
      await join('all', channels.all, 1)
      if (channels.team) await join('team', channels.team, 1)
      if (offline) note('Chat is back')
      offline = false
    } catch {
      note('Chat is unavailable')
    }
  }

  async function whisper(uid: string, text: string) {
    const name = nameOf(uid)
    const channel = await whisperChannel(uid)
    const here = present.get(channel.id) ?? new Set<string>()
    if (!here.has(uid)) {
      await new Promise<void>((resolve) => {
        const started = performance.now()
        const wait = () => (here.has(uid) || performance.now() - started > REACH ? resolve() : setTimeout(wait, 100))
        wait()
      })
      if (!here.has(uid)) return note(`${name} can't be reached right now`)
    }
    await socket!.writeChatMessage(channel.id, { text })
  }

  // What the player typed (chatCommand.ts reads it), to `to` (the room or their team).
  async function send(typed: string, to: 'all' | 'team') {
    const intent = readChat(typed, others())
    if (!intent) return
    try {
      switch (intent.do) {
        case 'say': {
          const channel = joined.get(to) ?? joined.get('all')
          if (!socket || !channel) return note('Chat is offline')
          await socket.writeChatMessage(channel.id, { text: intent.text })
          return
        }
        case 'whisper':
          return await whisper(intent.to.uid, intent.text)
        case 'reply':
          if (!lastFrom || seatOf(lastFrom) < 0) return note('No one in this match has whispered to you')
          return await whisper(lastFrom, intent.text)
        case 'mute':
          muted.add(intent.who.uid)
          return note(`${intent.who.name} is muted`)
        case 'unmute':
          muted.delete(intent.who.uid)
          return note(`${intent.who.name} is no longer muted`)
        case 'note':
          return note(intent.text)
      }
    } catch (error) {
      note(reason(error))
    }
  }

  return {
    lines: lines as readonly ChatLine[],
    team: !!channels.team,
    send,
    note, // a line from the page itself (a custom lobby's: who joined, left, what changed)
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    version: () => version,
    // Joins the match's channels on the page's socket (again after each reconnect) until dispose.
    start() {
      void player().then(
        (p) => (me = p.session.user_id ?? ''),
        () => {},
      )
      unsubscribe = onSocket((s) => void connect(s))
    },
    dispose() {
      unsubscribe()
      unsubscribe = () => {}
      const s = socket
      socket = null
      for (const channel of joined.values()) void s?.leaveChat(channel.id).catch(() => {})
      joined.clear()
      present.clear()
    },
  }
}

// Why Nakama refused a message (chat.lua's words, or the socket's), for the player.
function reason(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return 'The message didn’t go through'
}
