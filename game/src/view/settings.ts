// Player settings: live values the game systems read every frame (camera,
// HUD) or apply when told (audio, renderer), kept in the browser between
// visits. The settings drawer is the only writer.

import { QUALITIES, type Quality } from '../render/postprocessing.ts'

export const DEFAULT_SETTINGS = {
  quality: 'high' as Quality, // postprocessing.ts QUALITY
  resolutionScale: 1, // render pixels per CSS pixel; 1 = the window's resolution
  showFps: false,
  debug: false, // F3 overlay
  mouseSensitivity: 1, // × CHASE_CAMERA.lookSensitivity
  cameraShake: 1, // × CHASE_CAMERA.shake
  masterVolume: 0.8,
  musicVolume: 0.8,
  effectsVolume: 1,
}
type Settings = typeof DEFAULT_SETTINGS

const STORAGE_KEY = 'scrapyard.settings'
const listeners = new Set<() => void>()

// Saved values of the right type only: an old or hand-edited entry falls back to the default.
function load() {
  const saved: Record<string, unknown> = {}
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (typeof stored[key] === typeof value) saved[key] = stored[key]
    }
  } catch {
    // storage blocked or corrupt: defaults
  }
  if (!QUALITIES.includes(saved.quality as Quality)) delete saved.quality
  return saved as Partial<Settings>
}

export const settings: Settings = { ...DEFAULT_SETTINGS, ...load() }

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // not saved; still applies for this visit
  }
  listeners.forEach((listener) => listener())
}

// Calls `listener` after every change; returns the unsubscribe.
export function onSettingsChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The resolution scale reaches up to the display's native pixels (capped at 2x).
export const maxResolutionScale = () => Math.max(1, Math.min(window.devicePixelRatio, 2))
export const renderScale = () => Math.min(Math.max(settings.resolutionScale, 0.5), maxResolutionScale())
