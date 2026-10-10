import { useEffect, useState } from 'react'
import { QUALITY } from '../render/postprocessing.ts'
import { QUALITIES } from '../render/postprocessing.ts'
import { DEFAULT_SETTINGS, maxResolutionScale, onSettingsChange, renderScale, settings, updateSettings } from '../view/settings.ts'

const percent = (value: number) => Math.round(value * 100)

// Key bindings as input.ts and the menus read them.
// ponytail: fixed for now (input.ts matches key codes directly); rebinding means
// moving these into settings.ts, saved with the rest (per account once online).
const CONTROLS = [
  {
    title: 'Driving',
    rows: [
      { keys: ['W'], action: 'Accelerate' },
      { keys: ['S'], action: 'Brake, then reverse' },
      { keys: ['A'], action: 'Steer left' },
      { keys: ['D'], action: 'Steer right' },
      { keys: ['Space'], action: 'Handbrake' },
      { keys: ['R'], action: 'Back on the road when stuck' },
    ],
  },
  {
    title: 'Combat',
    rows: [
      { keys: ['Click'], action: 'Capture the mouse' },
      { keys: ['Mouse'], action: 'Aim turret and camera' },
      { keys: ['LMB'], action: 'Fire' },
    ],
  },
  {
    title: 'Match',
    rows: [
      { keys: ['Esc'], action: 'Pause' },
      { keys: ['Tab'], action: 'Scoreboard (hold)' },
      { keys: ['F3'], action: 'Debug overlay' },
    ],
  },
  {
    title: 'Chat (online)',
    rows: [
      { keys: ['Enter'], action: 'Chat to everyone; Enter sends, Esc cancels' },
      { keys: ['T'], action: 'Chat to your team (team deathmatch)' },
      { keys: ['/w name'], action: 'Whisper to a player; /r answers the last' },
      { keys: ['/mute name'], action: 'Mute a player (/unmute undoes it)' },
    ],
  },
  {
    title: 'Custom lobbies',
    rows: [
      { keys: ['↑', '↓'], action: 'Choose a lobby' },
      { keys: ['Enter'], action: 'Join; waiting room: Ready (owner: Start)' },
      { keys: ['C'], action: 'Create a lobby' },
      { keys: ['/'], action: 'Search the list' },
      { keys: ['T'], action: 'Lobby chat (waiting room)' },
      { keys: ['Esc'], action: 'Modes; waiting room: leave (asks first)' },
    ],
  },
  {
    title: 'Menus',
    rows: [
      { keys: ['↑', '↓'], action: 'Choose' },
      { keys: ['B'], action: 'Bot difficulty (Arena screen)' },
      { keys: ['←', '→'], action: 'Change weapon (garage)' },
      { keys: ['Enter'], action: 'Select' },
      { keys: ['Esc'], action: 'Back' },
      { keys: ['N'], action: 'Patch notes (main menu)' },
    ],
  },
]

const TABS = ['Graphics', 'Camera', 'Sound', 'Controls'] as const
type Tab = (typeof TABS)[number]

interface SliderProps {
  label: string
  value: number // integer steps, e.g. percent
  min: number
  max: number
  step?: number
  readout: string
  onChange: (value: number) => void
}

function Slider({ label, value, min, max, step = 1, readout, onChange }: SliderProps) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-neutral-400 tabular-nums">{readout}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-red-500" />
    </label>
  )
}

function Toggle({ label, keycap, checked, onChange }: { label: string; keycap?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2">
        {label}
        {keycap && <span className="rounded border border-neutral-500/50 px-1.5 py-0.5 text-xs text-neutral-400">{keycap}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-red-500" />
    </label>
  )
}

// Every setting back to its default, from the drawer's footer (every tab).
export function RestoreDefaults() {
  return (
    <button
      onClick={() => updateSettings(DEFAULT_SETTINGS)}
      className="border-b border-red-500/70 pb-0.5 text-xs font-bold tracking-[0.2em] text-red-400 uppercase hover:text-red-300"
    >
      Restore defaults
    </button>
  )
}

// Every control writes straight to the live settings; the game applies them
// at once (in a match too) and the browser keeps them. One tab at a time:
// click one, or ←/→ (a focused slider keeps its arrows). The key bindings
// have a tab too, where rebinding will live.
export function SettingsPanel() {
  const [, rerender] = useState(0)
  const [tab, setTab] = useState<Tab>('Graphics')
  useEffect(() => onSettingsChange(() => rerender((n) => n + 1)), []) // F3 flips debug from outside
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (step) setTab((current) => TABS[(TABS.indexOf(current) + step + TABS.length) % TABS.length])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const quality = QUALITY[settings.quality]
  const scale = renderScale()
  const pipeline = [
    quality.samples ? `${quality.samples}× MSAA` : 'No anti-aliasing',
    quality.occlusion && 'ambient occlusion',
    quality.bloom && 'bloom',
    `${quality.shadowMap / 1024}K shadows`,
  ]

  return (
    <div className="flex flex-col gap-7">
      <div role="tablist" className="flex items-end gap-6 border-b border-white/10">
        {TABS.map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={name === tab}
            onClick={() => setTab(name)}
            className={`-mb-px border-b-2 pb-2 text-xs font-bold tracking-[0.2em] uppercase ${name === tab ? 'border-red-500 text-white' : 'border-transparent text-neutral-400 hover:text-neutral-200'}`}
          >
            {name}
          </button>
        ))}
        <span className="ml-auto flex gap-1 pb-2 text-xs text-neutral-500">
          <span className="rounded border border-neutral-500/50 px-1.5">&larr;</span>
          <span className="rounded border border-neutral-500/50 px-1.5">&rarr;</span>
        </span>
      </div>

      <div role="tabpanel" className="flex flex-col gap-4">
        {tab === 'Graphics' && (
          <>
            <div className="flex flex-col gap-2 text-sm">
              <span className="flex items-center justify-between">
                <span>Quality</span>
                <span className="flex">
                  {QUALITIES.map((level) => (
                    <button
                      key={level}
                      onClick={() => updateSettings({ quality: level })}
                      className={`-ml-px border px-3 py-1 text-xs font-bold tracking-[0.15em] uppercase ${
                        settings.quality === level
                          ? 'relative border-red-500 bg-red-500/20 text-white'
                          : 'border-white/15 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </span>
              </span>
              <span className="text-xs text-neutral-500">{pipeline.filter(Boolean).join(' · ')}</span>
            </div>
            <Slider
              label="Resolution scale"
              value={percent(scale)}
              min={50}
              max={percent(maxResolutionScale())}
              step={5}
              readout={`${percent(scale)}% · ${Math.round(innerWidth * scale)}×${Math.round(innerHeight * scale)}`}
              onChange={(value) => updateSettings({ resolutionScale: value / 100 })}
            />
            <Toggle label="Show frame rate" checked={settings.showFps} onChange={(showFps) => updateSettings({ showFps })} />
            <Toggle label="Debug mode" keycap="F3" checked={settings.debug} onChange={(debug) => updateSettings({ debug })} />
          </>
        )}

        {tab === 'Camera' && (
          <>
            <Slider
              label="Mouse sensitivity"
              value={percent(settings.mouseSensitivity)}
              min={25}
              max={300}
              step={5}
              readout={`${percent(settings.mouseSensitivity)}%`}
              onChange={(value) => updateSettings({ mouseSensitivity: value / 100 })}
            />
            <Slider
              label="Camera shake"
              value={percent(settings.cameraShake)}
              min={0}
              max={100}
              step={5}
              readout={settings.cameraShake ? `${percent(settings.cameraShake)}%` : 'Off'}
              onChange={(value) => updateSettings({ cameraShake: value / 100 })}
            />
          </>
        )}

        {tab === 'Sound' && (
          <>
            <Slider
              label="Master volume"
              value={percent(settings.masterVolume)}
              min={0}
              max={100}
              readout={`${percent(settings.masterVolume)}%`}
              onChange={(value) => updateSettings({ masterVolume: value / 100 })}
            />
            <Slider
              label="Music"
              value={percent(settings.musicVolume)}
              min={0}
              max={100}
              readout={`${percent(settings.musicVolume)}%`}
              onChange={(value) => updateSettings({ musicVolume: value / 100 })}
            />
            <Slider
              label="Effects"
              value={percent(settings.effectsVolume)}
              min={0}
              max={100}
              readout={`${percent(settings.effectsVolume)}%`}
              onChange={(value) => updateSettings({ effectsVolume: value / 100 })}
            />
          </>
        )}

        {tab === 'Controls' &&
          CONTROLS.map((group) => (
            <div key={group.title}>
              <p className="font-display text-sm text-neutral-300 italic">{group.title}</p>
              <div className="mt-2 flex flex-col gap-2.5">
                {group.rows.map((row) => (
                  <div key={row.action} className="flex items-center justify-between text-sm">
                    <span>{row.action}</span>
                    <span className="flex gap-1.5">
                      {row.keys.map((key) => (
                        <span key={key} className="min-w-7 rounded border border-neutral-500/50 px-1.5 py-0.5 text-center text-xs text-neutral-300">
                          {key}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
