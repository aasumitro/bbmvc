// Smoke test for the match chat on a running Nakama (nakama/data/modules/chat.lua,
// the game's net/chat.ts): two guests on the realtime socket.
//   - A room chat under a name like the game server's (sy- and 24 hex digits): a
//     message goes to both, and nothing is stored.
//   - A room under any other name is refused, and a group chat too; the socket
//     stays open.
//   - A message over 200 characters, an empty one, or one that isn't {"text"} is
//     refused; the ninth message in 10 s is refused.
//   - A whisper: one guest opens a direct chat, the other hears Nakama's
//     "wants to chat" and joins, the message arrives.
//   - Edits are refused.
// Deletes the guests it made.
//   local:  node scripts/chat-smoke.mjs
//   server: NAKAMA_URL=https://api.example.com NAKAMA_CLIENT_KEY=... node scripts/chat-smoke.mjs
// Node 22+ (global fetch and WebSocket). Exits non-zero on the first failure.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

const url = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350'
const basic = 'Basic ' + Buffer.from(`${process.env.NAKAMA_CLIENT_KEY ?? 'defaultkey'}:`).toString('base64')
const bearer = (session) => 'Bearer ' + session.token

async function call(method, path, { auth = basic, body } = {}) {
  const res = await fetch(url + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : {} }
}

// A guest's realtime socket: requests by cid, and everything else it hears, kept.
async function connect(session) {
  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/ws?lang=en&status=true&token=${session.token}`)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('socket: connection failed'))
  })
  const heard = []
  const waiting = new Map()
  let cid = 0
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.cid && waiting.has(m.cid)) {
      waiting.get(m.cid)(m)
      waiting.delete(m.cid)
    } else heard.push(m)
  }
  const ask = (message) =>
    new Promise((resolve, reject) => {
      const id = String(++cid)
      const timer = setTimeout(() => reject(new Error(`socket: no reply to ${JSON.stringify(message).slice(0, 80)}`)), 5000)
      waiting.set(id, (m) => {
        clearTimeout(timer)
        resolve(m)
      })
      socket.send(JSON.stringify({ cid: id, ...message }))
    })
  const until = async (found, what, ms = 5000) => {
    const end = Date.now() + ms
    for (;;) {
      const m = heard.find(found)
      if (m) return m
      if (Date.now() > end) throw new Error(`socket: never heard ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  return { socket, heard, ask, until, open: () => socket.readyState === WebSocket.OPEN }
}

const join = (s, target, type, persistence = true) => s.ask({ channel_join: { target, type, persistence, hidden: false } })
const say = (s, channel, content) => s.ask({ channel_message_send: { channel_id: channel, content: typeof content === 'string' ? content : JSON.stringify(content) } })
const refused = (reply) => !!reply.error

const made = []
try {
  for (let n = 0; n < 2; n++) {
    const guest = (await call('POST', '/v2/account/authenticate/device?create=true', { body: { id: crypto.randomUUID() } })).body
    assert.ok(guest.token, 'guest sign-in')
    made.push(guest)
  }
  const [a, b] = await Promise.all(made.map(connect))
  const uid = (session) => JSON.parse(Buffer.from(session.token.split('.')[1], 'base64url')).uid

  // the room's chat, as the game server names it
  const room = `sy-${randomBytes(12).toString('hex')}`
  const [inA, inB] = [await join(a, room, 1), await join(b, room, 1)]
  assert.ok(inA.channel?.id && inA.channel.id === inB.channel?.id, `join the room chat: ${JSON.stringify(inA)}`)
  const ack = await say(a, inA.channel.id, { text: 'gg' })
  assert.ok(ack.channel_message_ack, `send: ${JSON.stringify(ack)}`)
  assert.notEqual(ack.channel_message_ack.persistent ?? ack.channel_message_ack.persistence, true, 'nothing is stored, whatever the page asked (chat.lua)')
  const got = await b.until((m) => m.channel_message?.channel_id === inA.channel.id, 'the room message')
  assert.equal(JSON.parse(got.channel_message.content).text, 'gg', 'the other guest hears it')
  const history = await call('GET', `/v2/channel/${encodeURIComponent(inA.channel.id)}?limit=10`, { auth: bearer(made[1]) })
  assert.ok(!history.body.messages?.length, `no history kept: ${JSON.stringify(history.body)}`)
  console.log('ok  room chat: a message to both, nothing stored')

  // what chat.lua refuses, with the socket left open
  assert.ok(refused(await join(a, 'lobby', 1)), 'a room under a name that isn’t the game’s is refused')
  assert.ok(refused(await join(a, crypto.randomUUID(), 3)), 'a group chat is refused')
  assert.ok(refused(await say(a, inA.channel.id, { text: 'x'.repeat(201) })), 'over 200 characters is refused')
  assert.ok(!refused(await say(a, inA.channel.id, { text: 'é'.repeat(200) })), '200 characters, counted as characters, not bytes, pass')
  assert.ok(refused(await say(a, inA.channel.id, { text: '' })) && refused(await say(a, inA.channel.id, { hello: 'there' })), 'an empty message, or one without text, is refused')
  assert.ok(a.open(), 'refusals leave the socket open')
  console.log('ok  refused: rooms not the game’s, groups, over 200 characters, empty, not {"text"}; the socket stays open')

  // 8 messages in 10 s at most: 17 in a moment span two of chat.lua's 10 s windows at most, so some are refused
  const sent = []
  for (let n = 0; n < 17; n++) sent.push(await say(a, inA.channel.id, { text: `spam ${n}` }))
  const passed = sent.filter((reply) => !refused(reply)).length
  assert.ok(passed >= 6 && passed <= 16 && refused(sent.at(-1)), `a burst is cut off at 8 messages in 10 s (${sent.map((r) => (refused(r) ? 'x' : '.')).join('')})`)
  assert.ok(!refused(await say(b, inA.channel.id, { text: 'me too' })), 'the limit is each user’s own')
  console.log('ok  rate: 8 messages in 10 s a user')

  // a whisper: a opens a direct chat; b hears Nakama's "wants to chat" and joins; the message arrives
  const dmA = await join(a, uid(made[1]), 2, false)
  assert.ok(dmA.channel?.id, `open a direct chat: ${JSON.stringify(dmA)}`)
  const asked = await b.until((m) => m.notifications?.notifications?.some((n) => n.code === -1 && n.sender_id === uid(made[0])), 'the direct chat request')
  assert.ok(asked, 'the other guest is told someone wants to chat')
  const dmB = await join(b, uid(made[0]), 2, false)
  assert.equal(dmB.channel?.id, dmA.channel.id, 'and joins the same direct chat')
  await a.until((m) => m.channel_presence_event?.joins?.some((p) => p.user_id === uid(made[1])), 'the other guest joining')
  await new Promise((resolve) => setTimeout(resolve, 10_500)) // the rate window from above runs out
  assert.ok(!refused(await say(a, dmA.channel.id, { text: 'psst' })), 'whisper sent')
  const whisper = await b.until((m) => m.channel_message?.channel_id === dmA.channel.id, 'the whisper')
  assert.equal(JSON.parse(whisper.channel_message.content).text, 'psst', 'the whisper arrives')
  console.log('ok  whisper: requested, joined back, delivered')

  assert.ok(refused(await a.ask({ channel_message_update: { channel_id: inA.channel.id, message_id: ack.channel_message_ack.message_id, content: JSON.stringify({ text: 'edited' }) } })), 'an edit is refused')
  console.log('ok  edits refused')
  a.socket.close()
  b.socket.close()
} finally {
  const gone = await Promise.all(made.map(async (session) => (await call('DELETE', '/v2/account', { auth: bearer(session) })).status))
  console.log(gone.every((status) => status === 200) ? `ok  cleanup: ${gone.length} guests deleted` : `!!  cleanup statuses: ${gone.join(', ')}`)
}
