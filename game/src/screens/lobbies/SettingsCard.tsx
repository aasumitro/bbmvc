import { MAPS, type MapId } from '../../content/arenas/maps.ts'
import { ITEM_GROUPS, killLimitLabel, minutes, RESPAWN_LABELS, weaponsLabel } from '../../modes/matchSettings.ts'
import { MODES } from '../../modes/modes.ts'
import type { LobbyView } from '../../net/lobbyProtocol.ts'
import { Lock } from './Lobbies.tsx'
import { label, modeOf, traitsOf } from './kit.ts'

// The waiting room's arena and the match's settings (Lobby.tsx), with the
// owner's Edit (while the lobby waits); a lock for everyone else.

export function SettingsCard({ lobby, owner, onEdit }: { lobby: LobbyView; owner: boolean; onEdit: () => void }) {
  const waiting = lobby.phase === 'waiting'
  const teams = traitsOf(lobby).teams
  const items = ITEM_GROUPS.filter(({ id }) => lobby.settings.items[id]).map((group) => group.label)
  const settingLines: Array<[string, string]> = [
    ['Mode', MODES[modeOf(lobby)]?.label ?? lobby.mode],
    ['Players', teams ? `${lobby.size / 2} v ${lobby.size / 2}` : `Up to ${lobby.size}`],
    ['Length', minutes(lobby.settings.duration)],
    ['Respawn', RESPAWN_LABELS[lobby.settings.respawn]],
    ...(traitsOf(lobby).friendlyFire ? [['Friendly fire', lobby.settings.friendlyFire ? 'On' : 'Off'] as [string, string]] : []),
    ['Pickups', !items.length ? 'Off' : items.length === ITEM_GROUPS.length ? 'All' : items.join(', ')],
    ['Weapons', weaponsLabel(lobby.settings.weapons)],
    ['Kill limit', killLimitLabel(lobby.settings.killLimit)],
    ['Join in progress', lobby.jip ? 'On' : 'Off'],
  ]

  return (
    <>
      <div className="relative aspect-2/1 shrink-0 overflow-hidden">
        <img src={MAPS[lobby.map as MapId]?.image} alt="" className="h-full w-full object-cover" />
        <p className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 to-transparent px-3 pt-6 pb-2 font-display text-xl font-semibold">
          {MAPS[lobby.map as MapId]?.name ?? lobby.map}
        </p>
      </div>
      <div className="flex items-center justify-between px-3 pt-3">
        <span className={label}>Match settings</span>
        {owner ? (
          <button
            onClick={onEdit}
            disabled={!waiting}
            className="text-xs font-bold tracking-[0.15em] text-red-400 uppercase hover:text-red-300 disabled:opacity-40"
          >
            Edit
          </button>
        ) : (
          <span title="Only the owner changes these" className="text-neutral-500">
            <Lock className="h-3 w-3 text-neutral-500" />
          </span>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-3 py-3 text-sm">
        {settingLines.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-neutral-400">{name}</dt>
            <dd className="text-right font-bold">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}
