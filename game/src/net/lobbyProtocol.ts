import type { Difficulty } from '../sim/difficulty.ts'
import { checkSettings, CUSTOM, type MatchSettings } from '../modes/matchSettings.ts'
import type { Mode } from '../modes/ids.ts'
import { MAX_SEATS } from '../modes/traits.ts'
import { LIMITS, optional, text } from './limits.ts'

// The custom lobbies' wire, beside the match's (protocol.ts, which hands
// this every 'lb' message): what a page asks of a lobby, what it is told,
// and the check every such message passes before server/lobbies.ts acts on it.

// Custom lobbies (server/lobbies.ts): watch the list, make or join a lobby,
// and everything a member or its owner does there (.claude/work/custom/PLAN.md §8).
const LOBBY_ACTIONS = [
  'watch',
  'unwatch',
  'create',
  'join',
  'code',
  'back',
  'leave',
  'ready',
  'slot',
  'start',
  'edit',
  'kick',
  'owner',
  'bot',
  'unbot',
  'reset',
  'play',
  'wait',
] as const
export const INVITE = /^[0-9A-HJKMNP-TV-Z]{8}$/ // an invite code: eight Crockford base32 characters (no I, L, O or U)
// A code as typed, read out or put in a link: dashes and spaces dropped, the letters Crockford reads as digits turned into them.
export const readCode = (typed: string) =>
  typed
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
export const LOBBY_FORM = { name: [3, LIMITS.lobby], password: [4, LIMITS.password] } // lengths the form keeps to and the server holds it to (a name tidied first)

// A name as shown: control characters out, inner spaces collapsed, trimmed.
export const tidy = (text: string) =>
  text
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

// A lobby as its owner fills in the form (create, edit).
export interface LobbyForm {
  name: string
  open: boolean // listed; closed: by invite only
  password: string | null // '' for none (public lobbies only); null: as it was (an edit: the password is never sent back)
  mode: Mode
  map: string
  settings: MatchSettings
  jip: boolean // join in progress: newcomers go straight into a running match
}

export type Lobbying =
  | { t: 'lb'; do: 'watch' | 'unwatch' | 'leave' | 'start' | 'reset' | 'play' | 'wait' } // play / wait: into the running match / back to the waiting room
  | { t: 'lb'; do: 'create' | 'edit'; form: LobbyForm }
  | { t: 'lb'; do: 'join'; id: string; password: string } // from the list
  | { t: 'lb'; do: 'code'; code: string } // an invite link or a typed code
  | { t: 'lb'; do: 'back'; id: string } // after a drop or a reload
  | { t: 'lb'; do: 'ready'; on: boolean }
  | { t: 'lb'; do: 'slot' | 'unbot'; slot: number } // slot: team deathmatch, move to an open slot
  | { t: 'lb'; do: 'bot'; slot: number; skill: Difficulty }
  | { t: 'lb'; do: 'kick' | 'owner'; uid: string }

// A lobby as the list shows it: never its code, password or anyone's user id.
export interface LobbyRow {
  id: string
  name: string
  host: string // the owner's name
  mode: string
  map: string
  people: number
  bots: number
  size: number // the most the match takes
  duration: number // seconds
  locked: boolean // a password
  phase: 'waiting' | 'playing'
  left: number // seconds left of the match being played; 0 while waiting
  jip: boolean
}

export type LobbySlot =
  { kind: 'empty' } | { kind: 'person'; uid: string; name: string; ready: boolean; away: boolean; owner: boolean } | { kind: 'bot'; skill: Difficulty }

// A lobby as its members see it.
export interface LobbyView extends LobbyRow {
  code: string // the invite
  open: boolean
  settings: MatchSettings
  slots: LobbySlot[] // the match's seats: slot i is seat i
  chat: string // the lobby's chat channel (it carries on into the match)
  tally: Record<string, number> // this lobby's wins: by side ('0', '1'), or by user id ('bot:' + slot for a bot)
  you: number // your slot
  playing: boolean // you're in the match being played
  heir: string // who becomes the owner if the owner leaves (the longest there): their name; '' nobody (the lobby would close)
}

// Why a page is out of a lobby, or wasn't let in: the lobby is gone, full,
// the password was wrong (too often: slow), they're banned or were kicked,
// the owner left and nobody was left (deleted), it sat idle (closed), no room
// was free to start (busy), too many lobbies (cap), already in one (taken).
export type LobbyNote = 'gone' | 'full' | 'password' | 'slow' | 'banned' | 'kicked' | 'deleted' | 'closed' | 'busy' | 'cap' | 'taken'

export type LobbyMessage =
  | { t: 'lbs'; list: LobbyRow[] } // the list, to its watchers
  | { t: 'lb'; lobby: LobbyView | null; note?: LobbyNote } // a member's lobby, whenever it changes; null: out of it

type Checked = { ok: true; message: Lobbying } | { ok: false; error: string }
const refuse = (error: string): Checked => ({ ok: false, error })

// A lobby message, checked: its size, the action, and each field it names —
// strings within their limits, whole numbers in range, the form's settings by
// checkSettings. The map is the server's to check against the registry.
export function lobbying(m: Record<string, unknown>, bytes: number): Checked {
  if (bytes > LIMITS.input) return refuse('lobby message too large')
  const act = LOBBY_ACTIONS.find((a) => a === m.do)
  if (!act) return refuse('bad lobby action')
  const slot = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < MAX_SEATS
  switch (act) {
    case 'create':
    case 'edit': {
      const { name, open, password, mode, map, jip } = m
      if (!text(name, LIMITS.lobby) || typeof open !== 'boolean' || typeof jip !== 'boolean') return refuse('bad lobby form')
      if (!(password === null || optional(password, LIMITS.password))) return refuse('bad password')
      const kind = CUSTOM.modes.find((each) => each === mode)
      if (!kind || !text(map, LIMITS.name)) return refuse('bad mode or map')
      const checked = checkSettings(kind, m.settings)
      if (!checked.ok) return refuse('bad settings')
      return { ok: true, message: { t: 'lb', do: act, form: { name, open, password, mode: kind, map, settings: checked.settings, jip } } }
    }
    case 'join':
      return text(m.id, LIMITS.code) && optional(m.password ?? '', LIMITS.password)
        ? { ok: true, message: { t: 'lb', do: act, id: m.id, password: (m.password as string | undefined) ?? '' } }
        : refuse('bad join')
    case 'code':
      return typeof m.code === 'string' && INVITE.test(m.code) ? { ok: true, message: { t: 'lb', do: act, code: m.code } } : refuse('bad code')
    case 'back':
      return text(m.id, LIMITS.code) ? { ok: true, message: { t: 'lb', do: act, id: m.id } } : refuse('bad lobby id')
    case 'ready':
      return typeof m.on === 'boolean' ? { ok: true, message: { t: 'lb', do: act, on: m.on } } : refuse('bad ready')
    case 'slot':
    case 'unbot':
      return slot(m.slot) ? { ok: true, message: { t: 'lb', do: act, slot: m.slot } } : refuse('bad slot')
    case 'bot': {
      const skill = CUSTOM.skills.find((each) => each === m.skill)
      return slot(m.slot) && skill ? { ok: true, message: { t: 'lb', do: act, slot: m.slot, skill } } : refuse('bad bot')
    }
    case 'kick':
    case 'owner':
      return text(m.uid, LIMITS.uid) ? { ok: true, message: { t: 'lb', do: act, uid: m.uid } } : refuse('bad member')
    default:
      return { ok: true, message: { t: 'lb', do: act } }
  }
}
