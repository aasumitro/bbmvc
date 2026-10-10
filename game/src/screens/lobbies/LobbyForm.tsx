import { useState, type ReactNode } from 'react'
import { WEAPONS } from '../../content/weapons/weapons.ts'
import { MAPS, mapsFor, type MapId } from '../../content/arenas/maps.ts'
import { checkSettings, classic, CUSTOM, ITEM_GROUPS, killLimitLabel, RESPAWN_LABELS, type MatchSettings } from '../../modes/matchSettings.ts'
import { MODES } from '../../modes/modes.ts'
import type { Mode } from '../../modes/ids.ts'
import { MODE_TRAITS } from '../../modes/traits.ts'
import { ask } from '../../net/lobbies.ts'
import { LOBBY_FORM, tidy, type LobbyView } from '../../net/lobbyProtocol.ts'
import { Drawer } from '../Drawer.tsx'
import { Segmented } from '../Menu.tsx'

interface LobbyFormProps {
  lobby: LobbyView | null // Edit: the lobby as it stands; null: Create
  host: string // the player's name: a new lobby's is theirs
  asked: boolean // sent; the server's word is on its way
  onClose: () => void
}

// A lobby made or edited (.claude/work/custom/PLAN.md §2, §9.3): its name,
// who sees it, then the match. Only what the game server enforces is here,
// from what CUSTOM offers; checkSettings, the server's own check, marks
// anything off beside its field. Advanced starts folded. The drawer stays
// open until the server says yes — Create lands in the waiting room, Save
// closes it — or shows the server's no, for another try.
export function LobbyForm({ lobby, host, asked, onClose }: LobbyFormProps) {
  const [name, setName] = useState(lobby?.name ?? `${host}’s lobby`)
  const [open, setOpen] = useState(lobby?.open ?? true)
  const [password, setPassword] = useState('') // typed: a new one; empty: none (an edit: as it was)
  const [unlock, setUnlock] = useState(false) // an edit: the password taken off
  const [mode, setMode] = useState<Mode>((lobby?.mode as Mode) ?? CUSTOM.modes[0])
  const [map, setMap] = useState<MapId>((lobby?.map as MapId) ?? mapsFor(CUSTOM.modes[0])[0])
  const [settings, setSettings] = useState<MatchSettings>(lobby?.settings ?? classic(CUSTOM.modes[0]))
  const [jip, setJip] = useState(lobby?.jip ?? true)
  const [advanced, setAdvanced] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [refused, setRefused] = useState('') // the server's no
  const filled = lobby ? lobby.slots.filter((slot) => slot.kind !== 'empty').length : 1 // the size can't drop below who's in
  const { teams, friendlyFire } = MODE_TRAITS[mode]
  const sizes = MODE_TRAITS[mode].sizes.filter((size) => size >= filled)
  const change = (next: Partial<MatchSettings>) => setSettings({ ...settings, ...next })

  function changeMode(next: Mode) {
    const fits = MODE_TRAITS[next].sizes.filter((size) => size >= filled)
    setMode(next)
    if (!mapsFor(next).includes(map)) setMap(mapsFor(next)[0])
    setSettings({
      ...settings,
      size: fits.find((size) => size >= settings.size) ?? fits[fits.length - 1],
      friendlyFire: MODE_TRAITS[next].friendlyFire && settings.friendlyFire,
      items: classic(next).items,
    }) // pickups as the mode plays them in Classic
  }

  async function submit() {
    const tidied = tidy(name)
    const [least, most] = LOBBY_FORM.name
    const [short, long] = LOBBY_FORM.password
    const checked = checkSettings(mode, settings)
    const found: Record<string, string> = checked.ok ? {} : { ...checked.errors }
    if (tidied.length < least || tidied.length > most) found.name = `A name of ${least} to ${most} characters`
    if (open && password && (password.length < short || password.length > long)) found.password = `A password of ${short} to ${long} characters, or none`
    setErrors(found)
    if (!checked.ok || Object.keys(found).length) return
    setRefused('')
    const kept = !!lobby?.locked && !unlock && !password // an edit leaving the password as it was
    const no = await ask({
      t: 'lb',
      do: lobby ? 'edit' : 'create',
      name: tidied,
      open,
      password: !open ? '' : kept ? null : password,
      mode,
      map,
      settings: checked.settings,
      jip,
    })
    if (no) setRefused(no)
    else onClose() // Create's yes has landed in the waiting room already
  }

  const action = lobby ? (asked ? 'Saving…' : 'Save') : asked ? 'Creating…' : 'Create lobby'
  return (
    <Drawer
      kicker={lobby ? 'Waiting room' : 'Custom'}
      title={lobby ? 'Edit lobby' : 'Create lobby'}
      onClose={onClose}
      footer={
        <button
          onClick={() => void submit()}
          disabled={asked}
          className="rounded border-2 border-red-500 bg-black/55 px-4 py-2 font-bold tracking-[0.15em] text-white shadow-[0_0_18px_rgba(239,68,68,0.45)] disabled:cursor-wait disabled:opacity-60"
        >
          {action}
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Lobby name" error={errors.name}>
          <input value={name} maxLength={LOBBY_FORM.name[1]} onChange={(e) => setName(e.target.value)} aria-label="Lobby name" className={INPUT} />
        </Field>
        <Field label="Who can join" hint={open ? 'Listed: anyone can join, the invite link too' : 'Not listed: only with the invite link or code'}>
          <Segmented
            label="Who can join"
            options={[
              { id: true, label: 'Public' },
              { id: false, label: 'Invite only' },
            ]}
            value={open}
            onChange={setOpen}
          />
        </Field>
        {open && (
          <Field
            label="Password"
            error={errors.password}
            hint={
              lobby?.locked
                ? unlock
                  ? 'The password comes off'
                  : 'Kept as it is — type a new one to change it'
                : 'Optional: asked of anyone joining from the list, never of the invite link'
            }
          >
            <div className="flex items-center gap-3">
              <input
                type="password"
                value={password}
                disabled={unlock}
                maxLength={LOBBY_FORM.password[1]}
                autoComplete="new-password"
                placeholder={lobby?.locked ? '••••••' : 'None'}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password"
                className={INPUT}
              />
              {lobby?.locked && (
                <button
                  type="button"
                  onClick={() => setUnlock(!unlock)}
                  className="shrink-0 text-xs font-bold tracking-[0.15em] text-neutral-400 uppercase hover:text-white"
                >
                  {unlock ? 'Keep' : 'Remove'}
                </button>
              )}
            </div>
          </Field>
        )}
        <Field label="Mode">
          <Segmented label="Mode" options={CUSTOM.modes.map((id) => ({ id, label: MODES[id].label }))} value={mode} onChange={changeMode} />
        </Field>
        <Field label="Arena">
          <Segmented label="Arena" options={mapsFor(mode).map((id) => ({ id, label: MAPS[id].name }))} value={map} onChange={setMap} />
        </Field>
        <Field
          label="Players"
          error={errors.size}
          hint={`The most the match takes, bots included: it starts with fewer${teams ? ', and sides needn’t be even' : ''}`}
        >
          <Stepper
            values={sizes}
            value={settings.size}
            onChange={(size) => change({ size })}
            show={(size) => (teams ? `${size / 2} v ${size / 2}` : `${size}`)}
          />
        </Field>
        <Field label="Match length · minutes" error={errors.duration}>
          <Segmented
            label="Match length in minutes"
            options={CUSTOM.durations.map((id) => ({ id, label: String(id / 60) }))}
            value={settings.duration}
            onChange={(duration) => change({ duration })}
          />
        </Field>
        <Field label="Join in progress" hint={jip ? 'Someone joining mid-match goes straight in' : 'Someone joining mid-match waits for the next one'}>
          <Segmented label="Join in progress" options={OFF_ON} value={jip} onChange={setJip} />
        </Field>

        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
          className="mt-8 flex w-full items-center justify-between border-t border-white/10 pt-5 text-xs font-bold tracking-[0.3em] text-neutral-300 uppercase hover:text-white"
        >
          Advanced
          <span className={`transition-transform ${advanced ? 'rotate-90' : ''}`}>›</span>
        </button>
        {advanced && (
          <div className="mt-6">
            <Field label="Respawn" error={errors.respawn}>
              <Segmented
                label="Respawn"
                options={CUSTOM.respawns.map((id) => ({ id, label: RESPAWN_LABELS[id] }))}
                value={settings.respawn}
                onChange={(respawn) => change({ respawn })}
              />
            </Field>
            {friendlyFire && (
              <Field
                label="Friendly fire"
                error={errors.friendlyFire}
                hint={settings.friendlyFire ? 'Teammates’ rounds and rockets hurt; a team kill costs the team a point' : undefined}
              >
                <Segmented label="Friendly fire" options={OFF_ON} value={settings.friendlyFire} onChange={(friendlyFire) => change({ friendlyFire })} />
              </Field>
            )}
            <Field label="Pickups" error={errors.items} hint="Health: health and repair · Power-ups: speed, armor and damage">
              <div className="flex gap-2">
                {ITEM_GROUPS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={settings.items[id]}
                    onClick={() => change({ items: { ...settings.items, [id]: !settings.items[id] } })}
                    className={`rounded-md border px-4 py-1.5 text-xs font-bold tracking-[0.2em] uppercase ${settings.items[id] ? 'border-red-500/60 bg-red-500/25 text-white' : 'border-white/15 bg-black/45 text-neutral-500 line-through hover:text-neutral-300'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label="Weapons"
              error={errors.weapons}
              hint={settings.weapons === 'all' ? 'Each driver’s own loadout' : 'Everyone, bots too, drives with this gun'}
            >
              <Segmented
                label="Weapons"
                options={CUSTOM.weapons.map((id) => ({ id, label: id === 'all' ? 'All' : WEAPONS[id].name }))}
                value={settings.weapons}
                onChange={(weapons) => change({ weapons })}
              />
            </Field>
            <Field
              label="Kill limit"
              error={errors.killLimit}
              hint={settings.killLimit ? `The first ${teams ? 'team' : 'machine'} to ${settings.killLimit} kills wins at once` : 'The clock decides'}
            >
              <Segmented
                label="Kill limit"
                options={CUSTOM.killLimits.map((id) => ({ id, label: killLimitLabel(id) }))}
                value={settings.killLimit}
                onChange={(limit) => change({ killLimit: limit })}
              />
            </Field>
          </div>
        )}
        {refused && (
          <p role="alert" className="mt-8 border-l-2 border-red-500 pl-3 font-display text-base text-red-300 italic">
            {refused}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Drawer>
  )
}

const INPUT =
  'w-full rounded-md border border-white/15 bg-black/45 px-3 py-2 text-sm text-[#f2ece0] outline-hidden placeholder:text-neutral-500 focus:border-red-500 disabled:opacity-50'
const OFF_ON = [
  { id: false, label: 'Off' },
  { id: true, label: 'On' },
]

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <p className="text-[0.65rem] font-bold tracking-[0.3em] text-neutral-300 uppercase">{label}</p>
      <div className="mt-2">{children}</div>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-red-400">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 font-display text-sm text-neutral-400 italic">{hint}</p>
      )}
    </div>
  )
}

// One of an ordered set, a step at a time: − value +.
function Stepper({ values, value, onChange, show }: { values: number[]; value: number; onChange: (value: number) => void; show: (value: number) => string }) {
  const at = values.indexOf(value)
  const step = 'flex h-8 w-9 items-center justify-center text-lg text-neutral-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="flex w-fit items-center overflow-hidden rounded-md border border-white/15 bg-black/45">
      <button type="button" aria-label="Fewer players" disabled={at <= 0} onClick={() => onChange(values[at - 1])} className={step}>
        −
      </button>
      <span className="min-w-20 border-x border-white/15 text-center text-sm leading-8 font-bold tabular-nums">{show(value)}</span>
      <button type="button" aria-label="More players" disabled={at < 0 || at >= values.length - 1} onClick={() => onChange(values[at + 1])} className={step}>
        +
      </button>
    </div>
  )
}
