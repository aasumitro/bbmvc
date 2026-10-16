import type { Mode } from '../../modes/ids.ts'
import { MODE_TRAITS } from '../../modes/traits.ts'
import type { LobbyView } from '../../net/lobbyProtocol.ts'

// What the waiting room's parts (Lobby.tsx, SlotGrid.tsx, SettingsCard.tsx,
// InviteCard.tsx) share: their class names and the lobby's mode.

export const keycap = 'rounded border border-neutral-500/50 px-1.5 py-0.5'
export const label = 'text-[0.65rem] font-bold tracking-[0.3em] text-neutral-300 uppercase'
export const PRIMARY =
  'rounded border-2 border-red-500 bg-black/55 px-5 py-2.5 text-sm font-bold tracking-[0.15em] whitespace-nowrap text-white uppercase shadow-[0_0_18px_rgba(239,68,68,0.45)] hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none'
export const SECONDARY =
  'rounded border border-white/25 bg-black/55 px-4 py-2 text-xs font-bold tracking-[0.15em] whitespace-nowrap text-white uppercase hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-50'
export const modeOf = (lobby: LobbyView) => lobby.mode as Mode // the server's, from its own registry
export const traitsOf = (lobby: LobbyView) => MODE_TRAITS[modeOf(lobby)]
