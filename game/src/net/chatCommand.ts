// What a line typed into the match chat asks for (net/chat.ts does it): a
// message, a whisper to someone in the match (`/w name text`), a reply to the
// last whisper (`/r text`), muting or unmuting someone (`/mute name`,
// `/unmute name`), or a note the page answers itself (help, a name nobody
// has, nothing to say). A name is anyone's whole name, case aside, or the
// start of just one; names may have spaces ("Guest ab12"): the longest run of
// words that names someone does. Pure (plain node: chat.check.ts).

export const CHAT_LIMIT = 200 // characters a message may have (nakama/data/modules/chat.lua holds everyone to it)

export interface Person {
  uid: string
  name: string
}

export type ChatIntent =
  | { do: 'say'; text: string }
  | { do: 'whisper'; to: Person; text: string }
  | { do: 'reply'; text: string }
  | { do: 'mute' | 'unmute'; who: Person }
  | { do: 'note'; text: string }

export const CHAT_HELP = 'Enter: everyone · T: your team · /w name text: whisper · /r text: reply · /mute name · /unmute name'

// `people`: the others in the match, as they're named now.
export function readChat(typed: string, people: readonly Person[]): ChatIntent | null {
  const text = typed.trim().slice(0, CHAT_LIMIT)
  if (!text) return null
  if (!text.startsWith('/')) return { do: 'say', text }
  const [command, ...words] = text.split(/\s+/)
  switch (command.toLowerCase()) {
    case '/w':
    case '/whisper': {
      const to = addressee(words, people)
      if (!to) return { do: 'note', text: words.length ? `No one here is called ${words[0]}` : 'Whisper to whom? /w name text' }
      if (!to.rest.length) return { do: 'note', text: `What to whisper to ${to.person.name}?` }
      return { do: 'whisper', to: to.person, text: to.rest.join(' ') }
    }
    case '/r':
    case '/reply':
      return words.length ? { do: 'reply', text: words.join(' ') } : { do: 'note', text: 'Reply what?' }
    case '/mute':
    case '/unmute': {
      const who = words.length ? named(words.join(' '), people) : undefined
      if (!who) return { do: 'note', text: words.length ? `No one here is called ${words.join(' ')}` : `${command} whom?` }
      return { do: command.toLowerCase() === '/mute' ? 'mute' : 'unmute', who }
    }
    default:
      return { do: 'note', text: CHAT_HELP }
  }
}

// Someone by their whole name, case aside, else by the start of just one name.
export function named(query: string, people: readonly Person[]) {
  const q = query.toLowerCase()
  const exact = people.find((p) => p.name.toLowerCase() === q)
  if (exact) return exact
  const starting = people.filter((p) => p.name.toLowerCase().startsWith(q))
  return starting.length === 1 ? starting[0] : undefined
}

// The person the first words name (the longest run that names someone), and the words after.
function addressee(words: readonly string[], people: readonly Person[]) {
  for (let n = words.length; n >= 1; n--) {
    const person = named(words.slice(0, n).join(' '), people)
    if (person) return { person, rest: words.slice(n) }
  }
  return null
}
