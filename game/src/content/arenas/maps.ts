import type { Arena } from './arena.ts'
import { buildCity } from './city.ts'
import { buildScrapyard } from './scrapyard.ts'
import type { Mode } from '../../modes/ids.ts'

// Every arena, what the map select shows of it and which modes it hosts.
export type MapId = 'scrapyard' | 'city'

interface MapInfo {
  name: string
  image: string // preview card, under public/
  arrival: string // loading-screen line
  modes: Mode[]
  build: () => Arena
}

export const MAPS: Record<MapId, MapInfo> = {
  scrapyard: {
    name: 'Scrapyard',
    image: `${import.meta.env.BASE_URL}maps/scrapyard.jpg`,
    arrival: 'Entering the yard',
    modes: ['tdm', 'ffa'],
    build: () => buildScrapyard(1),
  },
  city: {
    name: 'The City',
    image: `${import.meta.env.BASE_URL}maps/city.jpg`,
    arrival: 'Rolling into the city',
    modes: ['tdm', 'ffa'],
    build: () => buildCity(7),
  },
}

export const mapsFor = (mode: Mode) => (Object.keys(MAPS) as MapId[]).filter((id) => MAPS[id].modes.includes(mode))
