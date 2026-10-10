import { ask } from '../../net/lobbies.ts'
import type { LobbyView } from '../../net/lobbyProtocol.ts'
import { label, SECONDARY } from './kit.ts'

// The lobby's invite code (Lobby.tsx), its link to the clipboard, and the
// owner's Reset: a new code, the old link stops working.

export function InviteCard({ lobby, owner, copied, onCopy: copy }: { lobby: LobbyView; owner: boolean; copied: boolean; onCopy: () => void }) {
  return (
    <div className="border-t border-white/10 px-3 py-3">
      <span className={label}>Invite</span>
      <p className="mt-1 font-mono text-xl tracking-[0.2em] text-[#f2ece0]">{`${lobby.code.slice(0, 4)}-${lobby.code.slice(4)}`}</p>
      <div className="mt-2 flex gap-2">
        <button onClick={copy} className={SECONDARY}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {owner && (
          <button onClick={() => ask({ t: 'lb', do: 'reset' })} title="A new code: the old link stops working" className={SECONDARY}>
            Reset
          </button>
        )}
      </div>
    </div>
  )
}
