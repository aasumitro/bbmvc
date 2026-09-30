// Self-check for what a line typed into the match chat asks for
// (chatCommand.ts): messages, whispers by whole or partial names, names with
// spaces, replies, mute, and the notes the page answers itself. Plain node:
// node src/net/chat.check.ts
import { CHAT_HELP, CHAT_LIMIT, readChat, type Person } from './chatCommand.ts'

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`chat: ${what}`)
  checks++
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const people: Person[] = [
  { uid: 'u1', name: 'Guest ab12' },
  { uid: 'u2', name: 'Guest cd34' },
  { uid: 'u3', name: 'Rustbucket' },
  { uid: 'u4', name: 'rusty' },
]

check(readChat('   ', people) === null, 'nothing typed: nothing to do')
check(same(readChat('  gg wp  ', people), { do: 'say', text: 'gg wp' }), 'a message, trimmed')
check((readChat('x'.repeat(CHAT_LIMIT + 50), people) as { text: string }).text.length === CHAT_LIMIT, `a message is cut to ${CHAT_LIMIT} characters`)

check(same(readChat('/w Guest ab12 behind you', people), { do: 'whisper', to: people[0], text: 'behind you' }), 'a whisper to a name with a space in it')
check(same(readChat('/W guest CD34 hi', people), { do: 'whisper', to: people[1], text: 'hi' }), 'names and commands are matched case aside')
check(same(readChat('/w rustb on it', people), { do: 'whisper', to: people[2], text: 'on it' }), 'the start of just one name will do')
check(same(readChat('/w rusty ok', people), { do: 'whisper', to: people[3], text: 'ok' }), 'a whole name beats a longer one it starts')
check(same(readChat('/w Guest hi', people), { do: 'note', text: 'No one here is called Guest' }), 'the start of two names is no one')
check(same(readChat('/whisper nobody hi', people), { do: 'note', text: 'No one here is called nobody' }), 'a name nobody has')
check(same(readChat('/w Guest ab12', people), { do: 'note', text: 'What to whisper to Guest ab12?' }) && same(readChat('/w', people), { do: 'note', text: 'Whisper to whom? /w name text' }), 'a whisper needs someone and something')

check(same(readChat('/r thanks', people), { do: 'reply', text: 'thanks' }) && same(readChat('/r', people), { do: 'note', text: 'Reply what?' }), 'a reply, and one with nothing to say')
check(same(readChat('/mute Guest cd34', people), { do: 'mute', who: people[1] }) && same(readChat('/unmute rustb', people), { do: 'unmute', who: people[2] }), 'mute and unmute, by whole or partial name')
check(same(readChat('/mute', people), { do: 'note', text: '/mute whom?' }), 'mute whom')
check(same(readChat('/dance', people), { do: 'note', text: CHAT_HELP }) && same(readChat('/help', people), { do: 'note', text: CHAT_HELP }), 'anything else: the help')

console.log(`chat ok (${checks} checks)`)
