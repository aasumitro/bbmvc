import type { ComponentType, ReactNode, Ref } from 'react'
import type { HudPanelHandle } from '../hud/dom.ts'
import type { Match } from '../runtime/match.ts'
import { HudPanel as FfaHudPanel } from './ffa/HudPanel.tsx'
import { ResultsPanel as FfaResultsPanel } from './ffa/ResultsPanel.tsx'
import type { Mode } from './ids.ts'
import { HudPanel as TdmHudPanel } from './tdm/HudPanel.tsx'
import { ResultsPanel as TdmResultsPanel } from './tdm/ResultsPanel.tsx'

// Each mode's own pieces of the screens, client-only (the server never
// imports this): its block on the HUD and what the HUD shows of it
// elsewhere (hud/Hud.tsx), and its results (screens/Results.tsx, which
// hands it the lobby's tally and the buttons as `children`).
interface ModeViews {
  HudPanel: ComponentType<{ ref: Ref<HudPanelHandle> }>
  ResultsPanel: ComponentType<{ match: Match; children: ReactNode }>
}

export const MODE_VIEWS: Record<Mode, ModeViews> = {
  tdm: { HudPanel: TdmHudPanel, ResultsPanel: TdmResultsPanel },
  ffa: { HudPanel: FfaHudPanel, ResultsPanel: FfaResultsPanel },
}
