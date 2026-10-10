import type { ReactNode } from 'react'

// What the results screen (Results.tsx, ResultsFrame.tsx) and the modes'
// results panels (modes/<mode>/ResultsPanel.tsx) share: the headline's
// shape and the way numbers and sections are put.

export type Tone = 'win' | 'loss' | 'draw'

// The headline for the player: title, tone, one line of record, the badge and a note (overtime).
export interface Verdict {
  tone: Tone
  title: string
  line: string
  badge: ReactNode
  badgeLabel: string
  note?: string
}

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
export const number = (n: number) => Math.round(n).toLocaleString('en-US')
export const rise = (step: number) => ({ animationDelay: `${step * 70}ms` }) // stagger for animate-rise
