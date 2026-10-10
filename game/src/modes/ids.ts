// Every game mode's id, in the order the screens list them. It imports
// nothing, so any level may import it: the type sits at the bottom of the
// graph instead of on the registry (modes.ts), which declares one entry per id.
export const MODE_IDS = ['tdm', 'ffa'] as const
export type Mode = (typeof MODE_IDS)[number]
